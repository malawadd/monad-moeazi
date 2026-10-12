import { VENUE_TICK_CRITICAL_MS, VENUE_TICK_OVERDUE_MS } from "./monadVenueWatchdogRules";

export const PERPL_RESUME_MIN_REMAINING_MS = 30 * 60_000;
const OPTIMIZER_VERSIONS = new Set(["perpl-deterministic-v2", "perpl-deterministic-v3-soak"]);
const RESOLVED_ORDER_STATES = new Set(["finalized", "no_fill", "failed", "canceled"]);

function parseArray(raw?: string) {
  try { const value = raw ? JSON.parse(raw) : null; return Array.isArray(value) ? value : null; }
  catch { return null; }
}

export function perplEntryResumeEligibility(row: any, orders: any[], now: number, expectedPauseAt: number) {
  if (row.venueId !== "perpl-direct-testnet-v1" || row.status !== "active") return { eligible: false, reason: "run_not_active" };
  if (!Number.isSafeInteger(expectedPauseAt) || expectedPauseAt <= 0 || row.entryPausedAt !== expectedPauseAt) {
    return { eligible: false, reason: "pause_changed" };
  }
  let optimizer: any;
  try { optimizer = JSON.parse(row.optimizerStateJson); } catch { optimizer = null; }
  if (!optimizer || !OPTIMIZER_VERSIONS.has(optimizer.version) || optimizer.status !== "running"
    || optimizer.activeCycle !== undefined && optimizer.activeCycle !== null) return { eligible: false, reason: "optimizer_not_idle" };
  const expiresAt = row.expiresAt;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now + PERPL_RESUME_MIN_REMAINING_MS) {
    return { eligible: false, reason: "run_expiring" };
  }
  if (!Number.isSafeInteger(row.lastSuccessfulTickAt) || row.lastSuccessfulTickAt < expectedPauseAt
    || row.lastSuccessfulTickAt > now || now - row.lastSuccessfulTickAt > VENUE_TICK_CRITICAL_MS) {
    return { eligible: false, reason: "worker_tick_not_fresh" };
  }
  if (row.lastWorkerError || row.lastWorkerErrorAt !== undefined || (row.consecutiveWorkerFailures ?? 0) !== 0) {
    return { eligible: false, reason: "worker_has_failures" };
  }
  const expectedTickId = Number.isSafeInteger(row.tickSequence) && row.tickSequence > 0
    ? `${row.runId}:tick:${row.tickSequence - 1}` : "";
  if (!expectedTickId || row.nextTickId !== expectedTickId || row.nextTickId === row.lastTickId
    || !row.scheduledFunctionId || !Number.isSafeInteger(row.nextTickDueAt)
    || row.nextTickDueAt < now - VENUE_TICK_OVERDUE_MS || row.nextTickDueAt > expiresAt) {
    return { eligible: false, reason: "next_tick_invalid" };
  }
  if (row.leaseExpiresAt !== undefined && (!Number.isSafeInteger(row.leaseExpiresAt) || row.leaseExpiresAt > now)) {
    return { eligible: false, reason: "worker_tick_in_flight" };
  }
  const positions = parseArray(row.positionsJson); const openOrders = parseArray(row.ordersJson);
  if (!positions || positions.length || !openOrders || openOrders.length) return { eligible: false, reason: "account_not_flat" };
  if (orders.some((order) => !RESOLVED_ORDER_STATES.has(order.status))) return { eligible: false, reason: "orders_unresolved" };
  return { eligible: true, reason: "eligible" };
}
