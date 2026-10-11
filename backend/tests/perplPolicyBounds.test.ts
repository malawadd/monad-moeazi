import assert from "node:assert/strict";
import test from "node:test";
import { readPerplContext } from "../api-server/src/monad/perplContext.js";
import { perplDirectoryRow } from "../api-server/src/monad/markets.js";
import { PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE } from "../api-server/src/monad/perplConfig.js";
import { manualPerplEntryCollateralUnits } from "../api-server/src/monad/manualPerplLimits.js";
import { validatePerplAction } from "../api-server/src/monad/perplPolicy.js";
import { phaseFor } from "../api-server/src/monad/perplVenue.js";
import type { VenueAction, VenueAccountSnapshot, VenueMarket } from "../api-server/src/monad/venueTypes.js";

const observedAt = 100_000;
const market: VenueMarket = {
  id: 16, symbol: "BTC", name: "BTC", isOpen: true, priceDecimals: 2, sizeDecimals: 2,
  initialMarginBps: 1000, maintenanceMarginBps: 500, maxLeverage: 10,
  maxMarketSlippageBps: 100, makerFeeMicros: 100, takerFeeMicros: 345,
  orderTtlBlocks: 20,
  price: { oracle: 100_000, mark: 100_000, last: 100_000, mid: 100_000,
    bid: 99_900, ask: 100_100, blockNumber: 100, observedAt },
  book: { blockNumber: 100, observedAt, bids: [{ price: 99_900, size: 100 }],
    asks: [{ price: 100_100, size: 100 }] },
};
const account: VenueAccountSnapshot = { accountId: 7, profileAddress: "0xprofile",
  balanceUnits: "100000000", lockedUnits: "0", forwardingEnabled: true,
  lastRequestId: 50, positions: [], orders: [], observedAt, blockNumber: 100 };
const entry: VenueAction = { kind: "market_entry", marketId: 16, accountId: 7,
  requestId: 51, side: "long", size: 1, leverage: 2, activePositionCount: 0,
  maxCollateralUnits: "10000000", maxExposureUnits: "20000000", maxLeverage: 3,
  maxSlippageBps: 100, allowedMarketIds: [16], expiresAt: 200_000 };

test("Perpl rejects a wrong-chain live context before using its markets", async () => {
  await assert.rejects(readPerplContext({publicGet: async () => ({chain: {chain_id: 143}})} as any),
    {code: "perpl_wrong_chain"});
});

test("Perpl margin fractions expose correct market and manual leverage limits", async () => {
  const now = Date.now();
  const raw = { chain: { chain_id: 10143 }, instances: [{ id: 1, address: PERPL_TESTNET_EXCHANGE,
    collateral_token_id: 2, min_account_open_amount: "100000000", min_deposit_amount: "10000000",
    min_withdraw_amount: "10000000" }],
    tokens: [{ id: 2, symbol: "AUSD", decimals: 6, address: PERPL_TESTNET_AUSD }],
    markets: [{ id: 16, instance_id: 1, symbol: "BTC", config: { is_open: true,
      price_decimals: 2, size_decimals: 5, initial_margin: 1500, maintenance_margin: 2500,
      min_posting_amount: "1000000", maker_fee: 45, taker_fee: 345 },
      order_max_market_slippage_bps: 1000, order_ttl_blocks: 20 }] };
  const context = await readPerplContext({ publicGet: async () => raw } as any);
  const market = context.markets[0];
  assert.equal(market.maxLeverage, 15);
  assert.equal(market.initialMarginBps, 667);
  assert.equal(market.maintenanceMarginBps, 400);
  assert.equal(market.minPostingUnits, "1000000");
  const ticker = { d: { 16: { orl: 100000, mrk: 100000, lst: 100000, mid: 100000,
    bid: 99900, ask: 100100, at: { t: now, b: 100 } } } };
  const row = perplDirectoryRow(market, ticker, undefined, context.limits.maxLeverage);
  assert.equal(row.maxLeverage, 15);
  assert.equal(row.manualMaxLeverage, 3);
  assert.equal(row.manualMaxOrderUnits, "10000000");
  assert.equal(row.maintenanceMarginBps, 400);
  assert.equal(row.quoteAvailable, true);
});

test("Manual entry sizing reserves both initial margin and the opening taker fee", () => {
  assert.deepEqual(manualPerplEntryCollateralUnits(10_000_000n, 2, 345), {
    marginUnits: 5_000_000n, feeUnits: 3_450n, requiredUnits: 5_003_450n,
  });
  assert.deepEqual(manualPerplEntryCollateralUnits(1n, 3, 345), {
    marginUnits: 1n, feeUnits: 1n, requiredUnits: 2n,
  });
});

test("Perpl policy blocks replay, stale quotes, unsigned markets, expired entry and excess exposure", () => {
  assert.doesNotThrow(() => validatePerplAction(entry, market, account, observedAt + 1_000));
  assert.throws(() => validatePerplAction({...entry, requestId: 50}, market, account, observedAt + 1_000),
    {code: "perpl_request_id_stale"});
  assert.throws(() => validatePerplAction(entry, market, account, observedAt + 61_000),
    {code: "perpl_price_stale"});
  assert.throws(() => validatePerplAction({...entry, allowedMarketIds: [32]}, market, account, observedAt + 1_000),
    {code: "perpl_market_not_allowed"});
  assert.throws(() => validatePerplAction({...entry, expiresAt: observedAt}, market, account, observedAt + 1_000),
    {code: "perpl_run_expired"});
  assert.throws(() => validatePerplAction({...entry, size: 100}, market, account, observedAt + 1_000),
    {code: "perpl_policy_limit"});
});

test("Perpl rejects insufficient executable depth and a second open position", () => {
  assert.throws(() => validatePerplAction({...entry, size: 101}, market, account, observedAt + 1_000),
    {code: "perpl_policy_limit"});
  assert.throws(() => validatePerplAction({...entry, activePositionCount: 1}, market, account, observedAt + 1_000),
    {code: "perpl_position_already_open"});
  const deepCap = {...entry, maxCollateralUnits: "1000000000", maxExposureUnits: "2000000000"};
  assert.throws(() => validatePerplAction({...deepCap, size: 101}, market, account, observedAt + 1_000),
    {code: "perpl_depth_insufficient"});
});

test("Perpl order phases keep admission, fill and finality distinct", () => {
  assert.equal(phaseFor(1, 0, 10, 1), "submitted");
  assert.equal(phaseFor(3, 2, 10, 1), "partially_filled");
  assert.equal(phaseFor(4, 10, 10, 1), "filled");
  assert.equal(phaseFor(10, 0, 0, 5), "submitted");
  assert.equal(phaseFor(7, 0, 10, 1), "failed");
});
