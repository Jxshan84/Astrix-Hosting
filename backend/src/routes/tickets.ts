import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../db/database.js";
import {
  isOwner,
  requireAuth,
  rateLimitUserAction,
  requireUnrestrictedAccount,
  type AuthRequest,
} from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
router.use(requireUnrestrictedAccount);

function isSupportStaff(userId: number | undefined) {
  if (!userId) return false;
  return isOwner(userId) || Boolean(db.prepare(`
    SELECT 1 FROM staff_permissions WHERE user_id = ? AND permission = 'support_review'
  `).get(userId));
}

function isPremium(plan: string) {
  return plan.toLowerCase() === "premium";
}

function getPriority(plan: string) {
  return isPremium(plan) ? "priority" : "normal";
}

router.post("/", rateLimitUserAction("ticket_create"), (req: AuthRequest, res) => {
  const subject = String(req.body?.subject || "").trim();
  const category = String(req.body?.category || "general").trim();
  const message = String(req.body?.message || "").trim();

  if (!req.userId || !subject || !message) {
    return res.status(400).json({
      error: "Missing required ticket information."
    });
  }

  if (subject.length > 160 || message.length > 10_000) {
    return res.status(400).json({
      error: "Ticket subject or message exceeds the allowed length."
    });
  }

  if (!["general", "hosting", "billing", "technical", "account"].includes(category)) {
    return res.status(400).json({ error: "Invalid ticket category." });
  }

  const user = db
    .prepare("SELECT id, username, plan FROM users WHERE id = ?")
    .get(req.userId) as
    | { id: number; username: string; plan: string }
    | undefined;

  if (!user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const now = new Date().toISOString();
  const ticketCode = `AST-${randomUUID().slice(0, 8).toUpperCase()}`;
  const priority = getPriority(user.plan);

  const result = db.prepare(`
    INSERT INTO tickets
    (ticket_code, user_id, user_name, plan, subject, category, message, priority, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    ticketCode,
    String(user.id),
    user.username,
    user.plan,
    subject,
    category,
    message,
    priority,
    now,
    now
  );

  res.status(201).json({
    success: true,
    ticket: {
      id: result.lastInsertRowid,
      ticketCode,
      priority,
      status: "pending",
      available24x7: user.plan.toLowerCase() === "premium"
    }
  });
});

router.get("/", (req: AuthRequest, res) => {
  const tickets = isSupportStaff(req.userId)
    ? db.prepare(`
        SELECT *
        FROM tickets
        ORDER BY
          CASE WHEN priority = 'priority' THEN 0 ELSE 1 END,
          created_at DESC
      `).all()
    : db.prepare(`
        SELECT *
        FROM tickets
        WHERE user_id = ?
        ORDER BY created_at DESC
      `).all(String(req.userId));

  res.json({ tickets });
});

router.get("/:code", (req: AuthRequest, res) => {
  const ticket = db.prepare(`
    SELECT * FROM tickets WHERE ticket_code = ?
  `).get(req.params.code);

  if (!ticket) {
    return res.status(404).json({
      error: "Ticket not found."
    });
  }

  const record = ticket as { id: number; user_id: string };
  if (record.user_id !== String(req.userId) && !isSupportStaff(req.userId)) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  const messages = db.prepare(`
    SELECT *
    FROM ticket_messages
    WHERE ticket_id = ?
    ORDER BY created_at ASC
  `).all(record.id);

  res.json({ ticket, messages });
});

router.patch("/:code/status", (req: AuthRequest, res) => {
  if (!isSupportStaff(req.userId)) {
    return res.status(403).json({ error: "Support staff access required." });
  }

  const { status } = req.body;

  const allowed = [
    "pending",
    "reviewing",
    "working",
    "resolved",
    "closed"
  ];

  if (!allowed.includes(status)) {
    return res.status(400).json({
      error: "Invalid ticket status."
    });
  }

  const result = db.prepare(`
    UPDATE tickets
    SET status = ?, updated_at = ?
    WHERE ticket_code = ?
  `).run(status, new Date().toISOString(), req.params.code);

  if (!result.changes) {
    return res.status(404).json({
      error: "Ticket not found."
    });
  }

  res.json({
    success: true,
    status
  });
});

router.post("/:code/messages", (req: AuthRequest, res) => {
  const message = String(req.body?.message || "").trim();

  if (!message || message.length > 10_000) {
    return res.status(400).json({
      error: "Missing message information."
    });
  }

  const ticket = db.prepare(`
    SELECT id, user_id FROM tickets WHERE ticket_code = ?
  `).get(req.params.code) as { id: number; user_id: string } | undefined;

  if (!ticket) {
    return res.status(404).json({
      error: "Ticket not found."
    });
  }

  if (ticket.user_id !== String(req.userId) && !isSupportStaff(req.userId)) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  const user = db
    .prepare("SELECT username, role FROM users WHERE id = ?")
    .get(req.userId) as { username: string; role: string } | undefined;

  if (!user) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ticket_messages
    (ticket_id, sender_id, sender_name, sender_role, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    ticket.id,
    String(req.userId),
    user.username,
    isSupportStaff(req.userId) ? (isOwner(req.userId) ? "owner" : "support") : "user",
    message,
    now
  );

  db.prepare(`
    UPDATE tickets
    SET updated_at = ?
    WHERE id = ?
  `).run(now, ticket.id);

  res.status(201).json({
    success: true
  });
});

export default router;
