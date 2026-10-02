export type HostingPlan = "free" | "starter" | "pro" | "premium";

export type PlanLimits = {
  maxServers: number;
  memoryMb: number;
  cpuCores: number;
};

const PLAN_LIMITS: Record<HostingPlan, PlanLimits> = {
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
  return PLAN_LIMITS[normalizePlan(value)];
}

export function getAllPlanLimits() {
  return PLAN_LIMITS;
}
