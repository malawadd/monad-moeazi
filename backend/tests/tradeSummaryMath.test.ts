import test from "node:test";
import assert from "node:assert/strict";
import { aggregateFills, grossExitPnlCns } from "../convex/tradeSummaryMath.js";
import { applyPerplSummaryMetadata, foldAutonomousPositions, recordManualPosition, resolvePerplSummaryMetadata } from "../convex/monadTradeSummaryLifecycle.js";
import { foldAutonomousSpotPositions, matchOptimizerCycleEvidence } from "../convex/monadTradeSummaryLifecycle.js";
import { buildSpotCandles, foldWalletSpotPositions, verifySpotSwapHistory } from "../api-server/src/monad/spotTradeHistory.js";
import { Interface, getAddress } from "ethers";
import { ADAPTER_ABI, USDC_ADDRESS, WMON_ADDRESS } from "../api-server/src/monad/constants.js";

test("partial fills use size-weighted execution price and sum fees", () => {
  const result = aggregateFills([
    { lotLNS: "200", pricePNS: "10000", feeCNS: "30" },
    { lotLNS: "100", pricePNS: "10900", feeCNS: "20" },
  ]);
  assert.deepEqual(result, { sizeUnits: "300", priceValueNumerator: "3090000", weightedPrice: "10300", feesUnits: "50" });
});

test("price PnL accounts for partial long and short closes using market decimals", () => {
  const fill = [{ lotLNS: "100", pricePNS: "11000", feeCNS: "10" }];
  assert.equal(grossExitPnlCns(fill, "10000", "long", 2, 2), "10000000");
  assert.equal(grossExitPnlCns(fill, "12000", "short", 2, 2), "10000000");
  assert.equal(grossExitPnlCns(fill, "10000", "short", 2, 2), "-10000000");
});

test("fill amount fields do not affect PnL and missing entry stays unknown", () => {
  assert.equal(grossExitPnlCns([{ lotLNS: "100", pricePNS: "11000", amountCNS: "99999999" }],
    undefined, "long", 2, 2), null);
});

const lifecycle = [
  { kind: "market_entry", lot: "5", price: "100", after: "5", entry: "100", fee: "1", time: 10 },
  { kind: "reduce_size", lot: "2", price: "110", after: "3", entry: "100", fee: "2", time: 20 },
  { kind: "close_position", lot: "3", price: "90", after: "0", entry: "0", fee: "3", time: 30 },
];

test("manual summaries combine entry and partial closes without inventing net PnL", async () => {
  const rows: any[] = [];
  const ctx = { db: {
    query: () => ({ withIndex: () => ({ collect: async () => rows }) }),
    insert: async (_table: string, row: any) => { const saved = { ...row, _id: String(rows.length + 1) }; rows.push(saved); return saved._id; },
    patch: async (id: string, value: any) => { const row = rows.find((item) => item._id === id); Object.assign(row, value); },
  } };
  for (const [index, step] of lifecycle.entries()) {
    const action = { kind: step.kind, marketId: "7", side: "long", priceDecimals: 0, sizeDecimals: 0,
      preEntryPricePNS: "100", preFundingUnits: "4", prePositionSize: index ? lifecycle[index - 1].after : "0" };
    const row = { userId: "user", ownerAddress: "0xowner", venueId: "perpl-direct-testnet-v1",
      accountAddress: "0xaccount", operationId: `manual-${index}`, requestId: index + 1,
      txHash: `0x${String(index + 1).padStart(64, "0")}`, actionJson: JSON.stringify(action) };
    await recordManualPosition(ctx, row, { verified: true, symbol: "TEST", afterPositionSize: step.after,
      afterPositionEntryPrice: step.entry, afterPositionFundingUnits: step.after === "0" ? undefined : "4",
      fills: [{ lotLNS: step.lot, pricePNS: step.price, feeCNS: step.fee }] }, `activity-${index}`, step.time);
  }
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "closed");
  assert.equal(rows[0].sizeUnits, "5"); assert.equal(rows[0].entrySizeUnits, "5");
  assert.equal(rows[0].remainingSizeUnits, "0");
  assert.equal(rows[0].weightedEntryPrice, "100");
  assert.equal(rows[0].weightedExitPrice, "98");
  assert.equal(rows[0].exitSizeUnits, "5");
  assert.equal(rows[0].realizedPricePnlUnits, "-10000000");
  assert.equal(rows[0].feesUnits, "6");
  assert.equal(rows[0].fundingUnits, "4");
  assert.equal(rows[0].netRealizedPnlUnits, undefined);
});

