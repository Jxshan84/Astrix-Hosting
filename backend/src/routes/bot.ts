import { Router, raw, type NextFunction, type Request, type Response } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "../db/database.js";
import { enqueueBotEvent, recordAudit } from "../services/audit.js";
import type { StaffPermission } from "../middleware/auth.js";

const router = Router();
const permissions = new Set<StaffPermission>([
  "announcement_management",
  "moderation_review",
  "appeal_review",
  "support_review",
  "discord_moderation",
]);
const incidentTypes = new Set([
  "spam",
  "abusive_language",
  "unauthorized_role_change",
  "destructive_action",
  "moderation_action",
]);

function requireBot(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.ASTRIX_BOT_SYNC_KEY;
  if (!expected || expected.length < 32) {
    return res.status(503).json({ error: "Bot integration is not configured." });
  }
  const provided = Buffer.from(req.get("x-astrix-bot-key") || "");
  const known = Buffer.from(expected);
  if (provided.length !== known.length || !timingSafeEqual(provided, known)) {
    return res.status(401).json({ error: "Bot authentication required." });
  }
  return next();
}

function validSnowflake(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

function accountForDiscordId(discordId: string) {
  return db.prepare(`
    SELECT id, username, discord_id FROM users WHERE discord_id = ?
  `).get(discordId) as { id: number; username: string; discord_id: string } | undefined;
}

function hasPermission(userId: number, permission: StaffPermission) {
  if (Number(process.env.OWNER_USER_ID) === userId) return true;
  return Boolean(db.prepare(`
    SELECT 1 FROM staff_permissions WHERE user_id = ? AND permission = ?
  `).get(userId, permission));
}

function privateDiscordIdForUser(userId: number) {
  const row = db.prepare("SELECT discord_id FROM users WHERE id = ?").get(userId) as
    | { discord_id: string | null }
    | undefined;
  return row?.discord_id ?? null;
}

router.use(requireBot);

router.get("/config", (_req, res) => {
  const settings = db.prepare(`
    SELECT automation_enabled, discord_abuse_detection_enabled,
           discord_spam_threshold, discord_spam_window_seconds,
           discord_abuse_repeat_threshold, discord_timeout_minutes,
           discord_abuse_terms_json
    FROM security_settings WHERE id = 1
  `).get() as {
    automation_enabled: number;
    discord_abuse_detection_enabled: number;
    discord_spam_threshold: number;
    discord_spam_window_seconds: number;
    discord_abuse_repeat_threshold: number;
    discord_timeout_minutes: number;
    discord_abuse_terms_json: string;
  };
  return res.json({
    guildId: process.env.DISCORD_GUILD_ID || null,
    enabled: Boolean(settings.automation_enabled && settings.discord_abuse_detection_enabled),
    spamThreshold: settings.discord_spam_threshold,
    spamWindowSeconds: settings.discord_spam_window_seconds,
    abusiveLanguageRepeatThreshold: settings.discord_abuse_repeat_threshold,
    timeoutMinutes: settings.discord_timeout_minutes,
    abusiveTerms: JSON.parse(settings.discord_abuse_terms_json) as string[],
    exemptDiscordIds: (db.prepare(`
      SELECT u.discord_id
      FROM security_exemptions e JOIN users u ON u.id = e.user_id
      WHERE u.discord_id IS NOT NULL
    `).all() as Array<{ discord_id: string }>).map((row) => row.discord_id),
  });
});

router.post("/authorize", (req, res) => {
  const discordId = req.body?.discordId;
  const permission = req.body?.permission;
  if (!validSnowflake(discordId) || !permissions.has(permission)) {
    return res.status(400).json({ error: "Valid Discord account and permission are required." });
  }
  const account = accountForDiscordId(discordId);
  if (!account) return res.json({ authorized: false });
  return res.json({
    authorized: hasPermission(account.id, permission),
    isOwner: Number(process.env.OWNER_USER_ID) === account.id,
    accountId: account.id,
    username: account.username,
  });
});

router.post("/outbox/claim", (_req, res) => {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
  const claim = db.transaction(() => {
    db.prepare(`
      UPDATE bot_outbox
      SET status = 'failed', last_error = 'Delivery abandoned after repeated worker restarts.', updated_at = ?
      WHERE status = 'processing' AND attempts >= 5 AND updated_at < ?
    `).run(now, staleBefore);
    const row = db.prepare(`
      SELECT id, event_type, payload_json, attempts
      FROM bot_outbox
      WHERE attempts < 5 AND (
        status = 'queued' OR (status = 'processing' AND updated_at < ?)
      )
      ORDER BY id LIMIT 1
    `).get(staleBefore) as {
      id: number;
      event_type: string;
      payload_json: string;
      attempts: number;
    } | undefined;
    if (!row) return null;
    const updated = db.prepare(`
      UPDATE bot_outbox
      SET status = 'processing', attempts = attempts + 1, updated_at = ?
      WHERE id = ? AND attempts < 5 AND (
        status = 'queued' OR (status = 'processing' AND updated_at < ?)
      )
    `).run(now, row.id, staleBefore);
    return updated.changes
      ? { id: row.id, type: row.event_type, payload: JSON.parse(row.payload_json) as Record<string, unknown> }
      : null;
  });
  return res.json({ event: claim() });
});

router.post("/outbox/:id/result", (req, res) => {
  const id = Number(req.params.id);
  const { status, error } = req.body || {};
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !["delivered", "failed"].includes(status) ||
    (error !== undefined && (typeof error !== "string" || error.length > 500))
  ) {
    return res.status(400).json({ error: "Invalid bot delivery result." });
  }
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE bot_outbox
    SET status = ?, last_error = ?, updated_at = ?
    WHERE id = ? AND status = 'processing'
  `).run(status, status === "failed" ? String(error || "Discord delivery failed.").slice(0, 500) : null, now, id);
  if (!result.changes) return res.status(404).json({ error: "Pending bot event not found." });
  if (status === "failed") {
    console.error(`Discord outbox delivery failed for event ${id}.`);
    recordAudit("security.discord_delivery_failed", null, null, { outboxId: id });
  }
  return res.json({ success: true });
});

router.post("/incidents", (req, res) => {
  const {
    incidentType,
    actorDiscordId,
    targetDiscordId,
    evidenceRef,
    observedCount,
    actionTaken,
  } = req.body || {};
  const allowedActions = new Set(["observed", "warned", "timed_out", "action_failed"]);
  if (
    typeof incidentType !== "string" ||
    !incidentTypes.has(incidentType) ||
    (actorDiscordId !== undefined && !validSnowflake(actorDiscordId)) ||
    (targetDiscordId !== undefined && !validSnowflake(targetDiscordId)) ||
    typeof evidenceRef !== "string" ||
    evidenceRef.length > 200 ||
    !/^discord-(?:message|auditlog|interaction):\d{17,20}(?::\d{17,20}){1,2}$/.test(evidenceRef) ||
    !Number.isInteger(observedCount) ||
    observedCount < 1 ||
    observedCount > 100_000 ||
    !allowedActions.has(actionTaken)
  ) {
    return res.status(400).json({ error: "Invalid Discord incident report." });
  }

  const actor = actorDiscordId ? accountForDiscordId(actorDiscordId) : undefined;
  const target = targetDiscordId ? accountForDiscordId(targetDiscordId) : undefined;
  const settings = db.prepare(`
    SELECT automation_enabled, discord_abuse_detection_enabled,
           discord_spam_threshold, discord_abuse_repeat_threshold,
           discord_timeout_minutes
    FROM security_settings WHERE id = 1
  `).get() as {
    automation_enabled: number;
    discord_abuse_detection_enabled: number;
    discord_spam_threshold: number;
    discord_abuse_repeat_threshold: number;
    discord_timeout_minutes: number;
  };
  const enabled = Boolean(settings.automation_enabled && settings.discord_abuse_detection_enabled);
  const exemptAccount =
    ["spam", "abusive_language"].includes(incidentType) &&
    actor &&
    db.prepare(`
    SELECT 1 FROM security_exemptions WHERE user_id = ?
  `).get(actor.id);
  if (exemptAccount) {
    return res.status(201).json({
      success: true,
      incidentId: null,
      recommendation: "review",
      timeoutMinutes: null,
      exempt: true,
    });
  }
  const repeatObservation =
    incidentType === "abusive_language" &&
    observedCount >= settings.discord_abuse_repeat_threshold;
  const firstSpamTier =
    incidentType === "spam" &&
    observedCount >= settings.discord_spam_threshold;
  const repeatedSpam =
    incidentType === "spam" &&
    observedCount >= settings.discord_spam_threshold * 2;
  const recommendation = !enabled
    ? "review"
    : repeatObservation || repeatedSpam
      ? "timeout"
      : firstSpamTier
        ? "warn"
        : "review";

  const result = db.prepare(`
    INSERT INTO security_incidents
      (incident_type, actor_user_id, evidence_ref, action_taken, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    incidentType,
    actor?.id ?? null,
    evidenceRef,
    actionTaken,
    new Date().toISOString()
  );
  recordAudit("security.discord_incident", actor?.id ?? null, target?.id ?? null, {
    incidentId: Number(result.lastInsertRowid),
    incidentType,
    evidenceRef,
    observedCount,
    actionTaken,
  });
  return res.status(201).json({
    success: true,
    incidentId: Number(result.lastInsertRowid),
    recommendation,
    timeoutMinutes: recommendation === "timeout" ? settings.discord_timeout_minutes : null,
  });
});

