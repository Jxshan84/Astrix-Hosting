import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PREFIX = "astrix";
const CHECK_INTERVAL = 20_000;
const REQUIRED_STRIKES = 3;
const MEMORY_LIMIT = 92;
const CPU_LIMIT = 95;

const strikes = new Map<string, number>();

function toMiB(value: string): number {
  const match = value.trim().match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) return 0;

  const amount = Number(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1 / 1024 / 1024,
    KB: 1 / 1024,
    KIB: 1 / 1024,
    MB: 1,
    MIB: 1,
    GB: 1024,
    GIB: 1024,
    TB: 1024 * 1024,
    TIB: 1024 * 1024,
  };

  return amount * (multipliers[unit] ?? 1);
}

function parseMemory(value: string) {
  const [usedRaw, limitRaw] = value.split("/").map((part) => part.trim());

  const used = toMiB(usedRaw);
  const limit = toMiB(limitRaw);

  const percent = limit > 0 ? (used / limit) * 100 : 0;

  return { used, limit, percent };
}

async function checkOverload() {
  try {
    const { stdout } = await execFileAsync("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}",
    ]);

    const running = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of running) {
      const [name, cpuRaw, memoryRaw] = line.split("|");

      if (!name?.startsWith(`${PREFIX}-`)) continue;

      const cpu = Number.parseFloat(cpuRaw?.replace("%", "") || "0");
      const memory = parseMemory(memoryRaw || "");
      const overloaded =
        cpu >= CPU_LIMIT || memory.percent >= MEMORY_LIMIT;

      if (!overloaded) {
        strikes.delete(name);
        continue;
      }

      const nextStrike = (strikes.get(name) || 0) + 1;
      strikes.set(name, nextStrike);

      console.warn(
        `[OVERLOAD] ${name} CPU=${cpu.toFixed(1)}% RAM=${memory.percent.toFixed(1)}% strike=${nextStrike}/${REQUIRED_STRIKES}`
      );

      if (nextStrike < REQUIRED_STRIKES) continue;

      console.error(
        `[OVERLOAD] Stopping ${name} after sustained resource overload.`
      );

      try {
        await execFileAsync("docker", ["stop", name]);
        console.log(`[OVERLOAD] ${name} stopped successfully.`);
      } catch (error) {
        console.error(`[OVERLOAD] Failed to stop ${name}:`, error);
      }

      strikes.delete(name);
    }
  } catch (error) {
    console.error("[OVERLOAD] Monitor check failed:", error);
  }
}

export function startOverloadMonitor() {
  console.log(
    `[OVERLOAD] Monitor enabled: RAM ${MEMORY_LIMIT}% / CPU ${CPU_LIMIT}%`
  );

  void checkOverload();

  setInterval(() => {
    void checkOverload();
  }, CHECK_INTERVAL);
}
