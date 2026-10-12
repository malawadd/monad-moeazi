import assert from "node:assert/strict";
import test from "node:test";
import { perplEntryResumeEligibility, PERPL_RESUME_MIN_REMAINING_MS } from "../convex/monadVenueEntryResumeRules";

const now = 1_000_000;
const pauseAt = now - 30_000;
const base = {
  runId: "run", venueId: "perpl-direct-testnet-v1", status: "active", entryPausedAt: pauseAt,
  expiresAt: now + PERPL_RESUME_MIN_REMAINING_MS + 1, optimizerStateJson: JSON.stringify({
    version: "perpl-deterministic-v3-soak", status: "running", activeCycle: null,
  }), lastSuccessfulTickAt: now - 1_000, lastWorkerError: undefined, lastWorkerErrorAt: undefined,
  consecutiveWorkerFailures: 0, tickSequence: 5, nextTickId: "run:tick:4", lastTickId: "run:tick:3",
  scheduledFunctionId: "scheduled", nextTickDueAt: now + 1_000, positionsJson: "[]", ordersJson: "[]",
};

function eligible(row: any = base, orders: any[] = []) {
  return perplEntryResumeEligibility(row, orders, now, pauseAt);
}

test("resumes only an active, paused direct optimizer after a fresh flat successful tick", () => {
  assert.deepEqual(eligible(), { eligible: true, reason: "eligible" });
  assert.deepEqual(eligible(base, [{ status: "finalized" }]), { eligible: true, reason: "eligible" });
});

test("compare-and-swap, run status, expiry and optimizer state guard resume", () => {
  assert.equal(eligible({ ...base, entryPausedAt: pauseAt + 1 }).reason, "pause_changed");
  assert.equal(eligible({ ...base, status: "settling" }).reason, "run_not_active");
  assert.equal(eligible({ ...base, expiresAt: now + PERPL_RESUME_MIN_REMAINING_MS }).reason, "run_expiring");
  assert.equal(eligible({ ...base, optimizerStateJson: "{}" }).reason, "optimizer_not_idle");
  assert.equal(eligible({ ...base, optimizerStateJson: JSON.stringify({ ...JSON.parse(base.optimizerStateJson), activeCycle: {} }) }).reason,
    "optimizer_not_idle");
});

test("worker freshness, error and next-tick guards fail closed", () => {
  assert.equal(eligible({ ...base, lastSuccessfulTickAt: pauseAt - 1 }).reason, "worker_tick_not_fresh");
  assert.equal(eligible({ ...base, lastSuccessfulTickAt: now - 181_000 }).reason, "worker_tick_not_fresh");
  assert.equal(eligible({ ...base, lastWorkerError: "failed" }).reason, "worker_has_failures");
  assert.equal(eligible({ ...base, consecutiveWorkerFailures: 1 }).reason, "worker_has_failures");
  assert.equal(eligible({ ...base, nextTickId: base.lastTickId }).reason, "next_tick_invalid");
  assert.equal(eligible({ ...base, scheduledFunctionId: undefined }).reason, "next_tick_invalid");
  assert.equal(eligible({ ...base, leaseExpiresAt: now + 1 }).reason, "worker_tick_in_flight");
});

test("persisted positions, venue open orders and unresolved order rows block resume", () => {
  assert.equal(eligible({ ...base, positionsJson: "[{\"s\":\"1\"}]" }).reason, "account_not_flat");
  assert.equal(eligible({ ...base, ordersJson: "[{\"oid\":1}]" }).reason, "account_not_flat");
  assert.equal(eligible({ ...base, positionsJson: "invalid" }).reason, "account_not_flat");
  assert.equal(eligible(base, [{ status: "uncertain" }]).reason, "orders_unresolved");
  assert.equal(eligible(base, [{ status: "prepared" }]).reason, "orders_unresolved");
});
