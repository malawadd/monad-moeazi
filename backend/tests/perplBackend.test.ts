import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { keccak256, toUtf8Bytes } from "ethers";
import { PerplSecretStore } from "../api-server/src/monad/perplSecrets.js";
import { decidePerplRun } from "../api-server/src/monad/perplDecisionProvider.js";
import { PerplTestnetVenue, screenFinalizedMarketSnapshots, toPerplOrderSpec } from "../api-server/src/monad/perplVenue.js";
import { PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE, PERPL_VENUE_ID } from "../api-server/src/monad/perplConfig.js";
import { perplSettlementStateHash } from "../api-server/src/monad/perplWorkerSettlement.js";
import { buildPerplScenarioAction, perplScenarioOrderProgress } from "../api-server/src/monad/perplScenarioPolicy.js";
import { getVenueAdapter, replaceVenueAdaptersForTests } from "../api-server/src/monad/venueRegistry.js";
import type { VenueAdapter } from "../api-server/src/monad/venueAdapterContract.js";
import type { VenueMarket } from "../api-server/src/monad/venueTypes.js";
import { createPerplVenueFacade, perplVenueFacade } from "../api-server/src/monad/perplVenueFacade.js";
import { readPerplVenueAccount, readPerplVenueContext, readPerplVenueMarkets, reconcilePerplVenueAction,
  preparePerplVenueEnrollment, settlePerplVenueRun, submitPerplVenueAction } from "../api-server/src/monad/perplVenueOperations.js";

const secret = (runId: string) => ({ runId, ownerAddress: "0xowner", operatorAddress: "0xoperator", profileAddress: "0xprofile", apiKey: runId,
  privateKeyHex: "0xkey", publicKey: "pub", expiresAt: 9_999_999_999, scopeMask: 2 as const,
  origin: "https://example.test", status: "active" as const });

