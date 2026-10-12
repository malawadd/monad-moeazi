export const VENUE_TICK_OVERDUE_MS = 90_000;
export const VENUE_TICK_CRITICAL_MS = 180_000;
export const VENUE_WATCHDOG_RETRY_MS = 60_000;

type Run = {
  status: string; nextTickId?: string; lastTickId?: string; nextTickDueAt?: number;
  lastSuccessfulTickAt?: number; updatedAt: number; leaseExpiresAt?: number;
  watchdogLastRetryAt?: number; venueId: string; optimizerStateJson?: string;
  entryPausedAt?: number;
};

export function venueDispatchTickArgs(input: { runId: string; tickId: string; holderId?: string }) {
  return { runId: input.runId, tickId: input.tickId };
}

export function venueWatchdogDecision(run: Run, now: number) {
  const running = ["activation_pending", "active", "stopping", "settling", "uncertain", "incomplete_settlement"].includes(run.status);
  if (!running) {
    return { critical: false, requeue: false, pauseEntries: false, overdueMs: 0 };
  }
  const lastSuccess = run.lastSuccessfulTickAt ?? run.updatedAt;
  const dueAt = run.nextTickDueAt ?? lastSuccess + 60_000;
  const overdueMs = Math.max(0, now - dueAt);
  const critical = now - lastSuccess > VENUE_TICK_CRITICAL_MS;
  const requeue = Boolean(run.nextTickId && run.nextTickId !== run.lastTickId) && overdueMs > VENUE_TICK_OVERDUE_MS
    && (!run.leaseExpiresAt || run.leaseExpiresAt <= now)
    && (!run.watchdogLastRetryAt || now - run.watchdogLastRetryAt >= VENUE_WATCHDOG_RETRY_MS);
  const pauseEntries = critical && run.venueId === "perpl-direct-testnet-v1"
    && Boolean(run.optimizerStateJson) && !run.entryPausedAt;
  return { critical, requeue, pauseEntries, overdueMs };
}
