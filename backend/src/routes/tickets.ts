import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../db/database.js";

const router = Router();

const premiumPlans = ["premium"];

function isPremium(plan: string) {
  return premiumPlans.includes(plan.toLowerCase());
}

function getPriority(plan: string) {
  return isPremium(plan) ? "priority" : "normal";
}

router.post("/", (req, res) => {
  const {
    userId,
    userName,
    plan = "free",
    subject,
    category = "general",
    message
  } = req.body;

  if (!userId || !userName || !subject || !message) {
    return res.status(400).json({
      error: "Missing required ticket information."
    });
  }

  const now = new Date().toISOString();
  const ticketCode = `AST-${randomUUID().slice(0, 8).toUpperCase()}`;
  const priority = getPriority(plan);

  const result = db.prepare(`
    INSERT INTO tickets
    (ticket_code, user_id, user_name, plan, subject, category, message, priority, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    ticketCode,
    userId,
    userName,
    plan,
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
      available24x7: isPremium(plan)
    }
  });
});

router.get("/", (_req, res) => {
  const tickets = db.prepare(`
    SELECT *
    FROM tickets
    ORDER BY
      CASE WHEN priority = 'priority' THEN 0 ELSE 1 END,
      created_at DESC
  `).all();

  res.json({ tickets });
});

router.get("/:code", (req, res) => {
  const ticket = db.prepare(`
    SELECT * FROM tickets WHERE ticket_code = ?
  `).get(req.params.code);

  if (!ticket) {
    return res.status(404).json({
      error: "Ticket not found."
    });
  }

  const messages = db.prepare(`
    SELECT *
    FROM ticket_messages
    WHERE ticket_id = ?
    ORDER BY created_at ASC
  `).all((ticket as { id: number }).id);

  res.json({ ticket, messages });
});

router.patch("/:code/status", (req, res) => {
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

router.post("/:code/messages", (req, res) => {
  const { senderId, senderName, senderRole = "support", message } = req.body;

  if (!senderId || !senderName || !message) {
    return res.status(400).json({
      error: "Missing message information."
    });
  }

  const ticket = db.prepare(`
    SELECT id FROM tickets WHERE ticket_code = ?
  `).get(req.params.code) as { id: number } | undefined;

  if (!ticket) {
    return res.status(404).json({
      error: "Ticket not found."
    });
  }

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO ticket_messages
    (ticket_id, sender_id, sender_name, sender_role, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    ticket.id,
    senderId,
    senderName,
    senderRole,
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
