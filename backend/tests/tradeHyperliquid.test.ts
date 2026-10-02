import test from "node:test";
import assert from "node:assert/strict";
import { canUseUaForHyperliquid, fundingAmountNeeded } from "../lib/trade/hyperliquidFunding";
import { buildHyperliquidMarkets, canonicalHyperliquidCoin, tradePathForCoin, vizPathForCoin } from "../lib/trade/hyperliquidMarkets";
import { buildHyperliquidOrderActions, formatHyperliquidPrice, formatHyperliquidSize } from "../lib/trade/hyperliquidOrder";
import { buildTradeTicketLimits } from "../lib/trade/ticketLimits";

test("Hyperliquid route symbols canonicalize to clean market paths", () => {
  assert.equal(canonicalHyperliquidCoin("eth"), "ETH");
  assert.equal(canonicalHyperliquidCoin("BTC-PERP"), "BTC");
  assert.equal(tradePathForCoin("sol-perp"), "/trade/SOL");
  assert.equal(vizPathForCoin("sol-perp"), "/viz/SOL");
});

test("Hyperliquid metadata builds live markets and excludes delisted assets", () => {
  const markets = buildHyperliquidMarkets([
    {
      universe: [
        { name: "BTC", szDecimals: 5, maxLeverage: 40 },
        { name: "OLD", szDecimals: 2, maxLeverage: 5, isDelisted: true },
      ],
    },
    [
      {
        markPx: "64000",
        oraclePx: "63990",
        prevDayPx: "62000",
        funding: "0.0000125",
        openInterest: "10",
        dayNtlVlm: "1000000",
      },
      {},
    ],
  ], 123);
  assert.equal(markets.length, 1);
  assert.equal(markets[0].id, "BTC");
  assert.equal(markets[0].assetIndex, 0);
  assert.equal(markets[0].maxLeverage, 40);
  assert.equal(markets[0].oraclePrice, 63990);
  assert.equal(markets[0].openInterestUsd, 640000);
});

test("Particle UA must credit a Hyperliquid-signable address", () => {
  assert.equal(
    canUseUaForHyperliquid({
      ownerAddress: "0x1111111111111111111111111111111111111111",
      evmUaAddress: "0x1111111111111111111111111111111111111111",
    }).ok,
    true,
  );
  assert.equal(
    canUseUaForHyperliquid({
      ownerAddress: "0x1111111111111111111111111111111111111111",
      evmUaAddress: "0x2222222222222222222222222222222222222222",
    }).ok,
    false,
  );
});

test("Hyperliquid IOC and isolated leverage payloads are deterministic", () => {
  const built = buildHyperliquidOrderActions({
    asset: 4,
    isBuy: true,
    mid: 100,
    size: 1.25,
    sizeDecimals: 2,
    slippageCapBps: 75,
    leverage: 5,
    reduceOnly: false,
  });

  assert.equal(built.aggressivePrice, 100.75);
  assert.deepEqual(built.leverageAction, { type: "updateLeverage", asset: 4, isCross: false, leverage: 5 });
  assert.deepEqual(built.orderAction, {
    type: "order",
    orders: [{ a: 4, b: true, p: "100.75", s: "1.25", r: false, t: { limit: { tif: "Ioc" } } }],
    grouping: "na",
  });
  assert.throws(
    () =>
      buildHyperliquidOrderActions({
        asset: 4,
        isBuy: true,
        mid: 100,
        size: 1.25,
        sizeDecimals: 2,
        slippageCapBps: 75,
        leverage: 5.8,
        reduceOnly: false,
      }),
    /whole number/i,
  );
});

test("Hyperliquid precision and live ticket limits are data-backed", () => {
  assert.equal(formatHyperliquidPrice(97123.456, 5), 97123);
  assert.equal(formatHyperliquidPrice(2567.891, 4), 2567.9);
  assert.equal(formatHyperliquidSize(1.23456, 3), 1.235);
  const limits = buildTradeTicketLimits({
    side: "long",
    leverage: 5,
    slippageCapBps: 100,
    accountCollateralUsd: 30,
    snapshot: {
      venue: "hyperliquid",
      marketId: "BTC",
      midPrice: 100,
      bidPrice: 99,
      askPrice: 101,
      asks: [
        { price: 100.5, size: 1 },
        { price: 102, size: 10 },
      ],
      bids: [{ price: 99.5, size: 1 }],
      entryImpactBps: 0,
      exitImpactBps: 0,
      fundingRateHourly: 0,
      openInterestUsd: 0,
      volume24hUsd: 0,
      fetchedAt: 1,
      source: "public",
      maxLeverage: 40,
    },
  });
  assert.equal(limits.maxLeverage, 40);
  assert.equal(limits.maxNotionalByDepthUsd, 100.5);
  assert.equal(limits.maxMarginByDepthUsd, 20.1);
  assert.equal(limits.maxMarginUsd, 20.1);
});

test("funding helper only asks for missing margin", () => {
  assert.equal(fundingAmountNeeded({ marginUsd: 100, venueAccountValueUsd: 42.321 }), 57.68);
  assert.equal(fundingAmountNeeded({ marginUsd: 100, venueAccountValueUsd: 100 }), 0);
});
