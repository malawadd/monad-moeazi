import assert from "node:assert/strict";
import test from "node:test";
import { directOptimizerRunIndexEntry, reportedOptimizerState } from "../convex/monadVenueOptimizer.js";

test("operator run inventory exposes only bounded identifying and optimizer state", () => {
  const row = { runId: "run-1", status: "active", phase: "optimizer_cycle_completed", ownerAddress: "0xowner",
    createdAt: 1, updatedAt: 2, activatedAt: 3, expiresAt: 4,
    optimizerStateJson: JSON.stringify({ version: "perpl-deterministic-v2", status: "running", cycles: 2, winStreak: 1 }),
    mandateSignature: "secret", fundingRawTransaction: "secret", ordersJson: "private payload" };
  const summary = directOptimizerRunIndexEntry(row);
  assert.deepEqual(summary, { runId: "run-1", status: "active", phase: "optimizer_cycle_completed", ownerAddress: "0xowner",
    createdAt: 1, updatedAt: 2, startedAt: 3, expiresAt: 4,
    optimizer: { version: "perpl-deterministic-v2", profile: "two_win_target", stopCondition: "two_wins_or_cycle_cap",
      status: "running", cycles: 2, winStreak: 1, positiveCycles: 0, targetWinStreak: 2, cycleLimit: 15 } });
  assert.equal("mandateSignature" in summary, false);
  assert.equal("fundingRawTransaction" in summary, false);
});

test("operator run inventory labels a duration soak without a two-win target", () => {
  const summary = directOptimizerRunIndexEntry({ runId: "soak", status: "active", ownerAddress: "0xowner",
    optimizerStateJson: JSON.stringify({ version: "perpl-deterministic-v3-soak", status: "running", cycles: 2, winStreak: 2 }) });
  assert.deepEqual(summary.optimizer, { version: "perpl-deterministic-v3-soak", profile: "duration_soak",
    stopCondition: "run_expiry_or_cycle_cap", status: "running", cycles: 2, winStreak: 2, positiveCycles: 0,
    targetWinStreak: null, cycleLimit: 15 });
});

test("settled duration soaks report settled status without inferring expiry from running state", () => {
  const state = JSON.stringify({ version: "perpl-deterministic-v3-soak", status: "running", cycles: 2, winStreak: 2 });
  const summary = directOptimizerRunIndexEntry({ runId: "settled-soak", status: "completed", phase: "settlement_reconciled",
    ownerAddress: "0xowner", expiresAt: 1_000, completedAt: 1_000_000, optimizerStateJson: state });
  assert.equal(summary.optimizer?.status, "settled");
  assert.equal("completionReason" in summary.optimizer!, false);
  assert.equal(summary.phase, "settlement_reconciled");
});

test("owner-stopped duration soak does not report expiry as its completion reason", () => {
  const summary = directOptimizerRunIndexEntry({ runId: "owner-stopped-soak", status: "completed", phase: "settlement_reconciled",
    ownerAddress: "0xowner", stoppedAt: 900, stopTxHash: "0xstop",
    optimizerStateJson: JSON.stringify({ version: "perpl-deterministic-v3-soak", status: "running", cycles: 2, winStreak: 2 }) });
  assert.equal(summary.optimizer?.status, "settled");
  assert.equal("completionReason" in summary.optimizer!, false);
});

test("settled duration soak at the cycle cap reports settlement and preserves the cap outcome", () => {
  const state = { version: "perpl-deterministic-v3-soak", status: "cycle_cap_reached_awaiting_settlement" };
  assert.deepEqual(reportedOptimizerState({ status: "completed" }, state), { ...state,
    status: "settled", completionReason: "cycle_cap_reached" });
});

test("active duration soaks and historical v2 optimizer statuses are unchanged", () => {
  const active = { version: "perpl-deterministic-v3-soak", status: "running" };
  const legacy = { version: "perpl-deterministic-v2", status: "running" };
  const legacyTarget = { version: "perpl-deterministic-v2", status: "target_reached_awaiting_settlement" };
  const legacyCap = { version: "perpl-deterministic-v2", status: "cycle_cap_reached_awaiting_settlement" };
  assert.equal(reportedOptimizerState({ status: "active" }, active), active);
  assert.equal(reportedOptimizerState({ status: "completed" }, legacy), legacy);
  assert.equal(reportedOptimizerState({ status: "completed" }, legacyTarget), legacyTarget);
  assert.equal(reportedOptimizerState({ status: "completed" }, legacyCap), legacyCap);
});

test("active direct run is listed before optimizer state is written", () => {
  assert.equal(directOptimizerRunIndexEntry({ runId: "pending", status: "activation_pending", ownerAddress: "0xowner" }).optimizer, null);
});
