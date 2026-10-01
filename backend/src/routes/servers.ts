import { Router } from "express";
import crypto from "node:crypto";
import {
  createServer,
  startServer,
  stopServer,
  restartServer,
  removeServer,
  getServer,
  getLogs,
  getStats,
} from "../services/dockerService.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { db } from "../db/database.js";

const router = Router();
router.use(requireAuth);

type ServerRecord = {
  id: string;
  ownerId: number;
  name: string;
  type: string;
  containerName: string;
  createdAt: string;
};

function getOwnedServer(req: AuthRequest, id: string): ServerRecord | null {
  if (!req.userId) return null;

  const row = db
    .prepare(`
      SELECT
        id,
        owner_user_id,
        name,
        type,
        container_name,
        created_at
      FROM servers
      WHERE id = ? AND owner_user_id = ?
    `)
    .get(id, req.userId) as
    | {
        id: string;
        owner_user_id: number;
        name: string;
        type: string;
        container_name: string;
        created_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    ownerId: row.owner_user_id,
    name: row.name,
    type: row.type,
    containerName: row.container_name,
    createdAt: row.created_at,
  };
}

router.get("/", (req: AuthRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  const rows = db
    .prepare(`
      SELECT
        id,
        name,
        type,
        created_at
      FROM servers
      WHERE owner_user_id = ?
      ORDER BY created_at DESC
    `)
    .all(req.userId) as Array<{
    id: string;
    name: string;
    type: string;
    created_at: string;
  }>;

  res.json({
    servers: rows.map((server) => ({
      id: server.id,
      name: server.name,
      type: server.type,
      createdAt: server.created_at,
    })),
  });
});

router.post("/", async (req: AuthRequest, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Authentication required." });
    }

    const name = String(req.body?.name || "").trim();
    const type = String(req.body?.type || "node").toLowerCase();

    if (!name) {
      return res.status(400).json({ error: "Server name is required." });
    }

    if (!["node", "python", "bun", "lavalink", "java", "go", "rust", "php", "deno", "ruby"].includes(type)) {
      return res.status(400).json({ error: "Unsupported server type." });
    }

    const id = crypto.randomUUID();
    const docker = await createServer(id, type);

    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO servers (
        id,
        owner_user_id,
        name,
        type,
        container_name,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.userId,
      name,
      type,
      docker.container,
      createdAt
    );

    res.status(201).json({
      server: {
        id,
        name,
        type,
        createdAt,
      },
      docker,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create server." });
  }
});

router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    const docker = await getServer(server.id);

    res.json({
      server: {
        id: server.id,
        name: server.name,
        type: server.type,
        createdAt: server.createdAt,
      },
      docker,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to get server." });
  }
});

router.post("/:id/start", async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    res.json(await startServer(server.id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to start server." });
  }
});

router.post("/:id/stop", async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    res.json(await stopServer(server.id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to stop server." });
  }
});

router.post("/:id/restart", async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    res.json(await restartServer(server.id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to restart server." });
  }
});

router.get("/:id/stats", async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    res.json(await getStats(server.id));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to get server stats." });
  }
});

router.get("/:id/logs", async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    res.json({
      logs: await getLogs(server.id),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to get server logs." });
  }
});

router.delete("/:id", async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    await removeServer(server.id);

    db.prepare(`
      DELETE FROM servers
      WHERE id = ? AND owner_user_id = ?
    `).run(server.id, req.userId);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete server." });
  }
});

export default router;
