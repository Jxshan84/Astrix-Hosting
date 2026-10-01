import { Router } from "express";
import { db } from "../db/database.js";

const router = Router();

function authorized(req: any, res: any) {
  const key = req.headers["x-owner-key"];
  const ownerKey = process.env.OWNER_ADMIN_KEY;

  if (!ownerKey || key !== ownerKey) {
    res.status(401).json({ error: "Owner authorization required." });
    return false;
  }

  return true;
}

router.get("/settings", (_req, res) => {
  const settings = db.prepare(`
    SELECT * FROM site_settings WHERE id = 1
  `).get();

  res.json({ settings });
});

router.patch("/settings", (req, res) => {
  if (!authorized(req, res)) return;

  const {
    supportEnabled,
    workStart,
    workEnd,
    timezone
  } = req.body;

  const current = db.prepare(`
    SELECT * FROM site_settings WHERE id = 1
  `).get() as any;

  db.prepare(`
    UPDATE site_settings
    SET support_enabled = ?,
        work_start = ?,
        work_end = ?,
        timezone = ?
    WHERE id = 1
  `).run(
    supportEnabled === undefined
      ? current.support_enabled
      : supportEnabled ? 1 : 0,
    workStart || current.work_start,
    workEnd || current.work_end,
    timezone || current.timezone
  );

  res.json({
    success: true,
    message: "Support settings updated."
  });
});

router.get("/announcements", (_req, res) => {
  const announcements = db.prepare(`
    SELECT *
    FROM announcements
    ORDER BY created_at DESC
  `).all();

  res.json({ announcements });
});

router.post("/announcements", (req, res) => {
  if (!authorized(req, res)) return;

  const { title, message } = req.body;

  if (!title || !message) {
    return res.status(400).json({
      error: "Title and message are required."
    });
  }

  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO announcements
    (title, message, enabled, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
  `).run(title, message, now, now);

  res.status(201).json({
    success: true,
    announcementId: result.lastInsertRowid
  });
});

router.patch("/announcements/:id", (req, res) => {
  if (!authorized(req, res)) return;

  const { title, message, enabled } = req.body;

  const current = db.prepare(`
    SELECT * FROM announcements WHERE id = ?
  `).get(req.params.id) as any;

  if (!current) {
    return res.status(404).json({
      error: "Announcement not found."
    });
  }

  db.prepare(`
    UPDATE announcements
    SET title = ?,
        message = ?,
        enabled = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    title ?? current.title,
    message ?? current.message,
    enabled === undefined ? current.enabled : enabled ? 1 : 0,
    new Date().toISOString(),
    req.params.id
  );

  res.json({
    success: true
  });
});

export default router;
