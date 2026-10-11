import assert from "node:assert/strict";
import test from "node:test";
import { STRATEGY_CATALOG, STRATEGY_CATALOG_VERSION } from "../api-server/src/monad/strategyRoutes.js";
import { optimizerStrategyIdentity, publicStrategyMetricsFromRecords } from "../convex/monadStrategyCatalog.js";

const ownerA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ownerB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const hash = `0x${"1".repeat(64)}`;
const delegated = `0x${"2".repeat(40)}`;

function run(runId: string, ownerAddress: string, patch: Record<string, unknown> = {}) {
  return { runId, ownerAddress, venueId: "perpl-direct-testnet-v1", status: "completed",
    optimizerStateJson: JSON.stringify({version: "perpl-deterministic-v3-soak"}),
    activatedAt: 1_000, fundingStatus: "finalized", activationStatus: "finalized",
    fundingTxHash: hash, activationTxHash: hash, delegatedAccountAddress: delegated, accountId: 7,
    realizedPnlUnits: "999999", unrealizedPnlUnits: "888888", ...patch };
}

function cycle(runId: string, cycleId: string, pnl: string, patch: Record<string, unknown> = {}) {
  const startingBalanceUnits = "100000000";
  const endingBalanceUnits = (BigInt(startingBalanceUnits) + BigInt(pnl)).toString();
  const cycleJson = { cycleId, exitFinalized: true, endingFlat: true, exitFillCount: 1,
    startingBalanceUnits, endingBalanceUnits,
    orderReceipts: [{role: "entry", fills: []}, {role: "exit", fills: [{size: "1"}]}] };
  return {runId, venueId: "perpl-direct-testnet-v1", cycleId, realizedPnlUnits: pnl,
    cycleJson: JSON.stringify(cycleJson), ...patch};
}

test("catalog keeps stable identity, creator, fee terms, availability and enrollment target", () => {
  assert.equal(STRATEGY_CATALOG_VERSION, "strategy-catalog-v1");
  const deterministic = STRATEGY_CATALOG[0];
  assert.equal(deterministic.strategyId, "perpl-deterministic");
  assert.equal(deterministic.version, "perpl-deterministic-v3-soak");
  assert.equal(deterministic.creator, "Moeazi Team");
  assert.equal(deterministic.fee.rateBps, 0);
  assert.equal(deterministic.status, "available");
  assert.equal(deterministic.enrollmentDestination?.route, "PerplSetup");
  assert.match(deterministic.venueFees.description, /not a Moeazi fee/);

  const agentic = STRATEGY_CATALOG[1];
  assert.equal(agentic.status, "planned_unavailable");
  assert.equal(agentic.creator, "Moeazi Team");
  assert.equal(agentic.enrollmentDestination, null);
  assert.equal(agentic.fee.rateBps, 200);
  assert.match(agentic.description, /not charged now/);
  assert.match(agentic.description, /Not announced/);
  assert.match(agentic.description, /replaceable decision provider/);
});

test("only directly verified optimizer activations and unique finalized cycles contribute public metrics", () => {
  const runs = [
    run("a1", ownerA), run("a2", ownerA), run("b1", ownerB),
    run("prepared", ownerB, {status: "prepared", activatedAt: undefined}),
    run("failed", ownerB, {status: "failed"}),
    run("manual", ownerB, {optimizerStateJson: undefined}),
    run("unverified", ownerB, {activationStatus: "submitted"}),
    run("wrong-version", ownerB, {optimizerStateJson: JSON.stringify({version: "experimental"})}),
  ];
  const cycles = [cycle("a1", "cycle-a1", "12000"), cycle("a1", "cycle-a1", "12000"),
    cycle("a2", "cycle-a2", "-5000"), cycle("b1", "cycle-b1", "3000"),
    cycle("prepared", "cycle-prepared", "70000"), cycle("failed", "cycle-failed", "70000"),
    cycle("manual", "cycle-manual", "70000"),
    cycle("a1", "unrealized-only", "90000", {cycleJson: JSON.stringify({cycleId: "unrealized-only", exitFinalized: false})}),
    cycle("a1", "wrong-pnl", "500", {realizedPnlUnits: "501"})];
  const result = publicStrategyMetricsFromRecords(runs, cycles, 1234);
  assert.deepEqual(result, {strategyId: "perpl-deterministic", currency: "AUSD", decimals: 6,
    netRealizedPnlUnits: "10000", verifiedCycleCount: 3, uniqueActivatedWalletCount: 2, observedAt: 1234});
  assert.equal("ownerAddress" in result, false);
});

test("optimizer identity accepts only the known direct Perpl strategy versions", () => {
  assert.deepEqual(optimizerStrategyIdentity("perpl-direct-testnet-v1", {version: "perpl-deterministic-v3-soak"}),
    {strategyId: "perpl-deterministic", strategyVersion: "perpl-deterministic-v3-soak"});
  assert.deepEqual(optimizerStrategyIdentity("perpl-direct-testnet-v1", {version: "perpl-deterministic-v2"}),
    {strategyId: "perpl-deterministic", strategyVersion: "perpl-deterministic-v2"});
  assert.equal(optimizerStrategyIdentity("perpl-testnet-v1", {version: "perpl-deterministic-v3-soak"}), null);
  assert.equal(optimizerStrategyIdentity("perpl-direct-testnet-v1", {version: "manual"}), null);
});
