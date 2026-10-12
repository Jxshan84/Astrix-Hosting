import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../db/database.js";
import { recordAudit } from "./audit.js";

const execFileAsync = promisify(execFile);

const PREFIX = "astrix";
const CHECK_INTERVAL = 20_000;
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
    const settings = db.prepare(`
      SELECT automation_enabled, overload_cpu_threshold,
             overload_memory_threshold, overload_required_strikes
      FROM security_settings WHERE id = 1
    `).get() as {
      automation_enabled: number;
      overload_cpu_threshold: number;
      overload_memory_threshold: number;
      overload_required_strikes: number;
    } | undefined;
    if (!settings?.automation_enabled) {
      strikes.clear();
      return;
    }

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
        cpu >= settings.overload_cpu_threshold ||
        memory.percent >= settings.overload_memory_threshold;

      if (!overloaded) {
        strikes.delete(name);
        continue;
      }

      const nextStrike = (strikes.get(name) || 0) + 1;
      strikes.set(name, nextStrike);

      console.warn(
        `[OVERLOAD] ${name} CPU=${cpu.toFixed(1)}% RAM=${memory.percent.toFixed(1)}% strike=${nextStrike}/${settings.overload_required_strikes}`
      );

      if (nextStrike < settings.overload_required_strikes) continue;

      console.error(
        `[OVERLOAD] Stopping ${name} after sustained resource overload.`
      );

      let stopped = false;
      try {
        await execFileAsync("docker", ["stop", name]);
        console.log(`[OVERLOAD] ${name} stopped successfully.`);
        stopped = true;
      } catch (error) {
        console.error(`[OVERLOAD] Failed to stop ${name}:`, error);
      }

      try {
        const owner = db.prepare(`
          SELECT owner_user_id FROM servers WHERE container_name = ?
        `).get(name) as { owner_user_id: number } | undefined;
        const now = new Date().toISOString();
        const incident = db.prepare(`
          INSERT INTO security_incidents
            (incident_type, actor_user_id, evidence_ref, action_taken, created_at)
          VALUES ('resource_overload', ?, ?, ?, ?)
        `).run(
          owner?.owner_user_id ?? null,
          `container:${name}:cpu:${cpu.toFixed(1)}:memory:${memory.percent.toFixed(1)}`,
          stopped
            ? "server_stopped_after_sustained_overload"
            : "overload_stop_failed_owner_review",
          now
        );
        recordAudit(stopped ? "security.overload_stop" : "security.overload_stop_failed", null, owner?.owner_user_id ?? null, {
          incidentId: Number(incident.lastInsertRowid),
          container: name,
          cpuPercent: cpu,
          memoryPercent: memory.percent,
        });
      } catch (error) {
        console.error(`[OVERLOAD] Failed to record incident for ${name}:`, error);
      }

      strikes.delete(name);
    }
  } catch (error) {
    console.error("[OVERLOAD] Monitor check failed:", error);
  }
}

export function startOverloadMonitor() {
  console.log("[OVERLOAD] Monitor enabled; limits are owner-configured.");

  void checkOverload();

  const timer = setInterval(() => {
    void checkOverload();
  }, CHECK_INTERVAL);
  timer.unref();
  return () => clearInterval(timer);
}
