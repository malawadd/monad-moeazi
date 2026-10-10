import assert from "node:assert/strict";
import test from "node:test";
import { decidePerplOptimizer, type PerplPriceObservation } from "../api-server/src/monad/perplOptimizationStrategy.js";
import { adaptPerplOptimizerAfterCycle, createPerplOptimizerState, PERPL_OPTIMIZER_POLICY } from "../api-server/src/monad/perplOptimizerConfig.js";
import { classifyDirectOrderOutcome } from "../api-server/src/monad/perplDirectOrders.js";
import { optimizerCycleHasPendingOrder, optimizerFinalOrderUnprocessed } from "../api-server/src/monad/perplOptimizerExecution.js";
import { optimizerObservationClose } from "../api-server/src/monad/perplWorkerCycle.js";
import { advancePerplScanner, scannerCadenceMs, scannerMarketIds } from "../api-server/src/monad/perplOptimizerScanner.js";
import { allOpenPerplMarketIds } from "../api-server/src/monad/perplMarketSelection.js";
import { duplicateCycleResult, optimizerCycleStatus } from "../convex/monadVenueOptimizer.js";
import type { VenueAccountSnapshot, VenueMarket } from "../api-server/src/monad/venueTypes.js";

const now = 2_000_000;
test("momentum observations use the executable book midpoint, not a stale last trade", () => {
  assert.equal(optimizerObservationClose({ mid: 10_100, bid: 10_099, ask: 10_101 }), 10_100);
  assert.equal(optimizerObservationClose({ mid: 10_100, bid: 10_101, ask: 10_102 }), 0);
});

test("scanner keeps all signed markets visible during an open position and audits three misses", () => {
  assert.deepEqual(scannerMarketIds([16, 32, 320], 320, true), [16, 32, 320]);
  assert.deepEqual(scannerMarketIds([16, 32, 320], 320, false), [320]);
  let state = createPerplOptimizerState();
  const noSignal = { kind: "hold" as const, reasonCode: "no_market_passed_optimizer_filters",
    details: { rejectedMarkets: [{ reason: "five_minute_threshold" }] } };
  for (let i = 1; i <= 3; i++) {
    const result = advancePerplScanner(state, noSignal, now + i * 300_000, true);
    state = result.state;
    assert.equal(result.record.consecutiveNoProposal, i);
    assert.equal(scannerCadenceMs(state), 300_000);
    if (i === 3) {
      assert.equal(result.record.audit?.conclusion, "no_qualified_live_signal");
      assert.equal(result.record.audit?.action, "investigate_scanner_and_market_conditions");
    }
  }
  const proposed = decidePerplOptimizer(input());
  assert.equal(proposed.kind, "order");
  const proposal = advancePerplScanner(state, proposed, now + 960_000, true);
  assert.equal(proposal.record.status, "deferred_position_open");
  assert.equal(proposal.state.scanner.totalProposals, 1);
  assert.equal(scannerCadenceMs(proposal.state), 300_000);
});
function history(step = 10): PerplPriceObservation[] {
  return Array.from({ length: 16 }, (_, i) => ({ observedAt: now - (15 - i) * 60_000,
    blockNumber: 100 + i, close: 10_000 + step * i }));
}
function makeMarket(overrides: Partial<VenueMarket> = {}): VenueMarket {
  const price = { oracle: 10_150, mark: 10_150, last: 10_150, mid: 10_150, bid: 10_149, ask: 10_151,
    blockNumber: 120, observedAt: now };
  return { id: 12, symbol: "BTC16", name: "BTC16", isOpen: true, priceDecimals: 2, sizeDecimals: 5,
    initialMarginBps: 2500, maintenanceMarginBps: 500, maxLeverage: 4, maxMarketSlippageBps: 100,
    makerFeeMicros: 100, takerFeeMicros: 345, orderTtlBlocks: 20, fundingRateMicros: 0,
    fundingIntervalSeconds: 28_800, fundingObservedAt: now, price,
    book: { blockNumber: 120, observedAt: now, bids: [{ price: 10_149, size: 2_000_000 }],
      asks: [{ price: 10_151, size: 2_000_000 }] }, ...overrides };
}
function acct(positions: unknown[] = [], balance = "100000000"): VenueAccountSnapshot {
  return { accountId: 7, profileAddress: "0xprofile", balanceUnits: balance, lockedUnits: "0", forwardingEnabled: false,
    lastRequestId: 0, positions, orders: [], observedAt: now, blockNumber: 120 };
}
function input(market = makeMarket(), samples = history(), extra: Partial<Parameters<typeof decidePerplOptimizer>[0]> = {}) {
  return { now, expiresAt: now + PERPL_OPTIMIZER_POLICY.runDurationSeconds * 1000,
    run: { amountUnits: "100000000", maxPositionExposureUnits: "400000000", maxLeverage: 4, marketIdsJson: `[${market.id}]` },
    account: acct(), markets: [market], histories: { [market.id]: samples },
    params: createPerplOptimizerState().params, ...extra };
}

