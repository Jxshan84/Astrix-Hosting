import { Router, raw, type Response } from "express";
import crypto from "node:crypto";
import {
  rateLimitUserAction,
  requireAuth,
  requireUnrestrictedAccount,
  type AuthRequest,
} from "../middleware/auth.js";
import { db } from "../db/database.js";
import { getPlanLimits } from "../services/planService.js";
import { recordAudit } from "../services/audit.js";
import { MAX_UPLOAD_BYTES, validateFilePath } from "../services/dockerFileService.js";
import { serverProvider, type ServerProvider } from "../services/serverProvider.js";

const allowedUploadTypes = new Set([
  "application/octet-stream",
  "application/json",
  "application/javascript",
  "application/pdf",
  "application/zip",
  "application/gzip",
  "image/jpeg",
  "image/png",
  "text/css",
  "text/csv",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/xml",
]);

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

function fileOperationError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Server file operation failed.";
  if (error instanceof TypeError || error instanceof RangeError) {
    return res.status(400).json({ error: message });
  }
  if (/already exists|explicit overwrite/i.test(message)) {
    return res.status(409).json({ error: message });
  }
  if (/not found/i.test(message)) {
    return res.status(404).json({ error: message });
  }
  console.error("Docker server file operation failed.", error);
  return res.status(503).json({ error: "The server file operation could not be completed." });
}

async function ownedRunningServer(req: AuthRequest, res: Response, provider: ServerProvider) {
  const server = getOwnedServer(req, String(req.params.id));
  if (!server) {
    res.status(404).json({ error: "Server not found." });
    return null;
  }
  const state = await provider.status(server.id);
  if (state.status !== "running") {
    res.status(409).json({ error: "Start the server before managing its files." });
    return null;
  }
  return server;
}