test("autonomous summaries fold finalized partial fills and closes by run", () => {
  const sources = lifecycle.map((step, index) => ({
    event: { eventId: `auto-${index}`, venueId: "perpl-direct-testnet-v1", status: "finalized", timestamp: step.time,
      txHash: `0x${String(index + 1).padStart(64, "0")}` },
    action: { kind: step.kind, marketId: 7, symbol: "TEST", side: "long", priceDecimals: 0, sizeDecimals: 0,
      prePositionSize: index ? lifecycle[index - 1].after : "0" },
    details: { requestId: index + 1, fills: [{ lotLNS: step.lot, pricePNS: step.price, feeCNS: step.fee }] },
    response: { beforePositionSize: index ? lifecycle[index - 1].after : "0",
      beforePositionEntryPrice: "100", afterPositionSize: step.after, afterPositionEntryPrice: step.entry,
      afterPositionFundingUnits: step.after === "0" ? "0" : "4" },
    run: { runId: "run-1" },
  })).reverse();
  const [summary] = foldAutonomousPositions(sources);
  assert.equal(summary.runId, "run-1");
  assert.equal(summary.status, "closed");
  assert.equal(summary.sizeUnits, "5"); assert.equal(summary.entrySizeUnits, "5");
  assert.equal(summary.remainingSizeUnits, "0");
  assert.equal(summary.weightedExitPrice, "98");
  assert.equal(summary.exitSizeUnits, "5");
  assert.equal(summary.realizedPricePnlUnits, "-10000000");
  assert.equal(summary.feesUnits, "6");
  assert.equal(summary.netRealizedPnlUnits, undefined);
});

test("autonomous Perpl summaries recover symbol and size precision without changing PnL evidence", () => {
  const run = { runId: "run-320", marketsJson: JSON.stringify([
    { id: 320, symbol: "BTC-PERP", name: "Bitcoin Perpetual", priceDecimals: 2, sizeDecimals: 6 },
  ]) };
  const action = { kind: "market_entry", marketId: 320, symbol: "320", side: "long" };
  const metadata = resolvePerplSummaryMetadata(run, action, { response: {} });
  assert.deepEqual(metadata, { symbol: "BTC-PERP", priceDecimals: 2, sizeDecimals: 6 });
  const [rawSummary] = foldAutonomousPositions([{
    event: { eventId: "entry-320", venueId: "perpl-direct-testnet-v1", status: "finalized", timestamp: 10,
      txHash: `0x${"1".repeat(64)}` }, action,
    details: { fills: [{ lotLNS: "2877320", pricePNS: "10000", feeCNS: "0" }] },
    response: { afterPositionSize: "2877320", afterPositionEntryPrice: "10000" }, run,
  }]);
  const rawEvidence = { realizedPricePnlUnits: rawSummary.realizedPricePnlUnits, netRealizedPnlUnits: "1234",
    netPnlEvidence: "verified_flat_balance_delta" };
  const resolved = applyPerplSummaryMetadata(rawSummary, metadata);
  assert.equal(resolved.symbol, "BTC-PERP");
  assert.equal(resolved.sizeUnits, "2877320");
  assert.equal(resolved.sizeDecimals, 6);
  assert.deepEqual({ realizedPricePnlUnits: resolved.realizedPricePnlUnits, netRealizedPnlUnits: "1234",
    netPnlEvidence: "verified_flat_balance_delta" }, rawEvidence);
});

