import { Router } from "express";
import { db } from "../db/database.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

const router = Router();

router.get("/", (_req, res) => {
  const announcements = db.prepare(`
    SELECT id, title, message, link, audience, sent_at
    FROM announcements
    WHERE enabled = 1 AND status = 'sent' AND audience = 'all_users'
    ORDER BY sent_at DESC LIMIT 50
  `).all();
  return res.json({ announcements });
});

router.get("/inbox", requireAuth, (req: AuthRequest, res) => {
  const notifications = db.prepare(`
    SELECT n.id, n.announcement_id, n.appeal_id, n.title, n.message,
           n.created_at, n.read_at, a.link
    FROM notifications n
    LEFT JOIN announcements a ON a.id = n.announcement_id
    WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100
  `).all(req.userId);
  return res.json({ notifications });
});

router.patch("/inbox/:id/read", requireAuth, (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid notification ID." });
  }
  const result = db.prepare(`
    UPDATE notifications SET read_at = ?
    WHERE id = ? AND user_id = ? AND read_at IS NULL
  `).run(new Date().toISOString(), id, req.userId);
  if (!result.changes) return res.status(404).json({ error: "Unread notification not found." });
  return res.json({ success: true });
});

export default router;