export function createServerRouter(provider: ServerProvider = serverProvider) {
  const router = Router();
  router.use(requireAuth, requireUnrestrictedAccount);

router.get("/catalog", async (req: AuthRequest, res) => {
  if (!req.userId) return res.status(401).json({ error: "Authentication required." });
  const [providerStatus, planLimits] = await Promise.all([
    provider.checkConnection(),
    Promise.resolve(getPlanLimits(req.userPlan)),
  ]);
  const count = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM servers WHERE owner_user_id = ?) +
      (SELECT COUNT(*) FROM server_allocations WHERE owner_user_id = ?) AS count
  `).get(req.userId, req.userId) as { count: number };
  return res.json({
    provider: {
      id: provider.id,
      connected: providerStatus.connected,
      error: providerStatus.connected ? null : "Server provider is not connected.",
      allocation: providerStatus.allocation ?? "manual",
    },
    runtimes: provider.supportedRuntimes().map(({ id, name }) => ({ id, name })),
    planName: String(req.userPlan || "free").toLowerCase(),
    plan: planLimits,
    slots: { used: count.count, limit: planLimits.maxServers },
    locations: null,
    nodes: null,
  });
});

router.get("/", async (req: AuthRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
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

    const servers = await Promise.all(
      rows.map(async (server) => {
        const docker = await provider.status(server.id);
        const stats =
          docker.status === "running" ? await provider.stats(server.id) : null;

        return {
          id: server.id,
          name: server.name,
          type: server.type,
          createdAt: server.created_at,
          status: docker.status,
          stats,
        };
      })
    );

    return res.json({ servers });
  } catch (error) {
    console.error("Failed to list servers:", error);
    return res.status(503).json({ error: "Unable to read server status." });
  }
});

router.get("/:id/files", rateLimitUserAction("server_file_read"), async (req: AuthRequest, res) => {
  try {
    const server = await ownedRunningServer(req, res, provider);
    if (!server) return;
    const directory = typeof req.query.path === "string" ? req.query.path : "";
    validateFilePath(directory, true);
    const files = await provider.files.listFiles(server.id, directory);
    return res.json({ path: directory, files });
  } catch (error) {
    return fileOperationError(res, error);
  }
});

router.get("/:id/files/content", rateLimitUserAction("server_file_read"), async (req: AuthRequest, res) => {
  try {
    const server = await ownedRunningServer(req, res, provider);
    if (!server) return;
    if (typeof req.query.path !== "string") {
      return res.status(400).json({ error: "A relative file path is required." });
    }
    const content = await provider.files.readTextFile(server.id, req.query.path);
    return res.json({ path: req.query.path, content });
  } catch (error) {
    return fileOperationError(res, error);
  }
});

router.get("/:id/files/download", rateLimitUserAction("server_file_read"), async (req: AuthRequest, res) => {
  try {
    const server = await ownedRunningServer(req, res, provider);
    if (!server) return;
    if (typeof req.query.path !== "string") {
      return res.status(400).json({ error: "A relative file path is required." });
    }
    const content = await provider.files.downloadFile(server.id, req.query.path);
    const fileName = req.query.path.split("/").at(-1) || "server-file";
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader("Content-Length", content.length);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(content);
  } catch (error) {
    return fileOperationError(res, error);
  }
});

router.post("/:id/files/folder", rateLimitUserAction("server_file_write"), async (req: AuthRequest, res) => {
  try {
    const server = await ownedRunningServer(req, res, provider);
    if (!server) return;
    const path = req.body?.path;
    if (typeof path !== "string") return res.status(400).json({ error: "A relative folder path is required." });
    await provider.files.createDirectory(server.id, path);
    recordAudit("server.file_directory_created", req.userId ?? null, null, {
      serverId: server.id,
      path,
    });
    return res.status(201).json({ success: true });
  } catch (error) {
    return fileOperationError(res, error);
  }
});

router.post("/:id/files/file", rateLimitUserAction("server_file_write"), async (req: AuthRequest, res) => {
  try {
    const server = await ownedRunningServer(req, res, provider);
    if (!server) return;
    const { path, content, overwrite } = req.body || {};
    if (
      typeof path !== "string" ||
      typeof content !== "string" ||
      (overwrite !== undefined && typeof overwrite !== "boolean")
    ) {
      return res.status(400).json({ error: "A relative file path and text content are required." });
    }
    await provider.files.writeTextFile(
      server.id,
      path,
      content,
      overwrite === true
    );
    recordAudit("server.file_created_or_edited", req.userId ?? null, null, {
      serverId: server.id,
      path,
      byteLength: Buffer.byteLength(content, "utf8"),
      overwritten: overwrite === true,
    });
    return res.json({ success: true });
  } catch (error) {
    return fileOperationError(res, error);
  }
});

router.post(
  "/:id/files/upload",
  rateLimitUserAction("server_file_write"),
  raw({ type: "application/octet-stream", limit: MAX_UPLOAD_BYTES }),
  async (req: AuthRequest, res) => {
    try {
      const server = await ownedRunningServer(req, res, provider);
      if (!server) return;
      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({ error: "Upload a file as application/octet-stream." });
      }
      const path = req.get("x-file-path");
      if (!path) return res.status(400).json({ error: "A relative destination file path is required." });
      if (!req.body.length) return res.status(400).json({ error: "Empty uploads are not accepted." });
      const contentType = req.get("x-file-content-type") || "application/octet-stream";
      if (!allowedUploadTypes.has(contentType)) {
        return res.status(415).json({ error: "This upload file type is not supported." });
      }
      const overwrite = req.get("x-confirm-overwrite") === "true";
      await provider.files.writeFile(server.id, path, req.body, overwrite);
      recordAudit("server.file_uploaded", req.userId ?? null, null, {
        serverId: server.id,
        path,
        byteLength: req.body.length,
        contentType,
        overwritten: overwrite,
      });
      return res.status(201).json({ success: true });
    } catch (error) {
      return fileOperationError(res, error);
    }
  }
);

router.patch("/:id/files/move", rateLimitUserAction("server_file_write"), async (req: AuthRequest, res) => {
  try {
    const server = await ownedRunningServer(req, res, provider);
    if (!server) return;
    const { fromPath, toPath, overwrite } = req.body || {};
    if (
      typeof fromPath !== "string" ||
      typeof toPath !== "string" ||
      (overwrite !== undefined && typeof overwrite !== "boolean")
    ) {
      return res.status(400).json({ error: "A source and destination relative path are required." });
    }
    await provider.files.renamePath(server.id, fromPath, toPath, overwrite === true);
    recordAudit("server.file_moved", req.userId ?? null, null, {
      serverId: server.id,
      fromPath,
      toPath,
      overwritten: overwrite === true,
    });
    return res.json({ success: true });
  } catch (error) {
    return fileOperationError(res, error);
  }
});

router.delete("/:id/files", rateLimitUserAction("server_file_write"), async (req: AuthRequest, res) => {
  try {
    const server = await ownedRunningServer(req, res, provider);
    if (!server) return;
    if (req.body?.confirm !== true || typeof req.query.path !== "string") {
      return res.status(400).json({ error: "Confirm deletion and provide a relative file path." });
    }
    await provider.files.deletePath(server.id, req.query.path);
    recordAudit("server.file_deleted", req.userId ?? null, null, {
      serverId: server.id,
      path: req.query.path,
    });
    return res.json({ success: true });
  } catch (error) {
    return fileOperationError(res, error);
  }
});

router.post("/", rateLimitUserAction("server_create"), async (req: AuthRequest, res) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: "Authentication required." });
    }
    const ownerUserId = req.userId;

    const name = String(req.body?.name || "").trim();
    const type = String(req.body?.type || "node").toLowerCase();

    if (!name) {
      return res.status(400).json({ error: "Server name is required." });
    }

    if (name.length > 48) {
      return res.status(400).json({ error: "Server name must be 48 characters or fewer." });
    }

    if (!provider.supportedRuntimes().some((runtime) => runtime.id === type)) {
      return res.status(400).json({ error: "Unsupported server type." });
    }

    const providerStatus = await provider.checkConnection();
    if (
      !providerStatus.connected ||
      typeof providerStatus.hostCpuCount !== "number" ||
      !Number.isSafeInteger(providerStatus.hostCpuCount) ||
      providerStatus.hostCpuCount <= 0 ||
      typeof providerStatus.hostMemoryBytes !== "number" ||
      !Number.isFinite(providerStatus.hostMemoryBytes) ||
      providerStatus.hostMemoryBytes <= 0
    ) {
      return res.status(503).json({
        error: "The server provider is unavailable or has not reported host capacity.",
      });
    }
    const hostCpuLimit = providerStatus.hostCpuCount * 0.8;
    const hostMemoryLimitMb = Math.floor(providerStatus.hostMemoryBytes / (1024 * 1024) * 0.8);

    const id = crypto.randomUUID();
    const reserve = db.transaction(() => {
      const planLimits = getPlanLimits(req.userPlan);
      const count = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM servers WHERE owner_user_id = ?) +
          (SELECT COUNT(*) FROM server_allocations WHERE owner_user_id = ?) AS count
      `).get(ownerUserId, ownerUserId) as { count: number };
      if (count.count >= planLimits.maxServers) {
        throw new Error("PLAN_LIMIT");
      }
      const allocated = db.prepare(`
        SELECT
          COALESCE((SELECT SUM(allocated_memory_mb) FROM servers), 0) +
            COALESCE((SELECT SUM(memory_mb) FROM server_allocations), 0) AS memory_mb,
          COALESCE((SELECT SUM(allocated_cpu_cores) FROM servers), 0) +
            COALESCE((SELECT SUM(cpu_cores) FROM server_allocations), 0) AS cpu_cores
      `).get() as { memory_mb: number; cpu_cores: number };
      if (
        allocated.memory_mb + planLimits.memoryMb > hostMemoryLimitMb ||
        allocated.cpu_cores + planLimits.cpuCores > hostCpuLimit
      ) {
        throw new Error("HOST_CAPACITY");
      }
      db.prepare(`
        INSERT INTO server_allocations
          (server_id, owner_user_id, created_at, memory_mb, cpu_cores)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, ownerUserId, new Date().toISOString(), planLimits.memoryMb, planLimits.cpuCores);
      return planLimits;
    }).immediate();

    let docker: Awaited<ReturnType<typeof provider.create>> | undefined;
    try {
      docker = await provider.create(id, type, reserve);
      const createdContainer = docker;
      const createdAt = new Date().toISOString();
      const save = db.transaction(() => {
        db.prepare(`
          INSERT INTO servers (
            id, owner_user_id, name, type, container_name, created_at,
            allocated_memory_mb, allocated_cpu_cores
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          ownerUserId,
          name,
          type,
          createdContainer.container,
          createdAt,
          reserve.memoryMb,
          reserve.cpuCores
        );
        db.prepare("DELETE FROM server_allocations WHERE server_id = ?").run(id);
        recordAudit("server.created", ownerUserId, null, {
          serverId: id,
          runtime: type,
          planMemoryMb: reserve.memoryMb,
          planCpuCores: reserve.cpuCores,
        });
      });
      save();

      return res.status(201).json({
        server: { id, name, type, createdAt },
        docker,
      });
    } catch (error) {
      let resourceConfirmedMissing = false;
      if (docker) {
        try {
          await provider.remove(id);
          resourceConfirmedMissing = true;
        } catch (cleanupError) {
          console.error("Failed to clean up an uncommitted Docker server allocation.", cleanupError);
        }
      } else {
        try {
          resourceConfirmedMissing = (await provider.status(id)).status === "missing";
        } catch (inspectionError) {
          console.error("Unable to verify a failed server allocation with the provider.", inspectionError);
        }
      }
      if (resourceConfirmedMissing) {
        db.prepare("DELETE FROM server_allocations WHERE server_id = ?").run(id);
      } else {
        recordAudit("server.allocation_retained_after_failure", ownerUserId, null, {
          serverId: id,
          reason: "provider_resource_not_confirmed_missing",
        });
      }
      if (error instanceof Error && error.message === "PLAN_LIMIT") {
        const planLimits = getPlanLimits(req.userPlan);
        return res.status(403).json({
          error: `Your plan allows up to ${planLimits.maxServers} server${planLimits.maxServers === 1 ? "" : "s"}.`,
        });
      }
      const providerStatus = await provider.checkConnection();
      console.error("Server provider operation failed.", error);
      return res.status(providerStatus.connected ? 500 : 503).json({
        error: providerStatus.connected
          ? "The server provider could not create this server."
          : "The server provider is unavailable. Contact the hosting administrator.",
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_LIMIT") {
      const planLimits = getPlanLimits(req.userPlan);
      return res.status(403).json({
        error: `Your plan allows up to ${planLimits.maxServers} server${planLimits.maxServers === 1 ? "" : "s"}.`,
      });
    }
    if (error instanceof Error && error.message === "HOST_CAPACITY") {
      return res.status(409).json({
        error: "The provider host has insufficient unallocated CPU or memory for this server.",
      });
    }
    console.error("Server allocation failed.", error);
    res.status(503).json({ error: "Server allocation could not be completed." });
  }
});

