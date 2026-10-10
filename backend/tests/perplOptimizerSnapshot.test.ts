import assert from "node:assert/strict";
import test from "node:test";
import { compactOptimizerRunSnapshot } from "../scripts/perpl-optimizer-summary.mjs";

test("compact Perpl snapshot keeps latest measured cycle and three rejection scans", () => {
  const summary = compactOptimizerRunSnapshot({
    inventory: { runId: "run-1", ownerAddress: "0xowner", status: "active", phase: "optimizer_cycle_completed",
      startedAt: 10, expiresAt: 20, optimizer: { status: "running", cycles: 2 } },
    report: { runStatus: "active", phase: "optimizer_cycle_completed", runStartedAt: 10, expiresAt: 20,
      returnedUnits: null, settlement: null,
      optimizer: { version: "perpl-deterministic-v3-soak", profile: "duration_soak", stopCondition: "run_expiry_or_cycle_cap",
        status: "running", cycles: 2, cycleLimit: 15, winStreak: 2, positiveCycles: 2,
        scanner: { totalScans: 12, totalProposals: 2, consecutiveNoProposal: 1, cadenceMs: 300000, privateField: "omit" } },
      cycles: [
        { cycleNumber: 1, realizedPnlUnits: "100", feesUnits: "5", orderReceipts: [{ txHash: "old", rawResponse: "omit" }] },
        { cycleNumber: 2, cycleId: "c2", completedAt: 30, exitFinalized: true, endingFlat: true, exitFillCount: 1,
          realizedPnlUnits: "200", feesUnits: "6", fundingUnits: "7",
          operatorGasWei: "8", orderReceipts: [{ role: "entry", orderId: "o2", requestId: 3, txHash: "0xreceipt", blockNumber: 9 }] },
      ],
      recentScans: [1, 2, 3, 4].map((timestamp) => ({ timestamp, phase: "no_proposal", details: {
        rejectedMarkets: [{ marketId: 12, symbol: "BTC16", reason: "stale_market_or_book", fiveMinuteMoveBps: 2, rawBook: "omit" }],
      } })),
      pendingOrders: [{ orderId: "pending", status: "uncertain", txHash: "0xpending", rawTransaction: "omit" }],
      activePositions: [{ marketId: 12, side: "long", size: "5", entryPrice: "100", unrealizedPnlUnits: "-2", secret: "omit" }],
    },
  });
  assert.equal(summary.runId, "run-1");
  assert.equal(summary.latestCycle.cycleNumber, 2);
  assert.equal(summary.latestCycle.exitFinalized, true);
  assert.equal(summary.latestCycle.realizedPnlUnits, "200");
  assert.equal(summary.latestCycle.orderReceipts[0].txHash, "0xreceipt");
  assert.equal(summary.lastScans.length, 3);
  assert.equal(summary.lastScans[0].rejectedMarkets[0].reason, "stale_market_or_book");
  assert.deepEqual(summary.pendingOrders, [{ orderId: "pending", status: "uncertain", txHash: "0xpending" }]);
  assert.deepEqual(summary.activePositions, [{ marketId: 12, side: "long", size: "5", entryPrice: "100", unrealizedPnlUnits: "-2" }]);
  assert.equal("privateField" in summary.optimizer.scanner, false);
  assert.equal("rawResponse" in summary.latestCycle.orderReceipts[0], false);
});
