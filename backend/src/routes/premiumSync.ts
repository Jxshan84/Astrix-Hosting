import { Router } from "express";
import { db } from "../db/database.js";

const router = Router();

const allowedPlans = new Set(["free", "starter", "pro", "premium"]);

router.post("/sync", (req, res) => {
  const expectedKey = process.env.ASTRIX_BOT_SYNC_KEY;

  if (!expectedKey) {
    return res.status(503).json({
      error: "Premium sync is not configured."
    });
  }

  const providedKey = String(req.header("x-astrix-bot-key") || "");

  if (!providedKey || providedKey !== expectedKey) {
    return res.status(401).json({
      error: "Unauthorized."
    });
  }

  const discordId = String(req.body?.discordId || "").trim();
  const plan = String(req.body?.plan || "").trim().toLowerCase();

  if (!discordId || !plan) {
    return res.status(400).json({
      error: "discordId and plan are required."
    });
  }

  if (!allowedPlans.has(plan)) {
    return res.status(400).json({
      error: "Invalid plan."
    });
  }

  const user = db
    .prepare("SELECT id, email, username, discord_id, plan FROM users WHERE discord_id = ?")
    .get(discordId) as
    | {
        id: number;
        email: string;
        username: string;
        discord_id: string | null;
        plan: string;
      }
    | undefined;

  if (!user) {
    return res.status(404).json({
      error: "No hosting account is linked to this Discord ID."
    });
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE users
    SET plan = ?, updated_at = ?
    WHERE discord_id = ?
  `).run(plan, now, discordId);

  return res.json({
    success: true,
    discordId,
    plan,
    previousPlan: user.plan,
    updatedAt: now
  });
});

export default router;