test("enrollment signs every open Perpl market and never truncates the list", () => {
  const eight = Array.from({ length: 8 }, (_, i) => makeMarket({ id: (i + 1) * 16 }));
  assert.deepEqual(allOpenPerplMarketIds(eight), eight.map((market) => market.id));
  assert.throws(() => allOpenPerplMarketIds(Array.from({ length: 17 }, (_, i) => makeMarket({ id: i + 1 }))),
    /silently omitting markets/);
});

test("market ranking nets out spread, both taker fees, depth impact and funding", () => {
  const first = makeMarket();
  const second = makeMarket({ id: 13, symbol: "ETH16", price: { ...makeMarket().price!, bid: 10_135, ask: 10_165, mid: 10_150 },
    book: { ...makeMarket().book!, bids: [{ price: 10_135, size: 2_000_000 }], asks: [{ price: 10_165, size: 2_000_000 }] }, takerFeeMicros: 500 });
  const result = decidePerplOptimizer({ ...input(first), run: { ...input(first).run, marketIdsJson: "[12,13]" },
    markets: [first, second], histories: { 12: history(10), 13: history(14) } });
  assert.equal(result.kind, "order");
  if (result.kind !== "order") return;
  assert.equal(result.action.marketId, 12);
  assert.equal(result.details.estimatedRoundTripCostBps, 9); // 2 bps spread + 6.9 bps fees, rounded conservatively.
  assert.equal(result.details.estimatedNetMoveBps, 41);
  assert.equal(result.action.leverage, 4);
});

test("trend disagreement, stale books, and missing two-step 1m confirmation reject entry", () => {
  const trend = history(10).map((point, i) => ({ ...point, close: i < 10 ? 10_500 - i * 50 : 10_000 + (i - 10) * 10 }));
  const wrong = decidePerplOptimizer(input(makeMarket(), trend));
  assert.equal(wrong.kind, "hold");
  if (wrong.kind === "hold") assert.equal((wrong.details?.rejectedMarkets as any[])[0].reason, "fifteen_minute_trend_disagrees");
  const stale = makeMarket({ price: { ...makeMarket().price!, observedAt: now - 100_000 } });
  const staleResult = decidePerplOptimizer(input(stale));
  assert.equal(staleResult.kind, "hold");
  if (staleResult.kind === "hold") assert.equal((staleResult.details?.rejectedMarkets as any[])[0].reason, "stale_market_or_book");
  const onlyTwo = history().slice(-2);
  const tooShort = decidePerplOptimizer(input(makeMarket(), onlyTwo));
  assert.equal(tooShort.kind, "hold");
  if (tooShort.kind === "hold") assert.equal((tooShort.details?.rejectedMarkets as any[])[0].reason, "insufficient_observations");
  const flatClose = decidePerplOptimizer(input(makeMarket(), history().map((point, index) =>
    index === 15 ? { ...point, close: history()[14].close } : point)));
  assert.equal(flatClose.kind, "hold");
  if (flatClose.kind === "hold") assert.equal((flatClose.details?.rejectedMarkets as any[])[0].reason,
    "one_minute_confirmation_missing");
  const missingFunding = decidePerplOptimizer(input(makeMarket({fundingRateMicros: undefined})));
  assert.equal(missingFunding.kind, "hold");
  if (missingFunding.kind === "hold") assert.equal((missingFunding.details?.rejectedMarkets as any[])[0].reason, "funding_estimate_unavailable");
});

