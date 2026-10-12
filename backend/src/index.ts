import "dotenv/config";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { WebSocketServer } from "ws";
import { frontendUrl, jwtSecret } from "./config.js";

import ticketsRouter from "./routes/tickets.js";
import adminRouter from "./routes/admin.js";
import authRouter from "./routes/auth.js";
import discordRouter from "./routes/discord.js";
import serversRouter from "./routes/servers.js";
import consoleRouter from "./routes/console.js";
import premiumSyncRouter from "./routes/premiumSync.js";
import appealsRouter from "./routes/appeals.js";
import announcementsRouter from "./routes/announcements.js";
import botRouter from "./routes/bot.js";
import welcomeRouter from "./routes/welcome.js";
import { attachConsole } from "./services/consoleService.js";
import { startOverloadMonitor } from "./services/overloadService.js";
import { db } from "./db/database.js";
import { checkDockerConnection } from "./services/dockerService.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || "0.0.0.0";
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}
function configuredCorsOrigins() {
  return (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        throw new Error("CORS_ORIGINS must contain exact HTTP(S) origins.");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.origin !== origin ||
        (process.env.NODE_ENV === "production" && url.protocol !== "https:")
      ) {
        throw new Error("CORS_ORIGINS must contain secure exact origins in production.");
      }
      return url.origin;
    });
}
const allowedOrigins = new Set([
  frontendUrl,
  ...configuredCorsOrigins(),
]);

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS."));
    },
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    status: "alive",
    service: "Astrix Hosting Support",
  });
});

app.get("/health/ready", async (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    const provider = await checkDockerConnection();
    return res.json({
      ok: true,
      status: "ready",
      service: "Astrix Hosting API",
      provider: { id: provider.provider, connected: true },
    });
  } catch {
    return res.status(503).json({
      ok: false,
      status: "not_ready",
      service: "Astrix Hosting API",
      provider: { id: "docker", connected: false },
    });
  }
});

app.get("/api/support/info", (_req, res) => {
  res.json({
    owner: {
      name: process.env.OWNER_NAME,
      discord: process.env.OWNER_DISCORD,
      email: process.env.OWNER_EMAIL,
      supportDiscord: process.env.SUPPORT_DISCORD,
    },
    support: {
      workStart: process.env.SUPPORT_WORK_START,
      workEnd: process.env.SUPPORT_WORK_END,
      timezone: process.env.SUPPORT_TIMEZONE,
      premium24x7: true,
      prioritySupport: true,
    },
  });
});

app.use("/api/tickets", ticketsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/auth", authRouter);
app.use("/api/auth", discordRouter);
app.use("/api/servers", serversRouter);
app.use("/api/console", consoleRouter);
app.use("/api/premium", premiumSyncRouter);
app.use("/api/appeals", appealsRouter);
app.use("/api/announcements", announcementsRouter);
app.use("/api/bot", botRouter);
app.use("/api/welcome", welcomeRouter);

app.use("/api", (_req, res) => {
  return res.status(404).json({ error: "API endpoint not found." });
});

app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (error.message === "Origin is not allowed by CORS.") {
    console.warn("Rejected request from an unconfigured CORS origin.");
    return res.status(403).json({ error: "Origin is not allowed." });
  }
  console.error("Unhandled API request error.", error);
  if (error.status === 413) {
    return res.status(413).json({ error: "Request payload is too large." });
  }
  if (error.status === 400) {
    return res.status(400).json({ error: "Invalid request payload." });
  }
  return res.status(500).json({ error: "Internal server error." });
});

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(
    request.url || "/",
    `http://${request.headers.host || "localhost"}`
  );

  const match = url.pathname.match(/^\/ws\/console\/([^/]+)$/);

  if (!match) {
    socket.destroy();
    return;
  }

  const serverId = match[1];
  const token = url.searchParams.get("token");
  const origin = request.headers.origin;

  if (!token || (origin && !allowedOrigins.has(origin))) {
    socket.destroy();
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as {
      type?: string;
      userId?: number;
      serverId?: string;
    };

    if (
      payload.type !== "console" ||
      payload.serverId !== serverId ||
      !payload.userId
    ) {
      socket.destroy();
      return;
    }

    const ownedServer = db
      .prepare("SELECT id FROM servers WHERE id = ? AND owner_user_id = ?")
      .get(serverId, payload.userId);

    const activeRestriction = db.prepare(`
      SELECT 1 FROM account_restrictions
      WHERE user_id = ? AND revoked_at IS NULL
        AND (restriction_type = 'permanent' OR expires_at > ?)
      LIMIT 1
    `).get(payload.userId, new Date().toISOString());

    if (!ownedServer || activeRestriction) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      attachConsole(ws, `astrix-${serverId}`);
    });
  } catch {
    socket.destroy();
  }
});

const stopOverloadMonitor = startOverloadMonitor();

server.listen(port, host, () => {
  console.log(`Astrix Hosting Support API running on ${host}:${port}`);
  console.log(`Astrix live console WebSocket ready on /ws/console/:serverId`);
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; draining API and console connections.`);
  stopOverloadMonitor();
  for (const client of wss.clients) client.close(1001, "Server shutting down");
  const forceClose = setTimeout(() => {
    for (const client of wss.clients) client.terminate();
    server.closeAllConnections();
  }, 8_000);
  forceClose.unref();
  server.close((error) => {
    clearTimeout(forceClose);
    if (error) console.error("HTTP server shutdown failed.", error);
    db.close();
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
