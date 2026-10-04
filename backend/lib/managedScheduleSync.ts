type ScheduleSync = { synced: number; deleted: number; paused: boolean };
type ScheduleStatus = { active: boolean; nextRunAt: string | null;
  analysisProviderStatus?: "available" | "unavailable" | "unknown";
  markets: { market: string; exists: boolean; paused: boolean; nextRunAt: string | null }[];
  recentChecks?: { market: string; workflowId: string; startedAt: string;
    status: string; reason: string | null }[] };

/** Mobile's local Next server can reach the agent API; cloud Convex cannot call localhost. */
export async function syncManagedSchedule(assignmentId: string, expectActive: boolean): Promise<ScheduleSync> {
  if (!/^[a-z0-9]{20,40}$/.test(assignmentId)) throw new Error("Managed assignment ID is invalid.");
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) throw new Error("The local agent scheduler is not configured.");
  const backend = (process.env.AGENT_API_URL ?? "http://127.0.0.1:9100").replace(/\/$/, "");
  const response = await fetch(`${backend}/v1/schedules/managed-sync`, {
    method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ assignment_id: assignmentId }), cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => null) as ScheduleSync | null;
  if (!response.ok || !result || !Number.isInteger(result.synced)
      || !Number.isInteger(result.deleted) || typeof result.paused !== "boolean") {
    throw new Error("The local agent scheduler did not confirm the change.");
  }
  if (expectActive && (result.synced < 1 || result.paused)) {
    throw new Error(result.paused ? "Market checks are paused by Manual Guard."
      : "The agent scheduler did not create a market check.");
  }
  if (!expectActive && result.synced !== 0) {
    throw new Error("The agent scheduler still reports active market checks.");
  }
  return result;
}

export async function readManagedSchedule(assignmentId: string): Promise<ScheduleStatus> {
  if (!/^[a-z0-9]{20,40}$/.test(assignmentId)) throw new Error("Managed assignment ID is invalid.");
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!secret) throw new Error("The local agent scheduler is not configured.");
  const backend = (process.env.AGENT_API_URL ?? "http://127.0.0.1:9100").replace(/\/$/, "");
  const response = await fetch(`${backend}/v1/schedules/managed-status?assignment_id=${assignmentId}`, {
    headers: { Authorization: `Bearer ${secret}` }, cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const status = await response.json().catch(() => null) as ScheduleStatus | null;
  if (!response.ok || !status || typeof status.active !== "boolean"
      || !Array.isArray(status.markets)) throw new Error("Market-check status could not be verified.");
  return status;
}