test("exit events without explicit after-size or known entry are not summarized", async () => {
  const rows: any[] = [];
  const ctx = { db: {
    query: () => ({ withIndex: () => ({ collect: async () => rows }) }),
    insert: async (_table: string, row: any) => { rows.push(row); return String(rows.length); },
    patch: async () => undefined,
  } };
  const row = { userId: "user", ownerAddress: "0xowner", venueId: "perpl-direct-testnet-v1",
    operationId: "manual-close", requestId: 1, txHash: "0xhash", actionJson: JSON.stringify({
      kind: "close_position", marketId: "7", side: "long", prePositionSize: "2", priceDecimals: 0, sizeDecimals: 0,
    }) };
  await recordManualPosition(ctx, row, { verified: true, fills: [{ lotLNS: "2", pricePNS: "90", feeCNS: "1" }] }, "activity", 40);
  await recordManualPosition(ctx, row, { verified: true, afterPositionSize: "0",
    fills: [{ lotLNS: "2", pricePNS: "90", feeCNS: "1" }] }, "activity", 40);
  assert.equal(rows.length, 0);
  assert.deepEqual(foldAutonomousPositions([{
    event: { eventId: "auto-close", venueId: "perpl-direct-testnet-v1", status: "finalized", timestamp: 40 },
    action: { kind: "close_position", marketId: 7, side: "long", prePositionSize: "2" },
    details: { fills: [{ lotLNS: "2", pricePNS: "90", feeCNS: "1" }] },
    response: { afterPositionSize: "0", beforePositionSize: "2" }, run: { runId: "run-1" },
  }]), []);
});

test("autonomous spot summaries combine verified partial buy and sell receipts", () => {
  const hash = `0x${"a".repeat(64)}`;
  const orders = [
    { enrollmentId: "run-a", orderId: "buy-1", kind: "buy", tokenIndex: 0, status: "finalized", receiptStatus: 1,
      blockHash: hash, blockNumber: 1, finalizedAt: 10, txHash: `0x${"1".repeat(64)}`, amountInUnits: "2000000", amountOutUnits: "2000000000000000000" },
    { enrollmentId: "run-a", orderId: "buy-2", kind: "buy", tokenIndex: 0, status: "finalized", receiptStatus: 1,
      blockHash: hash, blockNumber: 2, finalizedAt: 20, txHash: `0x${"2".repeat(64)}`, amountInUnits: "1500000", amountOutUnits: "1000000000000000000" },
    { enrollmentId: "run-a", orderId: "sell-1", kind: "sell", tokenIndex: 0, status: "finalized", receiptStatus: 1,
      blockHash: hash, blockNumber: 3, finalizedAt: 30, txHash: `0x${"3".repeat(64)}`, amountInUnits: "1000000000000000000",
      amountOutUnits: "1200000", realizedProfitLossUnits: "33334" },
    { enrollmentId: "run-a", orderId: "sell-2", kind: "sell", tokenIndex: 0, status: "finalized", receiptStatus: 1,
      blockHash: hash, blockNumber: 4, finalizedAt: 40, txHash: `0x${"4".repeat(64)}`, amountInUnits: "2000000000000000000",
      amountOutUnits: "2000000", realizedProfitLossUnits: "-333334" },
  ];
  const [row] = foldAutonomousSpotPositions(orders, new Map([["sell-2", "activity-sell-2"]]));
  assert.equal(row.marketId, "MZA_USDC"); assert.equal(row.runId, "run-a");
  assert.equal(row.status, "closed"); assert.equal(row.exitSizeUnits, "3000000000000000000");
  assert.equal(row.sizeUnits, "3000000000000000000"); assert.equal(row.remainingSizeUnits, "0");
  assert.equal(row.weightedEntryPrice, "1166666"); assert.equal(row.realizedPricePnlUnits, "-300000");
  assert.equal(row.netRealizedPnlUnits, "-300000"); assert.deepEqual(row.activityIds, ["activity-sell-2"]);
});

test("autonomous and wallet spot exits without a known buy stay separate", () => {
  const [row] = foldAutonomousSpotPositions([{
    enrollmentId: "run-a", orderId: "sell", kind: "sell", tokenIndex: 0, status: "finalized", receiptStatus: 1,
    blockHash: `0x${"a".repeat(64)}`, blockNumber: 1, finalizedAt: 10, txHash: `0x${"1".repeat(64)}`,
    amountInUnits: "1000000000000000000", amountOutUnits: "1000000", realizedProfitLossUnits: "0",
  }]);
  assert.equal(row, undefined);
  assert.deepEqual(foldWalletSpotPositions([{ venueId: "moeazi_mock_pools_testnet", marketId: "MZA_USDC", kind: "sell",
    baseUnits: "1000000000000000000", quoteUnits: "1000000", blockNumber: 1, transactionIndex: 0, occurredAt: 10,
    txHash: `0x${"1".repeat(64)}`, activityId: "activity-sell", symbol: "MZA/USDC" }]), []);
});