test("Perpl secret writes serialize concurrent enrollment and removal per run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "perpl-secrets-"));
  try {
    const store = new PerplSecretStore(directory);
    await Promise.all(Array.from({ length: 32 }, (_, i) => store.put(secret(`run-id-${i.toString().padStart(3, "0")}`))));
    const rows = await Promise.all(Array.from({ length: 32 }, (_, i) => store.get(`run-id-${i.toString().padStart(3, "0")}`)));
    assert.equal(rows.filter(Boolean).length, 32);
    await Promise.all([store.put(secret("run-id-concurrent")), store.markUncertain("run-id-concurrent")]);
    assert.equal((await store.get("run-id-concurrent"))?.status, "uncertain");
    await Promise.all([store.remove("run-id-concurrent"), store.put(secret("run-id-concurrent"))]);
    assert.equal((await store.get("run-id-concurrent"))?.apiKey, "run-id-concurrent");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const market: VenueMarket = { id: 12, symbol: "BTC16", name: "BTC16", isOpen: true, priceDecimals: 2, sizeDecimals: 2,
  initialMarginBps: 1000, maintenanceMarginBps: 500, maxLeverage: 10, maxMarketSlippageBps: 100,
  makerFeeMicros: 100, takerFeeMicros: 500, orderTtlBlocks: 20,
  price: { oracle: 100_000, mark: 100_000, last: 100_000, mid: 100_000, bid: 99_900, ask: 100_100, blockNumber: 5, observedAt: 10_000 },
  book: { blockNumber: 5, observedAt: 10_000, bids: [{ price: 99_900, size: 1_000 }], asks: [{ price: 100_100, size: 1_000 }] } };

test("a stale Perpl book cannot block fresh markets or enter a single-market order", () => {
  const now = 100_000;
  const fresh = { ...market, price: { ...market.price!, blockNumber: 90, observedAt: now - 2_000 },
    book: { ...market.book!, blockNumber: 90, observedAt: now - 2_000 } };
  const stale = { ...market, id: 64, symbol: "MON", price: { ...market.price!, blockNumber: 80, observedAt: now - 2_000 },
    book: { ...market.book!, blockNumber: 70, observedAt: now - 450_000 } };
  const screened = screenFinalizedMarketSnapshots([fresh, stale], 95, now);
  assert.equal(screened[0].price?.blockNumber, 90);
  assert.equal(screened[1].price, null);
  assert.equal(screened[1].book, undefined);
  assert.throws(() => screenFinalizedMarketSnapshots([stale], 95, now), /stale or unfinalized/);
  assert.throws(() => screenFinalizedMarketSnapshots([fresh], 85, now), /stale or unfinalized/);
});

test("Perpl cancel orders use zeroed trade-only fields", () => {
  assert.deepEqual(toPerplOrderSpec({ kind: "cancel_limit", requestId: 9, marketId: 12, accountId: 7,
    orderId: 88, size: 123, leverage: 2 }, market), { rq: 9, mkt: 12, acc: 7, oid: 88,
    t: 5, p: 0, s: 0, fl: 0, lv: 0, lb: 0 });
});

test("Perpl decision uses executable close sides and signed long/short PnL", () => {
  const run = { amountUnits: "100000000", maxPositionExposureUnits: "300000000", maxLeverage: 3, marketIdsJson: "[12]" };
  const base = { now: 1_000_000, expiresAt: 2_000_000, run, histories: {}, markets: [] as VenueMarket[] };
  const position = (sd: number) => ({ mkt: 12, sd, ep: "100000", s: "20", lv: 200 });
  const make = (bid: number, ask: number) => ({ ...market, price: { ...market.price!, bid, ask, observedAt: 1_000_000 },
    book: { ...market.book!, observedAt: 1_000_000 } });
  const losingLong = decidePerplRun({ ...base, markets: [make(98_000, 98_100)], account: { accountId: 1, profileAddress: "0x", balanceUnits: "100000000", lockedUnits: "0", forwardingEnabled: true, lastRequestId: 0, positions: [position(1)], orders: [], observedAt: 1_000_000, blockNumber: 10 } });
  assert.equal(losingLong.kind, "order");
  if (losingLong.kind === "order") assert.equal(losingLong.reasonCode, "risk_exit");
  const favorableLong = decidePerplRun({ ...base, markets: [make(102_000, 102_100)], account: { accountId: 1, profileAddress: "0x", balanceUnits: "100000000", lockedUnits: "0", forwardingEnabled: true, lastRequestId: 0, positions: [position(1)], orders: [], observedAt: 1_000_000, blockNumber: 10 } });
  assert.equal(favorableLong.kind, "order");
  if (favorableLong.kind === "order") assert.equal(favorableLong.reasonCode, "take_profit_exit");
  const losingShort = decidePerplRun({ ...base, markets: [make(102_000, 102_100)], account: { accountId: 1, profileAddress: "0x", balanceUnits: "100000000", lockedUnits: "0", forwardingEnabled: true, lastRequestId: 0, positions: [position(2)], orders: [], observedAt: 1_000_000, blockNumber: 10 } });
  assert.equal(losingShort.kind, "order");
  if (losingShort.kind === "order") assert.equal(losingShort.reasonCode, "risk_exit");
  const favorableShort = decidePerplRun({ ...base, markets: [make(98_000, 98_100)], account: { accountId: 1, profileAddress: "0x", balanceUnits: "100000000", lockedUnits: "0", forwardingEnabled: true, lastRequestId: 0, positions: [position(2)], orders: [], observedAt: 1_000_000, blockNumber: 10 } });
  assert.equal(favorableShort.kind, "order");
  if (favorableShort.kind === "order") assert.equal(favorableShort.reasonCode, "take_profit_exit");
});

test("Perpl settlement hash normalizes decoded bigint state before hashing", () => {
  const state = { balanceCNS: 12345678901234567890n, lockedBalanceCNS: 42n,
    positions: { bank1: 1n, bank2: 0n, bank3: 2n, bank4: 0n } };
  const locks = [{ orderLockId: 1n, nextOrderLockId: 2n, prevOrderLockId: 0n, orderType: 3n, lotLNS: 4n, amountCNS: 5n }];
  const expectedPayload = JSON.stringify({ accountId: 7, daAddress: "0x00000000000000000000000000000000000000aa", blockNumber: 123,
    balance: "12345678901234567890", locked: "42", positions: { bank1: "1", bank2: "0", bank3: "2", bank4: "0" },
    locks: [{ orderLockId: "1", nextOrderLockId: "2", prevOrderLockId: "0", orderType: "3", lotLNS: "4", amountCNS: "5" }] });
  assert.equal(perplSettlementStateHash(7, "0x00000000000000000000000000000000000000aa", 123, state, locks),
    keccak256(toUtf8Bytes(expectedPayload)));
});

test("shared registry contract supports both Perp venues without adapter casts", async () => {
  const calls: string[] = [];
  const fake: VenueAdapter = { venueId: "fake-test-venue", displayName: "Fake", chainId: 10143,
    executionModel: "offchain_exchange", testOnly: true, capabilities: ["market_data"],
    async readContext() { calls.push("context"); return { venueId: this.venueId, phase: "observed" }; },
    async prepareEnrollment() { calls.push("prepare"); return { venueId: this.venueId, phase: "review_ready" }; },
    async readMarkets() { calls.push("markets"); return { venueId: this.venueId, phase: "observed" }; },
    async readAccount() { calls.push("account"); return { venueId: this.venueId, phase: "observed" }; },
    async submitAction() { calls.push("submit"); return { venueId: this.venueId, phase: "submitted" }; },
    async reconcileAction() { calls.push("reconcile"); return { venueId: this.venueId, phase: "finalized" }; },
    async settleRun() { calls.push("settle"); return { venueId: this.venueId, phase: "ready" }; } };
  replaceVenueAdaptersForTests([fake]);
  const adapter = getVenueAdapter("FAKE-TEST-VENUE");
  assert.deepEqual([await adapter.readContext(), await adapter.prepareEnrollment({}), await adapter.readMarkets({}),
    await adapter.readAccount({}), await adapter.submitAction({}), await adapter.reconcileAction({}), await adapter.settleRun({})]
    .map((result) => result.phase), ["observed", "review_ready", "observed", "observed", "submitted", "finalized", "ready"]);
  assert.deepEqual(calls, ["context", "prepare", "markets", "account", "submit", "reconcile", "settle"]);
  replaceVenueAdaptersForTests([]);
});

test("active Perpl lifecycle resolves through the registered adapter and preserves venue phases", async () => {
  const calls: string[] = [];
  const account = { accountId: 7, profileAddress: "0xoperator", balanceUnits: "100000000", lockedUnits: "0",
    forwardingEnabled: true, lastRequestId: 8, positions: [], orders: [], observedAt: 10_000, blockNumber: 20 };
  const context = { chainId: 10143, exchangeAddress: PERPL_TESTNET_EXCHANGE, instanceId: 12, collateralTokenId: 3,
    limits: { collateralAddress: PERPL_TESTNET_AUSD, collateralDecimals: 6, minAccountOpenUnits: "100000000",
      minDepositUnits: "10000000", minWithdrawUnits: "10000000", minDurationSeconds: 60,
      maxDurationSeconds: 3600, maxLeverage: 10 }, markets: [market], raw: { fixture: true } };
  const fakeVenue: any = { venueId: PERPL_VENUE_ID, displayName: "Fake Perpl", chainId: 10143,
    executionModel: "offchain_exchange", testOnly: true, capabilities: ["market_data"],
    async readContext() { calls.push("context"); return context; },
    async readMarkets() { calls.push("markets"); return [market]; },
    async readFinalizedMarkets() { calls.push("finalized_markets"); return [market]; },
    async readAccount() { calls.push("account"); return account; },
    async submitAction() { calls.push("submit"); return { requestId: 8, phase: "accepted_for_forwarding", rawResponse: { ack: true } }; },
    async reconcileAction() { calls.push("reconcile"); return { requestId: 8, phase: "filled", order: { oid: 88 }, fills: [{ fs: 1 }],
      events: [], rawResponse: { fill: true } }; } };
  const fakeAdapter = createPerplVenueFacade(fakeVenue);
  replaceVenueAdaptersForTests([fakeAdapter]);
  const credentials = { apiKey: "fixture", privateKeyHex: "0x00", walletAddress: "0xoperator" };
  try {
    assert.equal((await readPerplVenueContext()).instanceId, 12);
    assert.equal((await preparePerplVenueEnrollment({ ownerAddress: "0xowner" })).eligibleMarkets.length, 1);
    assert.equal((await readPerplVenueMarkets({ marketIds: [12], finalized: true })).length, 1);
    assert.equal((await readPerplVenueAccount(7, credentials)).lastRequestId, 8);
    assert.equal((await submitPerplVenueAction({ kind: "market_entry", marketId: 12, accountId: 7, side: "long",
      size: 1, price: 0, leverage: 1, requestId: 8 }, credentials)).phase, "accepted_for_forwarding");
    assert.equal((await reconcilePerplVenueAction(8, 7, credentials)).phase, "filled");
    assert.equal((await settlePerplVenueRun(7, credentials)).flat, true);
    const registeredSubmit = await getVenueAdapter(PERPL_VENUE_ID).submitAction({ action: { kind: "market_entry" }, credentials });
    assert.equal(registeredSubmit.phase, "accepted_for_forwarding");
    assert.deepEqual(registeredSubmit.rawResponse, { ack: true });
    const registeredReconcile = await getVenueAdapter(PERPL_VENUE_ID).reconcileAction({ requestId: 8, accountId: 7, credentials });
    assert.equal(registeredReconcile.phase, "filled");
    assert.deepEqual(registeredReconcile.rawResponse, { fill: true });
  } finally { replaceVenueAdaptersForTests([perplVenueFacade]); }
  assert.deepEqual(calls, ["context", "context", "markets", "finalized_markets", "account", "submit", "reconcile", "account", "submit", "reconcile"]);
});

test("queued Perpl scenario action receives server caps and uses the shared policy checker", () => {
  const account = { accountId: 7, profileAddress: "0xoperator", balanceUnits: "100000000", lockedUnits: "0",
    forwardingEnabled: true, lastRequestId: 18, positions: [], orders: [], observedAt: 1_000_000, blockNumber: 20 };
  const run = { runId: "run", amountUnits: "100000000", maxPositionExposureUnits: "300000000", maxLeverage: 3,
    marketIdsJson: "[12]", expiresAt: 2_000_000 };
  const scenario = { status: "queued", stepIndex: 0, actions: [{ kind: "market_entry", marketId: 12,
    side: "long", size: 2, leverage: 2, maxSlippageBps: 500 }] };
  const liveMarket = { ...market, price: { ...market.price!, observedAt: 1_000_000 }, book: { ...market.book!, observedAt: 1_000_000 } };
  const action = buildPerplScenarioAction({ scenario, run, account, market: liveMarket, now: 1_000_000 });
  assert.equal(action.kind, "market_entry");
  assert.equal(action.activePositionCount, 0);
  assert.equal(action.maxCollateralUnits, "25000000");
  assert.equal(action.maxExposureUnits, "300000000");
  assert.equal(action.maxSlippageBps, 100);
  assert.deepEqual(action.allowedMarketIds, [12]);
  assert.equal(toPerplOrderSpec({ ...action, requestId: 19 }, liveMarket).fl, 4);
});

test("Perpl scenarios block unsigned markets and resolve prior order references", () => {
  const account = { accountId: 7, profileAddress: "0xoperator", balanceUnits: "100000000", lockedUnits: "0",
    forwardingEnabled: true, lastRequestId: 18, positions: [], orders: [], observedAt: 1_000_000, blockNumber: 20 };
  const run = { amountUnits: "100000000", maxPositionExposureUnits: "300000000", maxLeverage: 3, marketIdsJson: "[12]", expiresAt: 2_000_000 };
  assert.throws(() => buildPerplScenarioAction({ scenario: { status: "queued", stepIndex: 0,
    actions: [{ kind: "cancel_limit", marketId: 13, orderId: 55 }] }, run, account, market: { ...market, id: 13 }, now: 1_000_000 }),
    (error: any) => error.code === "perpl_scenario_market_not_allowed");
  const action = buildPerplScenarioAction({ scenario: { status: "queued", stepIndex: 0, lastVenueOrderId: 88,
    actions: [{ kind: "cancel_limit", marketId: 12, orderId: "previous" }] }, run, account, market, now: 1_000_000 });
  assert.equal(action.orderId, 88);
});

test("Perpl REST batch admission remains separate and acknowledgements are not fills", async () => {
  const now = Date.now(); const calls: any[] = [];
  const context = { chain: { chain_id: 10143 }, instances: [{ id: 12, address: PERPL_TESTNET_EXCHANGE,
    collateral_token_id: 3, min_account_open_amount: "100000000", min_deposit_amount: "10000000", min_withdraw_amount: "10000000" }],
    tokens: [{ id: 3, symbol: "AUSD", decimals: 6, address: PERPL_TESTNET_AUSD }],
    markets: [{ id: 12, instance_id: 12, symbol: "BTC16", config: { is_open: true, price_decimals: 2, size_decimals: 2,
      initial_margin: 1500, maintenance_margin: 2500, maker_fee: 100, taker_fee: 500 },
      order_max_market_slippage_bps: 100, order_ttl_blocks: 20 }] };
  const ticker = { d: { 12: { orl: 100000, mrk: 100000, lst: 100000, mid: 100000,
    bid: 99900, ask: 100100, at: { t: now, b: 100 } } } };
  const api: any = {
    async publicGet(target: string) {
      if (target === "/v1/pub/context") return context;
      if (target === "/v1/market-data/ticker") return ticker;
      if (target.includes("/book?")) return { sn: 100, at: { t: now },
        bid: [{ p: 99900, s: 1000 }], ask: [{ p: 100100, s: 1000 }] };
      throw new Error(`Unexpected public endpoint ${target}`);
    },
    async signedGet(target: string) {
      if (target === "/v1/trading/wallet") return { addr: "0xoperator", sn: 100, at: { t: now },
        as: [{ id: 7, in: 12, b: "100000000", lb: "0", fw: true, lfr: 0 }] };
      if (target === "/v1/trading/positions" || target === "/v1/trading/orders") return { d: [] };
      throw new Error(`Unexpected signed endpoint ${target}`);
    },
    async signedPost(target: string, body: any) {
      calls.push({ target, body });
      return { status: { code: 0 }, statuses: [{ code: 0 }, { code: 1 }] };
    },
  };
  const venue = new PerplTestnetVenue({ api, finalizedBlock: async () => 100 });
  const credentials = { apiKey: "fixture-only", privateKeyHex: "0x00", walletAddress: "0xoperator" };
  const actions = [1, 2].map((requestId) => ({ kind: "market_entry", marketId: 12, accountId: 7, side: "long" as const,
    size: 2, price: 0, leverage: 2, requestId, allowedMarketIds: [12], maxCollateralUnits: "25000000",
    maxExposureUnits: "300000000", maxLeverage: 3, maxSlippageBps: 100 }));
  const results = await venue.submitRestBatch(actions, credentials);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, "/v1/trading/orders");
  assert.deepEqual(calls[0].body.d.map((row: any) => row.rq), [1, 2]);
  assert.deepEqual(results.map((row) => row.phase), ["accepted_for_forwarding", "failed"]);
  assert.equal(results.some((row) => row.phase === "filled"), false);
});

test("Perpl scenario lifecycle waits on uncertainty, completes cancel, and stops canceled queues", () => {
  const actions = [{ kind: "limit_entry", marketId: 12 }, { kind: "cancel_limit", marketId: 12, orderId: "previous" }];
  const scenario = { status: "running", activeOrderId: "run:19", stepIndex: 0 };
  assert.equal(perplScenarioOrderProgress(scenario, { status: "uncertain" }, actions).kind, "uncertain");
  assert.equal(perplScenarioOrderProgress(scenario, { status: "submitted", orderIdAtVenue: "88" }, actions).kind, "advance");
  assert.equal(perplScenarioOrderProgress({ ...scenario, status: "cancel_pending" }, { status: "submitted", orderIdAtVenue: "88" }, actions).kind, "cancel_order");
  assert.equal(perplScenarioOrderProgress({ ...scenario, status: "cancel_pending", activeActionKind: "limit_entry" },
    { status: "finalized", orderIdAtVenue: "88" }, actions).kind, "cancel_order");
  assert.equal(perplScenarioOrderProgress({ ...scenario, status: "cancel_pending", activeActionKind: "scenario_cancel_order" },
    { status: "finalized" }, actions).kind, "canceled");
  assert.equal(perplScenarioOrderProgress({ ...scenario, status: "canceled" }, { status: "submitted" }, actions).kind, "canceled");
  assert.equal(perplScenarioOrderProgress(scenario, { status: "failed" }, actions).kind, "blocked");
});