test("raw Perpl book sizes cap depth correctly and margin is reduced to 25 AUSD at 1x", () => {
  const shallow = makeMarket({ book: { ...makeMarket().book!, bids: [{ price: 10_149, size: 10_000 }],
    asks: [{ price: 10_151, size: 10_000 }] } });
  const shallowResult = decidePerplOptimizer(input(shallow));
  assert.equal(shallowResult.kind, "order");
  if (shallowResult.kind === "order") assert.ok(BigInt(String(shallowResult.action.maxExposureUnits)) <= 2_100_000n);
  const wideSpread = makeMarket({ price: { ...makeMarket().price!, bid: 10_130, ask: 10_170, mid: 10_150 },
    book: { ...makeMarket().book!, bids: [{ price: 10_130, size: 2_000_000 }], asks: [{ price: 10_170, size: 2_000_000 }] } });
  const marginResult = decidePerplOptimizer(input(wideSpread, history(20)));
  assert.equal(marginResult.kind, "order");
  if (marginResult.kind === "order") {
    assert.equal(marginResult.action.leverage, 1);
    assert.ok(BigInt(String(marginResult.action.maxCollateralUnits)) <= 25_000_000n);
  }
});

test("minute exit uses full executable VWAP and both 345-micro taker fees", () => {
  const market = makeMarket({ price: { ...makeMarket().price!, bid: 10_100, ask: 10_101, mid: 10_100 },
    book: { ...makeMarket().book!, bids: [{ price: 10_100, size: 1_000 }, { price: 10_000, size: 1_000_000 }] } });
  const position = { mkt: 12, sd: 1, ep: "10000", s: "30000", fundingPnlUnits: "0" };
  const result = decidePerplOptimizer({ ...input(market), account: acct([position]), activeCycle: { entryAt: now - 600_000, leverage: 4 } });
  assert.equal(result.kind, "hold");
  if (result.kind === "hold") assert.equal(result.details?.estimatedNetProfitUnits, "-11700");
  const takeProfitMarket = makeMarket({ price: { ...makeMarket().price!, bid: 10_100, ask: 10_101, mid: 10_100 },
    book: { ...makeMarket().book!, bids: [{ price: 10_100, size: 1_000_000 }] } });
  const take = decidePerplOptimizer({ ...input(takeProfitMarket), account: acct([position]),
    activeCycle: { entryAt: now - 600_000, leverage: 4 } });
  assert.equal(take.kind, "order");
  if (take.kind === "order") assert.equal(take.reasonCode, "net_take_profit_exit");
});

test("early planned-loss and 30-minute time exits fire, while minute one holds", () => {
  const bad = makeMarket({ price: { ...makeMarket().price!, bid: 9_500, ask: 9_501, mid: 9_500 },
    book: { ...makeMarket().book!, bids: [{ price: 9_500, size: 1_000_000 }] } });
  const position = { mkt: 12, sd: 1, ep: "10000", s: "30000", fundingPnlUnits: "0" };
  const early = decidePerplOptimizer({ ...input(bad), account: acct([position]), activeCycle: { entryAt: now - 60_000, leverage: 4 } });
  assert.equal(early.kind, "order");
  if (early.kind === "order") assert.equal(early.reasonCode, "planned_loss_risk_exit");
  const flat = makeMarket({ price: { ...makeMarket().price!, bid: 10_000, ask: 10_001, mid: 10_000 },
    book: { ...makeMarket().book!, bids: [{ price: 10_000, size: 1_000_000 }] } });
  const minuteOne = decidePerplOptimizer({ ...input(flat), account: acct([position]), activeCycle: { entryAt: now - 60_000, leverage: 4 } });
  assert.equal(minuteOne.kind, "hold");
  const timed = decidePerplOptimizer({ ...input(flat), account: acct([position]), activeCycle: { entryAt: now - 1_800_000, leverage: 4 } });
  assert.equal(timed.kind, "order");
  if (timed.kind === "order") assert.equal(timed.reasonCode, "maximum_hold_exit");
});