test("spot candles aggregate only actual finalized observations without filling empty intervals", () => {
  const candles = buildSpotCandles([
    { t: 1_001, priceUnits: "10", quoteUnits: "5", blockNumber: 2 },
    { t: 1_500, priceUnits: "14", quoteUnits: "7", blockNumber: 3 },
    { t: 6_001, priceUnits: "12", quoteUnits: "4", blockNumber: 8 },
    { t: 9_000, priceUnits: "0", quoteUnits: "9", blockNumber: 10 },
  ], 5, 1_000, 20_000);
  assert.deepEqual(candles, [
    { t: 0, o: "10", h: "14", l: "10", c: "14", v: "12", n: 2 },
    { t: 5_000, o: "12", h: "12", l: "12", c: "12", v: "4", n: 1 },
  ]);
});

test("wallet spot history requires exact owner calldata, canonical finality and matching transfers", async () => {
  const owner = getAddress("0x1000000000000000000000000000000000000001");
  const adapter = getAddress("0x2000000000000000000000000000000000000002");
  const txHash = `0x${"a".repeat(64)}`; const blockHash = `0x${"b".repeat(64)}`;
  const iface = new Interface(ADAPTER_ABI);
  const data = iface.encodeFunctionData("swap", [USDC_ADDRESS, WMON_ADDRESS, 100n, 90n, "0x"]);
  const transfer = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
  const log = (token: string, from: string, to: string, value: bigint) => ({ address: token,
    ...transfer.encodeEventLog(transfer.getEvent("Transfer")!, [from, to, value]) });
  const candidate: any = { activityId: "activity-1", txHash, venueId: "uniswap_v4_testnet",
    intent: { venue: "uniswap_v4_testnet", accountScope: "wallet", tokenIn: USDC_ADDRESS, tokenOut: WMON_ADDRESS,
      amountInUnits: "100", minAmountOutUnits: "90", marketId: "WMON_USDC" },
    transaction: { to: adapter, data, value: "0", nonce: 3 }, blockNumber: 10, blockHash,
    finalizedBlockNumber: 12, createdAt: 1000 };
  const receipt: any = { status: 1, blockNumber: 10, blockHash, index: 4,
    logs: [log(USDC_ADDRESS, owner, adapter, 100n), log(WMON_ADDRESS, adapter, owner, 95n)] };
  const provider: any = { getTransactionReceipt: async () => receipt,
    getTransaction: async () => ({ chainId: 10143n, from: owner, to: adapter, data, value: 0n, nonce: 3 }),
    getBlock: async () => ({ hash: blockHash, timestamp: 2 }) };
  const trade = await verifySpotSwapHistory(provider, owner, candidate, 12);
  assert.equal(trade?.kind, "buy"); assert.equal(trade?.baseUnits, "95"); assert.equal(trade?.quoteUnits, "100");
  receipt.logs[1] = log(WMON_ADDRESS, adapter, owner, 89n);
  assert.equal(await verifySpotSwapHistory(provider, owner, candidate, 12), null);
});

test("optimizer PnL, fees and funding attach only to an exact finalized position receipt set", () => {
  const entry = `0x${"1".repeat(64)}`; const exit = `0x${"2".repeat(64)}`;
  const summary = { status: "closed", runId: "run-1", marketId: "7", venueId: "perpl-direct-testnet-v1",
    transactionHashes: [entry, exit] };
  const cycle = { ownerAddress: "0xowner", venueId: summary.venueId, realizedPnlUnits: "25",
    cycleJson: JSON.stringify({ cycleId: "cycle-1", marketId: 7, endingFlat: true, exitFinalized: true,
      feesUnits: "8", fundingUnits: "-3", orderReceipts: [
        { role: "entry", txHash: entry }, { role: "exit", txHash: exit },
      ] }) };
  assert.deepEqual(matchOptimizerCycleEvidence(summary, [cycle], "0xowner"), {
    cycleId: "cycle-1", realizedPnlUnits: "25", feesUnits: "8", fundingUnits: "-3",
  });
  const unrelated = { ...cycle, cycleJson: JSON.stringify({ ...JSON.parse(cycle.cycleJson),
    orderReceipts: [{ role: "entry", txHash: entry }, { role: "exit", txHash: `0x${"3".repeat(64)}` }] }) };
  assert.equal(matchOptimizerCycleEvidence(summary, [unrelated], "0xowner"), null);
});
