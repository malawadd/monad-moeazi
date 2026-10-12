import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluatePerplHealth } from "../api-server/src/monad/perplHealthModel.js";

const now = 1_800_000_000_000;
function run(overrides: Record<string, unknown> = {}) {
  return { runId: "run-a", venueId: "perpl-direct-testnet-v1", status: "active", phase: "perpl_direct_optimizer",
    updatedAt: now - 30_000, lastSuccessfulTickAt: now - 30_000, nextTickDueAt: now + 30_000,
    nextTickId: "run-a:tick:2",
    expiresAt: now + 3_600_000, chainId: 10143, positionCount: 1, positionsJson: '[{"mkt":12}]',
    ordersJson: "[]", positionMarketIds: [12], marketIds: [12], marketIdsJson: "[12]",
    observations: [{ marketId: 12, observedAt: now - 20_000, finalized: true }], orders: [],
    optimizer: { version: "perpl-deterministic-v3-soak", status: "running", cycles: 1,
      lastExitCheckAt: now - 30_000, scanner: { totalScans: 2, totalProposals: 1 } }, ...overrides };
}
const alertCodes = (input: any) => evaluatePerplHealth({ runs: [input], now }).alerts.map((item) => item.code);

test("healthy recent position checks and finalized market observations do not alert", () => {
  const result = evaluatePerplHealth({ runs: [run()], now });
  assert.equal(result.summary.criticalCount, 0);
  assert.deepEqual(result.alerts, []);
});

test("failed tick, expired lease, and overdue open-position check are surfaced", () => {
  const codes = alertCodes(run({ lastSuccessfulTickAt: now - 400_000, nextTickDueAt: now - 100_000,
    lastWorkerError: "rpc read failed", lastWorkerErrorAt: now - 50_000,
    leaseExpiresAt: now - 10_000, optimizer: { lastExitCheckAt: now - 400_000 } }));
  assert.ok(codes.includes("worker_tick_failed"));
  assert.ok(codes.includes("worker_lease_expired"));
  assert.ok(codes.includes("position_check_overdue"));
});

test("non-terminal run without a next tick ID is flagged without auto-repair", () => {
  const result = evaluatePerplHealth({ runs: [run({ nextTickId: null })], now });
  assert.ok(result.alerts.some((item) => item.code === "worker_tick_missing"));
  assert.equal(result.runs[0].nextTickId, null);
});

test("an error followed by a successful tick is not treated as currently failed", () => {
  const codes = alertCodes(run({ lastSuccessfulTickAt: now - 10_000, lastWorkerError: "old error",
    lastWorkerErrorAt: now - 30_000 }));
  assert.ok(!codes.includes("worker_tick_failed"));
});

test("uncertain and delayed orders are visible without counting them as fills", () => {
  const codes = alertCodes(run({ orders: [
    { orderId: "run-a:1", status: "uncertain", kind: "market_exit", updatedAt: now - 1_000 },
    { orderId: "run-a:2", status: "submitted", kind: "market_entry", updatedAt: now - 200_000 },
  ] }));
  assert.ok(codes.includes("order_reconciliation_needed"));
  assert.equal(evaluatePerplHealth({ runs: [run({ orders: [{ status: "submitted", updatedAt: now - 1_000 }] })], now }
    ).runs[0].resolvedOrderCount, 0);
});

test("account snapshot open orders and market IDs are retained in health summary", () => {
  const result = evaluatePerplHealth({ runs: [run({ openOrderCount: 2, positionMarketIds: [12], marketIds: [12, 13],
    observations: [{ marketId: 12, observedAt: now - 10_000, finalized: true }] })], now });
  assert.ok(result.alerts.some((item) => item.code === "venue_open_orders"));
  assert.deepEqual(result.runs[0].positionMarketIds, [12]);
  assert.deepEqual(result.runs[0].staleMarketIds, [13]);
});

test("three consecutive worker failures and watchdog retries are surfaced", () => {
  const result = evaluatePerplHealth({ runs: [run({ consecutiveWorkerFailures: 3, watchdogRetryCount: 4,
    watchdogLastRetryAt: now - 5_000 })], now });
  assert.ok(result.alerts.some((item) => item.code === "worker_retry_limit"));
  assert.equal(result.runs[0].watchdogRetryCount, 4);
});

test("stale market data, paused entries, and incomplete settlement produce distinct alerts", () => {
  const staleCodes = alertCodes(run({ observations: [{ marketId: 12, observedAt: now - 500_000, finalized: true }],
    entryPausedAt: now - 10_000, entryPauseReason: "watchdog safety pause" }));
  assert.ok(staleCodes.includes("market_data_stale"));
  assert.ok(staleCodes.includes("entries_paused"));
  assert.ok(alertCodes(run({ status: "incomplete_settlement", recoveryReason: "close blocked" })).includes("settlement_incomplete"));
});

test("a five-minute finalized scanner cadence is healthy across every mandated market", () => {
  const observations = Array.from({ length: 8 }, (_, index) => ({ marketId: index + 1,
    observedAt: now - 300_000, finalized: true }));
  const result = evaluatePerplHealth({ runs: [run({ marketIds: observations.map((item) => item.marketId), observations })], now });
  assert.ok(!result.alerts.some((item) => item.code === "market_data_stale"));
});

test("service readiness and closed gates are alerted while a position is open", () => {
  const result = evaluatePerplHealth({ runs: [run()], now,
    services: [{ id: "rpc", name: "Monad RPC", state: "unavailable", detail: "No finalized block." }],
    gates: [{ id: "broadcast", name: "Broadcast gate", enabled: false }] });
  assert.ok(result.alerts.some((item) => item.code === "service_rpc"));
  assert.ok(result.alerts.some((item) => item.code === "gate_broadcast_closed"));
});