router.post("/incidents/:id/action", (req, res) => {
  const id = Number(req.params.id);
  const { actionTaken, actorDiscordId } = req.body || {};
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    !["warned", "timed_out", "action_failed"].includes(actionTaken) ||
    (actorDiscordId !== undefined && !validSnowflake(actorDiscordId))
  ) {
    return res.status(400).json({ error: "Invalid moderation action report." });
  }
  const incident = db.prepare(`
    SELECT actor_user_id, evidence_ref, incident_type FROM security_incidents
    WHERE id = ? AND status = 'open'
  `).get(id) as {
    actor_user_id: number | null;
    evidence_ref: string;
    incident_type: string;
  } | undefined;
  if (!incident) return res.status(404).json({ error: "Open incident not found." });
  const actor = actorDiscordId ? accountForDiscordId(actorDiscordId) : undefined;
  db.prepare(`
    INSERT INTO security_incidents
      (incident_type, actor_user_id, evidence_ref, action_taken, created_at)
    VALUES ('moderation_action', ?, ?, ?, ?)
  `).run(
    actor?.id ?? incident.actor_user_id,
    incident.evidence_ref,
    `${actionTaken}:incident:${id}`,
    new Date().toISOString()
  );
  recordAudit("security.discord_action", actor?.id ?? null, incident.actor_user_id, {
    incidentId: id,
    actionTaken,
  });
  return res.json({ success: true });
});

