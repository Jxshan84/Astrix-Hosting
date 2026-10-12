import { Router, raw } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";
import {
  isOwner,
  rateLimitUserAction,
  requireAuth,
  requirePermission,
  type AuthRequest,
} from "../middleware/auth.js";
import { enqueueBotEvent, recordAudit } from "../services/audit.js";

const router = Router();
const maxAttachmentBytes = 2 * 1024 * 1024;
const allowedTypes = new Set(["image/png", "image/jpeg", "application/pdf"]);

function activeRestriction(userId: number) {
  return db.prepare(`
    SELECT id, restriction_type, reason, evidence_refs_json, appeal_eligible,
           created_by, created_at, expires_at
    FROM account_restrictions
    WHERE user_id = ? AND revoked_at IS NULL
      AND (restriction_type = 'permanent' OR expires_at > ?)
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, new Date().toISOString()) as {
    id: number;
    restriction_type: string;
    reason: string;
    evidence_refs_json: string;
    appeal_eligible: number;
    created_by: number;
    created_at: string;
    expires_at: string | null;
  } | undefined;
}

function canReview(userId: number) {
  return isOwner(userId) || Boolean(
    db.prepare(`
      SELECT 1 FROM staff_permissions WHERE user_id = ? AND permission = 'appeal_review'
    `).get(userId)
  );
}

function sendAppeal(appealId: string, userId: number) {
  const appeal = db.prepare(`
    SELECT a.id, a.restriction_id, a.user_id, a.explanation, a.status,
           a.decision_notes, a.reviewer_user_id, a.submitted_at, a.reviewed_at,
           r.restriction_type, r.reason, r.appeal_eligible, r.evidence_refs_json,
           r.expires_at, u.username
    FROM appeals a
    JOIN account_restrictions r ON r.id = a.restriction_id
    JOIN users u ON u.id = a.user_id
    WHERE a.id = ?
  `).get(appealId) as {
    id: string;
    restriction_id: number;
    user_id: number;
    explanation: string;
    status: string;
    decision_notes: string | null;
    reviewer_user_id: number | null;
    submitted_at: string;
    reviewed_at: string | null;
    restriction_type: string;
    reason: string;
    appeal_eligible: number;
    evidence_refs_json: string;
    expires_at: string | null;
    username: string;
  } | undefined;
  if (!appeal || (appeal.user_id !== userId && !canReview(userId))) return null;
  const attachments = db.prepare(`
    SELECT id, file_name, media_type, length(content) AS size, created_at
    FROM appeal_attachments WHERE appeal_id = ? ORDER BY id
  `).all(appealId);
  return {
    ...appeal,
    evidenceRefs: JSON.parse(appeal.evidence_refs_json) as string[],
    attachments,
  };
}

router.post("/", requireAuth, rateLimitUserAction("appeal_create"), (req: AuthRequest, res) => {
  if (!req.userId) return res.status(401).json({ error: "Authentication required." });
  const explanation = req.body?.explanation;
  if (typeof explanation !== "string" || explanation.trim().length < 20 || explanation.length > 10_000) {
    return res.status(400).json({ error: "Explain why the restriction should be reviewed (20–10,000 characters)." });
  }
  const restriction = activeRestriction(req.userId);
  if (!restriction) return res.status(404).json({ error: "No active account restriction is available to appeal." });
  if (!restriction.appeal_eligible) {
    return res.status(403).json({ error: "This restriction is not eligible for appeal." });
  }
  const appealId = `APL-${randomUUID().slice(0, 12).toUpperCase()}`;
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO appeals (id, restriction_id, user_id, explanation, submitted_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(appealId, restriction.id, req.userId, explanation.trim(), now);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return res.status(409).json({ error: "An appeal for this restriction is already awaiting review." });
    }
    throw error;
  }
  recordAudit("appeal.submitted", req.userId, null, {
    appealId,
    restrictionId: restriction.id,
  });
  const linkedAccount = db.prepare("SELECT discord_id FROM users WHERE id = ?").get(req.userId) as
    | { discord_id: string | null }
    | undefined;
  if (linkedAccount?.discord_id) {
    enqueueBotEvent("appeal_submitted", { discordId: linkedAccount.discord_id, appealId });
  }
  return res.status(201).json({ success: true, appealId, status: "pending" });
});

router.get("/mine", requireAuth, (req: AuthRequest, res) => {
  const appeals = db.prepare(`
    SELECT a.id, a.restriction_id, a.explanation, a.status, a.decision_notes,
           a.submitted_at, a.reviewed_at, r.reason, r.expires_at
    FROM appeals a JOIN account_restrictions r ON r.id = a.restriction_id
    WHERE a.user_id = ? ORDER BY a.submitted_at DESC
  `).all(req.userId);
  return res.json({ appeals });
});

router.get("/eligibility", requireAuth, (req: AuthRequest, res) => {
  if (!req.userId) return res.status(401).json({ error: "Authentication required." });
  const restriction = activeRestriction(req.userId);
  if (!restriction) return res.json({ eligible: false, restriction: null });
  return res.json({
    eligible: Boolean(restriction.appeal_eligible),
    restriction: {
      id: restriction.id,
      type: restriction.restriction_type,
      reason: restriction.reason,
      expiresAt: restriction.expires_at,
      evidenceRefs: JSON.parse(restriction.evidence_refs_json) as string[],
    },
  });
});

router.get("/", requireAuth, requirePermission("appeal_review"), (_req, res) => {
  const appeals = db.prepare(`
    SELECT a.id, a.user_id, u.username, a.restriction_id, a.explanation,
           a.status, a.decision_notes, a.reviewer_user_id, a.submitted_at,
           a.reviewed_at, r.reason, r.restriction_type, r.expires_at,
           r.evidence_refs_json
    FROM appeals a
    JOIN account_restrictions r ON r.id = a.restriction_id
    JOIN users u ON u.id = a.user_id
    ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.submitted_at DESC
    LIMIT 500
  `).all() as Array<Record<string, unknown> & { evidence_refs_json: string }>;
  return res.json({
    appeals: appeals.map(({ evidence_refs_json, ...appeal }) => ({
      ...appeal,
      evidenceRefs: JSON.parse(evidence_refs_json) as string[],
    })),
  });
});

router.get("/:id", requireAuth, (req: AuthRequest, res) => {
  if (!req.userId) return res.status(401).json({ error: "Authentication required." });
  if (typeof req.params.id !== "string") return res.status(400).json({ error: "Invalid appeal ID." });
  const appeal = sendAppeal(req.params.id, req.userId);
  if (!appeal) return res.status(404).json({ error: "Appeal not found." });
  return res.json({ appeal });
});

router.post(
  "/:id/attachments",
  requireAuth,
  raw({
    type: ["image/png", "image/jpeg", "application/pdf"],
    limit: maxAttachmentBytes,
  }),
  (req: AuthRequest, res) => {
    if (!req.userId || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "Upload an attachment as binary data." });
    }
    const appeal = db.prepare(`
      SELECT user_id, status FROM appeals WHERE id = ?
    `).get(req.params.id) as { user_id: number; status: string } | undefined;
    if (!appeal || appeal.user_id !== req.userId) {
      return res.status(404).json({ error: "Appeal not found." });
    }
    if (appeal.status !== "pending") {
      return res.status(409).json({ error: "Evidence can only be added to a pending appeal." });
    }
    const type = req.get("content-type") || "";
    const data = req.body as Buffer;
    const signatureMatches =
      (type === "image/png" &&
        data.length >= 8 &&
        data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (type === "image/jpeg" &&
        data.length >= 3 &&
        data[0] === 0xff &&
        data[1] === 0xd8 &&
        data[2] === 0xff) ||
      (type === "application/pdf" && data.subarray(0, 5).toString() === "%PDF-");
    if (!allowedTypes.has(type) || !signatureMatches || !data.length || data.length > maxAttachmentBytes) {
      return res.status(400).json({ error: "Only valid PNG, JPEG, or PDF files up to 2 MB are accepted." });
    }
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM appeal_attachments WHERE appeal_id = ?
    `).get(req.params.id) as { count: number };
    if (count.count >= 3) return res.status(400).json({ error: "An appeal can include at most three attachments." });
    const requestedName = req.get("x-file-name") || "evidence";
    const fileName = requestedName
      .replace(/[/\\]/g, "_")
      .replace(/[^\w.\- ()]/g, "_")
      .slice(0, 120) || "evidence";
    const result = db.prepare(`
      INSERT INTO appeal_attachments (appeal_id, file_name, media_type, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.params.id, fileName, type, data, new Date().toISOString());
    recordAudit("appeal.evidence_added", req.userId, null, {
      appealId: req.params.id,
      attachmentId: Number(result.lastInsertRowid),
      byteLength: data.length,
      mediaType: type,
    });
    return res.status(201).json({ success: true, attachmentId: Number(result.lastInsertRowid) });
  }
);

router.get(
  "/:id/attachments/:attachmentId",
  requireAuth,
  (req: AuthRequest, res) => {
    if (!req.userId) return res.status(401).json({ error: "Authentication required." });
    const attachmentId = Number(req.params.attachmentId);
    if (!Number.isSafeInteger(attachmentId) || attachmentId < 1) {
      return res.status(400).json({ error: "Invalid attachment ID." });
    }
    const file = db.prepare(`
      SELECT x.file_name, x.media_type, x.content, a.user_id
      FROM appeal_attachments x JOIN appeals a ON a.id = x.appeal_id
      WHERE x.id = ? AND a.id = ?
    `).get(attachmentId, req.params.id) as {
      file_name: string;
      media_type: string;
      content: Buffer;
      user_id: number;
    } | undefined;
    if (!file || (file.user_id !== req.userId && !canReview(req.userId))) {
      return res.status(404).json({ error: "Attachment not found." });
    }
    res.setHeader("Content-Type", file.media_type);
    res.setHeader("Content-Disposition", 'attachment; filename="appeal-evidence"');
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    return res.send(file.content);
  }
);

router.patch(
  "/:id/decision",
  requireAuth,
  requirePermission("appeal_review"),
  (req: AuthRequest, res) => {
    const { decision, notes } = req.body || {};
    if (
      !req.userId ||
      !["approved", "rejected"].includes(decision) ||
      typeof notes !== "string" ||
      notes.trim().length < 3 ||
      notes.length > 2_000
    ) {
      return res.status(400).json({ error: "A valid decision and review note are required." });
    }
    const reviewerUserId = req.userId;
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
    if (!appeal || appeal.status !== "pending") {
      return res.status(404).json({ error: "Pending appeal not found." });
    }
    if (appeal.user_id === reviewerUserId || appeal.created_by === reviewerUserId) {
      return res.status(403).json({ error: "You cannot review an appeal concerning your own action or account." });
    }
    const now = new Date().toISOString();
    const review = db.transaction(() => {
      const updated = db.prepare(`
        UPDATE appeals
        SET status = ?, decision_notes = ?, reviewer_user_id = ?, reviewed_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(decision, notes.trim(), reviewerUserId, now, req.params.id);
      if (!updated.changes) throw new Error("Appeal has already been reviewed.");
      if (decision === "approved") {
        db.prepare(`
          UPDATE account_restrictions
          SET revoked_by = ?, revoked_at = ?, revocation_reason = ?
          WHERE id = ? AND revoked_at IS NULL
        `).run(reviewerUserId, now, `Appeal ${req.params.id} approved`, appeal.restriction_id);
      }
      db.prepare(`
        INSERT INTO notifications (user_id, appeal_id, title, message, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        appeal.user_id,
        req.params.id,
        `Appeal ${decision}`,
        `Your appeal ${req.params.id} was ${decision}. ${notes.trim()}`,
        now
      );
      const linkedAccount = db.prepare("SELECT discord_id FROM users WHERE id = ?").get(appeal.user_id) as
        | { discord_id: string | null }
        | undefined;
      if (linkedAccount?.discord_id) {
        enqueueBotEvent("appeal_decision", {
          discordId: linkedAccount.discord_id,
          appealId: req.params.id,
          decision,
        });
      }
      recordAudit(`appeal.${decision}`, reviewerUserId, appeal.user_id, {
        appealId: req.params.id,
        restrictionId: appeal.restriction_id,
        notes: notes.trim(),
      });
    });
    try {
      review();
    } catch {
      return res.status(409).json({ error: "Appeal could not be updated; refresh and review its current status." });
    }
    return res.json({ success: true, status: decision, reviewedAt: now });
  }
);

export default router;
