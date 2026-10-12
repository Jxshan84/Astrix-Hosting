import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { jwtSecret } from "../config.js";
import { db } from "../db/database.js";
import { recordAudit } from "../services/audit.js";

export type AuthRequest = Request & {
  userId?: number;
  userRole?: string;
  userPlan?: string;
};

export type StaffPermission =
  | "announcement_management"
  | "moderation_review"
  | "appeal_review"
  | "support_review"
  | "discord_moderation";

export function configuredOwnerId() {
  const value = process.env.OWNER_USER_ID?.trim();
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function isOwner(userId: number | undefined) {
  return userId !== undefined && userId === configuredOwnerId();
}

export function userPermissions(userId: number) {
  return db
    .prepare("SELECT permission FROM staff_permissions WHERE user_id = ?")
    .all(userId)
    .map((row) => (row as { permission: StaffPermission }).permission);
}

export function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies?.astrix_session;

  if (!token) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  let payload: { userId: number };
  try {
    payload = jwt.verify(token, jwtSecret) as {
      userId: number;
    };
  } catch {
    return res.status(401).json({
      error: "Invalid or expired session."
    });
  }

  if (!Number.isSafeInteger(payload.userId) || payload.userId <= 0) {
    return res.status(401).json({
      error: "Invalid or expired session."
    });
  }

  const user = db
    .prepare("SELECT id, role, plan FROM users WHERE id = ?")
    .get(payload.userId) as
    | { id: number; role: string; plan: string }
    | undefined;

  if (!user) {
    return res.status(401).json({
      error: "Invalid or expired session."
    });
  }

  req.userId = user.id;
  req.userRole = isOwner(user.id) ? "owner" : user.role === "owner" ? "user" : user.role;
  req.userPlan = user.plan;
  next();
}

export function requireOwner(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  if (configuredOwnerId() === null) {
    console.error("Owner-only request denied: OWNER_USER_ID is not configured.");
    return res.status(503).json({ error: "Owner access is not configured." });
  }

  if (!isOwner(req.userId)) {
    recordAudit("authorization.owner_denied", req.userId, null, {
      method: req.method,
      path: req.path,
    });
    console.warn("Owner-only request denied for authenticated account.");
    return res.status(403).json({ error: "Owner access required." });
  }

  return next();
}

export function requirePermission(permission: StaffPermission) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Authentication required." });
    }
    if (isOwner(req.userId)) return next();

    const granted = db
      .prepare("SELECT 1 FROM staff_permissions WHERE user_id = ? AND permission = ?")
      .get(req.userId, permission);
    if (!granted) {
      recordAudit("authorization.permission_denied", req.userId, null, {
        permission,
        method: req.method,
        path: req.path,
      });
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }
    return next();
  };
}

export function requireUnrestrictedAccount(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.userId) {
    return res.status(401).json({ error: "Authentication required." });
  }
  const now = new Date().toISOString();
  const restriction = db.prepare(`
    SELECT id, restriction_type, reason, expires_at
    FROM account_restrictions
    WHERE user_id = ? AND revoked_at IS NULL
      AND (restriction_type = 'permanent' OR expires_at > ?)
    ORDER BY created_at DESC
    LIMIT 1
  `).get(req.userId, now) as {
    id: number;
    restriction_type: "temporary" | "permanent";
    reason: string;
    expires_at: string | null;
  } | undefined;

  if (restriction) {
    return res.status(403).json({
      error: "This account is restricted from using this service.",
      restriction: {
        id: restriction.id,
        type: restriction.restriction_type,
        reason: restriction.reason,
        expiresAt: restriction.expires_at,
      },
      appealPath: "/appeals",
    });
  }
  return next();
}

export function rateLimitUserAction(action: string) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ error: "Authentication required." });
    }
    const settings = db.prepare(`
      SELECT automation_enabled, spam_threshold_per_minute
      FROM security_settings WHERE id = 1
    `).get() as { automation_enabled: number; spam_threshold_per_minute: number } | undefined;
    if (!settings?.automation_enabled) return next();
    if (
      db.prepare("SELECT 1 FROM security_exemptions WHERE user_id = ?").get(req.userId)
    ) return next();

    const now = new Date();
    const windowStartedAt = new Date(now.getTime() - 60_000).toISOString();
    db.prepare(`
      INSERT INTO user_action_windows (user_id, action, action_count, window_started_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(user_id, action) DO UPDATE SET
        action_count = CASE
          WHEN user_action_windows.window_started_at <= ? THEN 1
          ELSE user_action_windows.action_count + 1
        END,
        window_started_at = CASE
          WHEN user_action_windows.window_started_at <= ? THEN excluded.window_started_at
          ELSE user_action_windows.window_started_at
        END
    `).run(req.userId, action, now.toISOString(), windowStartedAt, windowStartedAt);
    const record = db.prepare(`
      SELECT action_count FROM user_action_windows WHERE user_id = ? AND action = ?
    `).get(req.userId, action) as { action_count: number };
    if (record.action_count > settings.spam_threshold_per_minute) {
      if (record.action_count === settings.spam_threshold_per_minute + 1) {
        const incident = db.prepare(`
          INSERT INTO security_incidents
            (incident_type, actor_user_id, evidence_ref, action_taken, created_at)
          VALUES ('repeated_action', ?, ?, 'temporary_rate_limit', ?)
        `).run(
          req.userId,
          `user-action:${action}:${req.userId}`,
          now.toISOString()
        );
        recordAudit("security.action_rate_limited", req.userId, req.userId, {
          action,
          incidentId: Number(incident.lastInsertRowid),
        });
      }
      return res.status(429).json({ error: "Too many requests. Please wait before trying again." });
    }
    return next();
  };
}
