import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import jwt from "jsonwebtoken";
import { WebSocketServer } from "ws";

import ticketsRouter from "./routes/tickets.js";
import adminRouter from "./routes/admin.js";
import authRouter from "./routes/auth.js";
import discordRouter from "./routes/discord.js";
import serversRouter from "./routes/servers.js";
import consoleRouter from "./routes/console.js";
import { attachConsole } from "./services/consoleService.js";
import { startOverloadMonitor } from "./services/overloadService.js";
import "./db/database.js";

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "Astrix Hosting Support",
    owner: process.env.OWNER_NAME,
  });
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

const server = createServer(app);

const wss = new WebSocketServer({ noServer: true });

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
  const jwtSecret = process.env.JWT_SECRET || "development-secret";

  if (!token) {
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

    wss.handleUpgrade(request, socket, head, (ws) => {
      attachConsole(ws, `astrix-${serverId}`);
    });
  } catch {
    socket.destroy();
  }
});

startOverloadMonitor();

server.listen(port, () => {
  console.log(`Astrix Hosting Support API running on port ${port}`);
  console.log(`Astrix live console WebSocket ready on /ws/console/:serverId`);
});