router.get("/:id", async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    const docker = await provider.status(server.id);
    const stats =
      docker.status === "running" ? await provider.stats(server.id) : null;

    res.json({
      server: {
        id: server.id,
        name: server.name,
        type: server.type,
        createdAt: server.createdAt,
      },
      docker,
      stats,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to get server." });
  }
});

router.post("/:id/start", rateLimitUserAction("server_lifecycle"), async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    const result = await provider.start(server.id);
    recordAudit("server.started", req.userId ?? null, null, { serverId: server.id });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to start server." });
  }
});

router.post("/:id/stop", rateLimitUserAction("server_lifecycle"), async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    const result = await provider.stop(server.id);
    recordAudit("server.stopped", req.userId ?? null, null, { serverId: server.id });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to stop server." });
  }
});

router.post("/:id/restart", rateLimitUserAction("server_lifecycle"), async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    const result = await provider.restart(server.id);
    recordAudit("server.restarted", req.userId ?? null, null, { serverId: server.id });
    res.json(result);
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

    const docker = await provider.status(server.id);
    if (docker.status !== "running") {
      return res.status(409).json({
        error: "Resource usage is only available while the server is running.",
      });
    }

    res.json(await provider.stats(server.id));
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
      logs: await provider.logs(server.id),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to get server logs." });
  }
});

router.delete("/:id", rateLimitUserAction("server_lifecycle"), async (req: AuthRequest, res) => {
  try {
    const server = getOwnedServer(req, String(req.params.id));

    if (!server) {
      return res.status(404).json({ error: "Server not found." });
    }

    await provider.remove(server.id);

    db.prepare(`
      DELETE FROM servers
      WHERE id = ? AND owner_user_id = ?
    `).run(server.id, req.userId);

    recordAudit("server.deleted", req.userId ?? null, null, { serverId: server.id });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete server." });
  }
});

  return router;
}

export default createServerRouter();
