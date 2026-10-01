import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { WebSocket } from "ws";

export function attachConsole(ws: WebSocket, container: string) {
  const process: ChildProcessWithoutNullStreams = spawn(
    "docker",
    ["exec", "-i", container, "sh"],
    {
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  process.stdout.on("data", (data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data.toString());
    }
  });

  process.stderr.on("data", (data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data.toString());
    }
  });

  ws.on("message", (message) => {
    if (!process.stdin.destroyed) {
      process.stdin.write(message.toString());
    }
  });

  ws.on("close", () => {
    process.kill();
  });

  process.on("close", () => {
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  });

  ws.send("Connected to Astrix server console.\\n");
}
