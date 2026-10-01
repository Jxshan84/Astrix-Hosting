import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PREFIX = "astrix";

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 40);
}

export async function createServer(serverId: string, type = "node") {
  const name = `${PREFIX}-${safeName(serverId)}`;

  const images: Record<string, string> = {
    node: "node:22-alpine",
    python: "python:3.13-alpine",
    bun: "oven/bun:alpine",
    lavalink: "ghcr.io/lavalink-devs/lavalink:4",
    java: "eclipse-temurin:21-jre",
    go: "golang:1-alpine",
    rust: "rust:1-alpine",
    php: "php:8-cli-alpine",
    deno: "denoland/deno:alpine",
    ruby: "ruby:3-alpine",
  };

  const image = images[type] || images.node;

  await execFileAsync("docker", [
    "pull",
    image,
  ]);

  await execFileAsync("docker", [
    "create",
    "--name",
    name,
    "--memory",
    "512m",
    "--cpus",
    "0.5",
    image,
    "sh",
    "-c",
    "while true; do sleep 3600; done",
  ]);

  return {
    id: serverId,
    container: name,
    image,
    status: "created",
  };
}

export async function startServer(serverId: string) {
  const name = `${PREFIX}-${safeName(serverId)}`;
  await execFileAsync("docker", ["start", name]);
  return getServer(serverId);
}

export async function stopServer(serverId: string) {
  const name = `${PREFIX}-${safeName(serverId)}`;
  await execFileAsync("docker", ["stop", name]);
  return getServer(serverId);
}

export async function restartServer(serverId: string) {
  const name = `${PREFIX}-${safeName(serverId)}`;
  await execFileAsync("docker", ["restart", name]);
  return getServer(serverId);
}

export async function removeServer(serverId: string) {
  const name = `${PREFIX}-${safeName(serverId)}`;
  await execFileAsync("docker", ["rm", "-f", name]);
  return { id: serverId, deleted: true };
}

export async function getServer(serverId: string) {
  const name = `${PREFIX}-${safeName(serverId)}`;

  try {
    const { stdout } = await execFileAsync("docker", [
      "inspect",
      "--format",
      "{{.State.Status}}",
      name,
    ]);

    return {
      id: serverId,
      container: name,
      status: stdout.trim(),
    };
  } catch {
    return {
      id: serverId,
      container: name,
      status: "not_found",
    };
  }
}

export async function getLogs(serverId: string) {
  const name = `${PREFIX}-${safeName(serverId)}`;

  const { stdout } = await execFileAsync("docker", [
    "logs",
    "--tail",
    "200",
    name,
  ]);

  return stdout;
}

export async function getStats(serverId: string) {
  const name = `${PREFIX}-${safeName(serverId)}`;

  try {
    const { stdout } = await execFileAsync("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}",
      name,
    ]);

    const [cpu, memory, memoryPercent] = stdout.trim().split("|");

    return {
      cpu: cpu || "0%",
      memory: memory || "0B / 0B",
      memoryPercent: memoryPercent || "0%",
    };
  } catch {
    return {
      cpu: "0%",
      memory: "0B / 0B",
      memoryPercent: "0%",
    };
  }
}