router.post(
  "/appeals/:id/attachments",
  (req, res, next) => {
    const contentType = req.get("content-type") || "";
    if (!["image/png", "image/jpeg", "application/pdf"].includes(contentType)) {
      return res.status(415).json({ error: "Unsupported evidence type." });
    }
    next();
  },
  raw({
    type: ["image/png", "image/jpeg", "application/pdf"],
    limit: 2 * 1024 * 1024,
  }),
  (req: Request, res: Response) => {
    const discordId = req.get("x-discord-user-id") || "";
    if (!validSnowflake(discordId) || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "Valid Discord account and evidence file are required." });
    }
    const user = accountForDiscordId(discordId);
    if (!user) return res.status(404).json({ error: "Linked account not found." });
    const appeal = db.prepare("SELECT user_id, status FROM appeals WHERE id = ?")
      .get(req.params.id) as { user_id: number; status: string } | undefined;
    if (!appeal || appeal.user_id !== user.id) {
      return res.status(404).json({ error: "Appeal not found." });
    }
    if (appeal.status !== "pending") {
      return res.status(409).json({ error: "Evidence can only be added to a pending appeal." });
    }
    const data = req.body as Buffer;
    const mediaType = req.get("content-type") || "";
    const validSignature =
      (mediaType === "image/png" && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (mediaType === "image/jpeg" && data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) ||
      (mediaType === "application/pdf" && data.subarray(0, 5).toString() === "%PDF-");
    if (!data.length || !validSignature) {
      return res.status(400).json({ error: "The uploaded evidence file is invalid." });
    }
    const count = db.prepare("SELECT COUNT(*) AS count FROM appeal_attachments WHERE appeal_id = ?")
      .get(req.params.id) as { count: number };
    if (count.count >= 3) return res.status(400).json({ error: "An appeal can include at most three attachments." });
    const fileName = (req.get("x-file-name") || "discord-evidence")
      .replace(/[^\w.\- ()]/g, "_")
      .slice(0, 120);
    const result = db.prepare(`
      INSERT INTO appeal_attachments (appeal_id, file_name, media_type, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.id, fileName, mediaType, data, new Date().toISOString());
    recordAudit("appeal.discord_evidence_added", user.id, null, {
      appealId: req.params.id,
      attachmentId: Number(result.lastInsertRowid),
      mediaType,
      byteLength: data.length,
    });
    return res.status(201).json({ success: true, attachmentId: Number(result.lastInsertRowid) });
  }
);

router.post("/appeals", (req, res) => {
  const { discordId, explanation } = req.body || {};
  if (
    !validSnowflake(discordId) ||
    typeof explanation !== "string" ||
    explanation.trim().length < 20 ||
    explanation.length > 10_000
  ) {
    return res.status(400).json({ error: "Provide a linked Discord account and an appeal of at least 20 characters." });
  }
  const user = accountForDiscordId(discordId);
  if (!user) return res.status(404).json({ error: "Link your Discord account to your hosting account before appealing." });
  const restriction = db.prepare(`
    SELECT id, appeal_eligible FROM account_restrictions
    WHERE user_id = ? AND revoked_at IS NULL
      AND (restriction_type = 'permanent' OR expires_at > ?)
    ORDER BY created_at DESC LIMIT 1
  `).get(user.id, new Date().toISOString()) as {
    id: number;
    appeal_eligible: number;
  } | undefined;
  if (!restriction) return res.status(404).json({ error: "No active restriction was found." });
  if (!restriction.appeal_eligible) return res.status(403).json({ error: "This restriction is not eligible for appeal." });
  const appealId = `APL-${cryptoRandomId()}`;
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO appeals (id, restriction_id, user_id, explanation, submitted_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(appealId, restriction.id, user.id, explanation.trim(), now);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "An appeal for this restriction is already awaiting review." });
    }
    throw error;
  }
  recordAudit("appeal.submitted_discord", user.id, null, {
    appealId,
    restrictionId: restriction.id,
  });
  enqueueBotEvent("appeal_submitted", { discordId, appealId });
  return res.status(201).json({ success: true, appealId, status: "pending" });
});

router.get("/appeals/:id", (req, res) => {
  const discordId = req.query.discordId;
  if (!validSnowflake(discordId)) return res.status(400).json({ error: "Valid Discord account is required." });
  const reviewerPermission = req.query.review === "true";
  const user = accountForDiscordId(discordId);
  if (!user) return res.status(404).json({ error: "Linked account not found." });
  if (reviewerPermission && !hasPermission(user.id, "appeal_review")) {
    return res.status(403).json({ error: "Appeal review permission required." });
  }
  const appeal = db.prepare(`
    SELECT a.id, a.user_id, a.status, a.explanation, a.decision_notes,
           a.submitted_at, a.reviewed_at, r.reason, r.restriction_type, r.expires_at
    FROM appeals a JOIN account_restrictions r ON r.id = a.restriction_id
    WHERE a.id = ?
  `).get(req.params.id) as {
    id: string;
    user_id: number;
    status: string;
    explanation: string;
    decision_notes: string | null;
    submitted_at: string;
    reviewed_at: string | null;
    reason: string;
    restriction_type: string;
    expires_at: string | null;
  } | undefined;
  if (!appeal || (!reviewerPermission && appeal.user_id !== user.id)) {
    return res.status(404).json({ error: "Appeal not found." });
  }
  return res.json({ appeal });
});

router.post("/appeals/:id/decision", (req, res) => {
  const { discordId, decision, notes } = req.body || {};
  if (
    !validSnowflake(discordId) ||
    !["approved", "rejected"].includes(decision) ||
    typeof notes !== "string" ||
    notes.trim().length < 3 ||
    notes.length > 2_000
  ) {
    return res.status(400).json({ error: "Valid reviewer, decision, and notes are required." });
  }
  const reviewer = accountForDiscordId(discordId);
  if (!reviewer || !hasPermission(reviewer.id, "appeal_review")) {
    return res.status(403).json({ error: "Appeal review permission required." });
  }
  const appeal = db.prepare(`
    SELECT a.id, a.user_id, a.restriction_id, a.status, r.created_by
    FROM appeals a JOIN account_restrictions r ON r.id = a.restriction_id
    WHERE a.id = ?
  `).get(req.params.id) as {
    id: string;
    user_id: number;
    restriction_id: number;
    status: string;
    created_by: number;
  } | undefined;
  if (!appeal || appeal.status !== "pending") return res.status(404).json({ error: "Pending appeal not found." });
  if (appeal.user_id === reviewer.id || appeal.created_by === reviewer.id) {
    return res.status(403).json({ error: "You cannot review an appeal concerning your own action or account." });
  }
  const now = new Date().toISOString();
  const applyDecision = db.transaction(() => {
    const updated = db.prepare(`
      UPDATE appeals
      SET status = ?, decision_notes = ?, reviewer_user_id = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(decision, notes.trim(), reviewer.id, now, req.params.id);
    if (!updated.changes) throw new Error("Appeal is no longer pending.");
    if (decision === "approved") {
      db.prepare(`
        UPDATE account_restrictions
        SET revoked_by = ?, revoked_at = ?, revocation_reason = ?
        WHERE id = ? AND revoked_at IS NULL
      `).run(reviewer.id, now, `Appeal ${req.params.id} approved`, appeal.restriction_id);
    }
    db.prepare(`
      INSERT INTO notifications (user_id, appeal_id, title, message, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(appeal.user_id, req.params.id, `Appeal ${decision}`, `Your appeal ${req.params.id} was ${decision}. ${notes.trim()}`, now);
    const ownerDiscordId = privateDiscordIdForUser(appeal.user_id);
    if (ownerDiscordId) enqueueBotEvent("appeal_decision", {
      discordId: ownerDiscordId,
      appealId: req.params.id,
      decision,
    });
    recordAudit(`appeal.${decision}_discord`, reviewer.id, appeal.user_id, {
      appealId: req.params.id,
      restrictionId: appeal.restriction_id,
    });
  });
  try {
    applyDecision();
  } catch {
    return res.status(409).json({ error: "Appeal could not be updated; review its current status." });
  }
  return res.json({ success: true, status: decision, reviewedAt: now });
});

router.get("/appeals", (req, res) => {
  const discordId = req.query.discordId;
  if (!validSnowflake(discordId)) return res.status(400).json({ error: "Valid reviewer account is required." });
  const reviewer = accountForDiscordId(discordId);
  if (!reviewer || !hasPermission(reviewer.id, "appeal_review")) {
    return res.status(403).json({ error: "Appeal review permission required." });
  }
  const appeals = db.prepare(`
    SELECT a.id, u.username, a.status, a.submitted_at, r.reason
    FROM appeals a
    JOIN users u ON u.id = a.user_id
    JOIN account_restrictions r ON r.id = a.restriction_id
    ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.submitted_at DESC
    LIMIT 100
  `).all();
  return res.json({ appeals });
});

function cryptoRandomId() {
  return randomUUID().slice(0, 12).toUpperCase();
}

export default router;
