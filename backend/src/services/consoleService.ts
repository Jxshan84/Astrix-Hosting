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
    if (!process.stdin.destroyed && process.stdin.writable) {
      process.stdin.write(message.toString());
    }
  });

  ws.on("error", () => {
    if (!process.killed) process.kill();
  });

  ws.on("close", () => {
    if (!process.killed) process.kill();
  });

  process.on("error", (error) => {
    console.error("Console provider process could not start.", error);
    if (ws.readyState === ws.OPEN) {
      ws.send("Console unavailable: the server provider could not start the shell.\n");
      ws.close(1011, "Server provider unavailable");
    }
  });

  process.on("close", () => {
    if (ws.readyState === ws.OPEN) {
      ws.close(1000, "Console process ended");
    }
  });

  ws.send("Connected to Astrix server console.\n");
}
