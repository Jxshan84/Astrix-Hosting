import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PlanLimits } from "./planService.js";

const execFileAsync = promisify(execFile);

const PREFIX = "astrix";
const DATA_PREFIX = `${PREFIX}-data`;

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 40);
}

export const DOCKER_RUNTIMES = [
  { id: "node", name: "Node.js", image: "node:22-alpine" },
  { id: "python", name: "Python", image: "python:3.13-alpine" },
  { id: "bun", name: "Bun", image: "oven/bun:alpine" },
  { id: "lavalink", name: "Lavalink", image: "ghcr.io/lavalink-devs/lavalink:4" },
  { id: "java", name: "Java", image: "eclipse-temurin:21-jre" },
  { id: "go", name: "Go", image: "golang:1-alpine" },
  { id: "rust", name: "Rust", image: "rust:1-alpine" },
  { id: "php", name: "PHP", image: "php:8-cli-alpine" },
  { id: "deno", name: "Deno", image: "denoland/deno:alpine" },
  { id: "ruby", name: "Ruby", image: "ruby:3-alpine" },
] as const;

export type DockerRuntimeId = (typeof DOCKER_RUNTIMES)[number]["id"];

export async function checkDockerConnection() {
  const { stdout } = await execFileAsync("docker", [
    "info",
    "--format",
    "{{.ServerVersion}}|{{.NCPU}}|{{.MemTotal}}",
  ], { timeout: 5000, maxBuffer: 1024 * 1024 });
  const [version, cpuCount, memoryBytes] = stdout.trim().split("|");
  if (!version || !Number.isInteger(Number(cpuCount)) || !Number.isFinite(Number(memoryBytes))) {
    throw new Error("Docker Engine returned incomplete host information.");
  }
  return {
    provider: "docker",
    connected: true,
    version,
    hostCpuCount: Number(cpuCount),
    hostMemoryBytes: Number(memoryBytes),
    allocation: "single-engine",
  };
}

export async function createServer(
  serverId: string,
  type = "node",
  limits: PlanLimits = { memoryMb: 512, cpuCores: 0.5, maxServers: 1 }
) {
  const name = `${PREFIX}-${safeName(serverId)}`;
  const runtime = DOCKER_RUNTIMES.find((item) => item.id === type);
  if (!runtime) throw new Error("Unsupported Docker runtime.");
  const volume = `${DATA_PREFIX}-${safeName(serverId)}`;

  await execFileAsync("docker", ["volume", "create", volume], { timeout: 15_000 });
  try {
    await execFileAsync("docker", ["pull", runtime.image], {
      timeout: 5 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    await execFileAsync("docker", [
      "create",
      "--name",
      name,
      "--memory",
      `${limits.memoryMb}m`,
      "--cpus",
      String(limits.cpuCores),
      "--mount",
      `type=volume,source=${volume},target=/home/container`,
      "--workdir",
      "/home/container",
      "--entrypoint",
      "/bin/sh",
      runtime.image,
      "-c",
      "while true; do sleep 3600; done",
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  } catch (error) {
    await execFileAsync("docker", ["rm", "-f", name], { timeout: 15_000 }).catch(() => undefined);
    await execFileAsync("docker", ["volume", "rm", volume], { timeout: 15_000 }).catch(() => undefined);
    throw error;
  }

  return {
    id: serverId,
    container: name,
    image: runtime.image,
    volume,
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
  const volume = `${DATA_PREFIX}-${safeName(serverId)}`;
  try {
    await execFileAsync("docker", ["volume", "rm", volume]);
  } catch (error) {
    const details = error instanceof Error && "stderr" in error
      ? String(error.stderr)
      : error instanceof Error ? error.message : String(error);
    if (!/no such volume|volume .* not found/i.test(details)) throw error;
  }
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
  } catch (error) {
    const details =
      error instanceof Error && "stderr" in error
        ? String(error.stderr)
        : error instanceof Error
          ? error.message
          : String(error);

    if (!/no such (object|container)/i.test(details)) {
      throw error;
    }

    return {
      id: serverId,
      container: name,
      status: "missing",
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

export async function getStats(serverId: string): Promise<{
  cpu: string | null;
  memory: string | null;
  memoryPercent: string | null;
}> {
  const name = `${PREFIX}-${safeName(serverId)}`;

  const { stdout } = await execFileAsync("docker", [
    "stats",
    "--no-stream",
    "--format",
    "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}",
    name,
  ]);

  if (!stdout.trim()) {
    return { cpu: null, memory: null, memoryPercent: null };
  }

  const [cpu, memory, memoryPercent] = stdout.trim().split("|");
  if (!cpu || !memory || !memoryPercent) {
    throw new Error(`Docker returned invalid stats for server ${serverId}.`);
  }
  return {
    cpu,
    memory,
    memoryPercent,
  };
}
