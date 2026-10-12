import assert from "node:assert/strict";
import test from "node:test";
import { venueDispatchTickArgs, venueWatchdogDecision } from "../convex/monadVenueWatchdogRules";

const now = 1_000_000;
const base = {
  status: "active", venueId: "perpl-direct-testnet-v1", optimizerStateJson: "{}",
  nextTickId: "run:tick:32", lastTickId: "run:tick:31", updatedAt: now - 60_000,
  lastSuccessfulTickAt: now - 60_000, nextTickDueAt: now - 1_000,
};

test("lease retry dispatch excludes the worker-only holder ID", () => {
  assert.deepEqual(venueDispatchTickArgs({ runId: "run", tickId: "run:tick:32", holderId: "private-lease" }),
    { runId: "run", tickId: "run:tick:32" });
});

test("healthy or still-leased ticks do not launch competing callbacks", () => {
  assert.equal(venueWatchdogDecision(base, now).requeue, false);
  assert.equal(venueWatchdogDecision({ ...base, nextTickDueAt: now - 150_000,
    leaseExpiresAt: now + 10_000 }, now).requeue, false);
});

test("overdue tick is retried with its identity and optimizer entries pause", () => {
  const stale = { ...base, lastSuccessfulTickAt: now - 300_000, nextTickDueAt: now - 160_000,
    leaseExpiresAt: now - 10_000 };
  assert.deepEqual(venueWatchdogDecision(stale, now), {
    critical: true, requeue: true, pauseEntries: true, overdueMs: 160_000,
  });
  assert.equal(venueWatchdogDecision({ ...stale, watchdogLastRetryAt: now - 20_000 }, now).requeue, false);
  assert.equal(venueWatchdogDecision({ ...stale, entryPausedAt: now - 50_000 }, now).pauseEntries, false);
});

test("repeated API failures pause entries even while retry callbacks are scheduled", () => {
  const result = venueWatchdogDecision({ ...base, lastSuccessfulTickAt: now - 300_000,
    nextTickDueAt: now + 15_000 }, now);
  assert.equal(result.requeue, false);
  assert.equal(result.pauseEntries, true);
});

test("terminal or completed ticks cannot be recovered into new work", () => {
  assert.equal(venueWatchdogDecision({ ...base, status: "completed" }, now + 600_000).requeue, false);
  assert.equal(venueWatchdogDecision({ ...base, lastTickId: base.nextTickId }, now + 600_000).requeue, false);
});

test("a missing tick ID pauses new optimizer entries without inventing a replacement order", () => {
  const decision = venueWatchdogDecision({ ...base, nextTickId: undefined,
    lastSuccessfulTickAt: now - 300_000 }, now);
  assert.equal(decision.critical, true);
  assert.equal(decision.pauseEntries, true);
  assert.equal(decision.requeue, false);
});