test("forced exit, bounded adaptation, two-win target, 15-cycle cap, and duplicate recovery stay deterministic", () => {
  const market = makeMarket({ price: { ...makeMarket().price!, bid: 10_000, ask: 10_001, mid: 10_000 },
    book: { ...makeMarket().book!, bids: [{ price: 10_000, size: 1_000_000 }] } });
  const pos = { mkt: 12, sd: 1, ep: "10000", s: "30000", fundingPnlUnits: "0" };
  const forced = decidePerplOptimizer({ ...input(market), account: acct([pos]), forceExit: true,
    activeCycle: { entryAt: now, leverage: 4 } });
  assert.equal(forced.kind, "order");
  assert.deepEqual(adaptPerplOptimizerAfterCycle(createPerplOptimizerState(), -1n, "execution_costs").after,
    { momentumThresholdBps: 40, executionConservatismBps: 11_000 });
  assert.equal(adaptPerplOptimizerAfterCycle(createPerplOptimizerState(), 10_000n, "execution_costs").changed, null);
  assert.equal(optimizerCycleStatus(2, 2), "target_reached_awaiting_settlement");
  assert.equal(optimizerCycleStatus(15, 0), "cycle_cap_reached_awaiting_settlement");
  const duplicate = duplicateCycleResult({ cycleNumber: 3, realizedPnlUnits: "10000" },
    { cycles: 3, winStreak: 2, status: "target_reached_awaiting_settlement", params: { momentumThresholdBps: 40, executionConservatismBps: 10_000 } },
    { realizedPnlUnits: "25000" });
  assert.equal(duplicate.winStreak, 2); assert.equal(duplicate.optimizerStatus, "target_reached_awaiting_settlement");
  assert.equal(duplicate.cumulativePnlUnits, "25000");
});

test("final no-fill is distinct from uncertainty and restart recovery only replays unprocessed work", () => {
  assert.equal(classifyDirectOrderOutcome({ requestFound: true, changed: false, fillCount: 0, kind: "market_entry" }), "no_fill");
  assert.equal(classifyDirectOrderOutcome({ requestFound: false, changed: false, fillCount: 0, kind: "market_entry" }), "uncertain");
  assert.equal(classifyDirectOrderOutcome({ requestFound: true, changed: false, fillCount: 1, kind: "market_entry" }), "uncertain");
  const state = { ...createPerplOptimizerState(), activeCycle: { cycleId: "r:cycle:1", entryOrderId: "r:1" } };
  const finalEntry = { orderId: "r:1", status: "finalized", actionJson: JSON.stringify({ optimizerMetadata: { cycleId: "r:cycle:1", role: "entry" } }) };
  assert.equal(optimizerFinalOrderUnprocessed(finalEntry, state), false);
  const finalExit = { orderId: "r:2", status: "finalized", actionJson: JSON.stringify({ optimizerMetadata: { cycleId: "r:cycle:1", role: "exit" } }) };
  assert.equal(optimizerFinalOrderUnprocessed(finalExit, state), true);
  assert.equal(optimizerCycleHasPendingOrder([{ ...finalEntry, status: "no_fill" }], "r:cycle:1"), false);
  assert.equal(optimizerCycleHasPendingOrder([{ ...finalExit, status: "uncertain" }], "r:cycle:1"), true);
});
