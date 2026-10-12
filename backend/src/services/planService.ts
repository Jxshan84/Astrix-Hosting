import { db } from "../db/database.js";

export type HostingPlan = "free" | "starter" | "pro" | "premium";

export type PlanLimits = {
  maxServers: number;
  memoryMb: number;
  cpuCores: number;
};

const DEFAULT_PLAN_LIMITS: Record<HostingPlan, PlanLimits> = {
  free: {
    maxServers: 1,
    memoryMb: 512,
    cpuCores: 0.5,
  },
  starter: {
    maxServers: 2,
    memoryMb: 1024,
    cpuCores: 1,
  },
  pro: {
    maxServers: 5,
    memoryMb: 4096,
    cpuCores: 2,
  },
  premium: {
    maxServers: 10,
    memoryMb: 8192,
    cpuCores: 4,
  },
};

export function normalizePlan(value: unknown): HostingPlan {
  const plan = String(value || "free").toLowerCase();

  if (plan === "starter" || plan === "pro" || plan === "premium") {
    return plan;
  }

  return "free";
}

export function getPlanLimits(value: unknown): PlanLimits {
  const plan = normalizePlan(value);
  const configured = db.prepare(`
    SELECT max_servers, memory_mb, cpu_cores FROM plan_limits WHERE plan = ?
  `).get(plan) as {
    max_servers: number;
    memory_mb: number;
    cpu_cores: number;
  } | undefined;
  if (!configured) return DEFAULT_PLAN_LIMITS[plan];
  return {
    maxServers: configured.max_servers,
    memoryMb: configured.memory_mb,
    cpuCores: configured.cpu_cores,
  };
}

export function getAllPlanLimits() {
  const rows = db.prepare(`
    SELECT plan, max_servers, memory_mb, cpu_cores
    FROM plan_limits ORDER BY CASE plan
      WHEN 'free' THEN 0 WHEN 'starter' THEN 1
      WHEN 'pro' THEN 2 ELSE 3 END
  `).all() as Array<{
    plan: HostingPlan;
    max_servers: number;
    memory_mb: number;
    cpu_cores: number;
  }>;
  if (!rows.length) return DEFAULT_PLAN_LIMITS;
  return Object.fromEntries(rows.map((row) => [row.plan, {
    maxServers: row.max_servers,
    memoryMb: row.memory_mb,
    cpuCores: row.cpu_cores,
  }])) as Record<HostingPlan, PlanLimits>;
}
