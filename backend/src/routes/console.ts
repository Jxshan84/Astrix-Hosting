import { Router } from "express";
import jwt from "jsonwebtoken";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { db } from "../db/database.js";

const router = Router();
const jwtSecret = process.env.JWT_SECRET || "development-secret";

router.get("/token/:serverId", requireAuth, (req: AuthRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const serverId = String(req.params.serverId);

  const server = db
    .prepare(`
      SELECT id
      FROM servers
      WHERE id = ? AND owner_user_id = ?
    `)
    .get(serverId, req.userId);

  if (!server) {
    return res.status(404).json({ error: "Server not found." });
  }

  const token = jwt.sign(
    {
      type: "console",
      userId: req.userId,
      serverId,
    },
    jwtSecret,
    { expiresIn: "60s" }
  );

  res.json({ token });
});

export default router;
