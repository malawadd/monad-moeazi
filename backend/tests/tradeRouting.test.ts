import test from "node:test";
import assert from "node:assert/strict";
import { buildRoutePreviewRequest, mapMarket, mergeLiveHyperliquidMarketData } from "../lib/trade/routeBackend";
import { routeBestExecution, validateTradeSettings } from "../lib/trade/routing";
import type { PerpMarket, RouteInput, TradeVenueId, VenueSnapshot } from "../lib/trade/types";

const baseInput: RouteInput = {
  marketId: "BTC",
  side: "long",
  marginUsd: 100,
  leverage: 5,
  slippageCapBps: 100,
  now: 1_000_000,
};

function market(venues: TradeVenueId[] = ["hyperliquid"], overrides: Partial<PerpMarket> = {}): PerpMarket {
  return {
    id: "BTC",
    label: "BTC Perp",
    baseSymbol: "BTC",
    quoteSymbol: "USDC",
    category: "crypto",
    pricePrecision: 1,
    maxLeverage: 40,
    venues,
    ...overrides,
  };
}

function snapshot(
  venue: VenueSnapshot["venue"],
  overrides: Partial<VenueSnapshot> = {},
): VenueSnapshot {
  return {
    venue,
    marketId: "BTC",
    midPrice: 100,
    bidPrice: 99.95,
    askPrice: 100.05,
    entryImpactBps: 5,
    exitImpactBps: 5,
    fundingRateHourly: 0.00001,
    openInterestUsd: 1_000_000,
    volume24hUsd: 10_000_000,
    fetchedAt: baseInput.now!,
    source: "fixture",
    ...overrides,
  };
}

test("routing excludes unlisted venues and live venue leverage caps", () => {
  const quote = routeBestExecution(
    { ...baseInput, leverage: 45 },
    [
      snapshot("hyperliquid", { maxLeverage: 40 }),
      snapshot("lighter", { maxLeverage: 100 }),
    ],
    market(["hyperliquid"]),
  );

  const hyperliquid = quote.quotes.find((item) => item.venue === "hyperliquid");
  const lighter = quote.quotes.find((item) => item.venue === "lighter");

  assert.equal(hyperliquid?.eligible, false);
  assert.match(hyperliquid?.reason ?? "", /leverage/i);
  assert.equal(lighter?.eligible, false);
  assert.match(lighter?.reason ?? "", /not listed/i);
  assert.equal(quote.winningVenue, null);
});

test("routing uses a shared slippage benchmark instead of each venue mid", () => {
  const quote = routeBestExecution({ ...baseInput, slippageCapBps: 500 }, [
    snapshot("hyperliquid", {
      midPrice: 100,
      bidPrice: 99,
      askPrice: 101,
      entryImpactBps: 0,
      exitImpactBps: 0,
    }),
    snapshot("lighter", {
      midPrice: 102.5,
      bidPrice: 100,
      askPrice: 105,
      entryImpactBps: 0,
      exitImpactBps: 0,
    }),
  ], market(["hyperliquid", "lighter"]));

  const hyperliquid = quote.quotes.find((item) => item.venue === "hyperliquid");
  const lighter = quote.quotes.find((item) => item.venue === "lighter");

  assert.equal(quote.benchmarkVenue, "hyperliquid");
  assert.equal(hyperliquid?.costs.entrySlippageUsd, 5);
  assert.equal(lighter?.costs.entrySlippageUsd, 24.39);
});

test("funding is optional and exit fees are modeled from entry notional", () => {
  const lighterMarket = market(["lighter"], { maxLeverage: 100 });
  const withoutFunding = routeBestExecution(baseInput, [snapshot("lighter")], lighterMarket);
  const withFunding = routeBestExecution({ ...baseInput, holdTimeHours: 10 }, [snapshot("lighter")], lighterMarket);
  const baseQuote = withoutFunding.quotes.find((item) => item.venue === "lighter");
  const fundedQuote = withFunding.quotes.find((item) => item.venue === "lighter");

  assert.equal(baseQuote?.costs.fundingUsd, 0);
  assert.equal(fundedQuote?.costs.fundingUsd, 0.05);
  assert.equal(fundedQuote?.costs.entryFeeUsd, 0);
  assert.equal(fundedQuote?.costs.exitFeeUsd, 0);
});

test("routing excludes non-live venues when only Hyperliquid has a public quote", () => {
  const quote = routeBestExecution(baseInput, [snapshot("hyperliquid", { source: "public" })], market(["hyperliquid"]));
  const hyperliquid = quote.quotes.find((item) => item.venue === "hyperliquid");
  const lighter = quote.quotes.find((item) => item.venue === "lighter");

  assert.equal(hyperliquid?.eligible, true);
  assert.equal(hyperliquid?.source, "public");
  assert.equal(lighter?.eligible, false);
  assert.match(lighter?.reason ?? "", /not listed/i);
});

test("routing sweeps live order book levels for entry and exit estimates", () => {
  const quote = routeBestExecution({ ...baseInput, slippageCapBps: 500 }, [
    snapshot("hyperliquid", {
      midPrice: 100,
      bidPrice: 99.9,
      askPrice: 100.1,
      asks: [
        { price: 100, size: 2 },
        { price: 102, size: 3 },
      ],
      bids: [
        { price: 99, size: 2 },
        { price: 97, size: 3 },
      ],
      entryImpactBps: 100,
      exitImpactBps: 100,
    }),
  ], market());
  const row = quote.quotes.find((item) => item.venue === "hyperliquid");

  assert.equal(row?.estimatedEntryPrice, 101.2);
  assert.equal(row?.estimatedExitPrice, 97.8);
});

test("ties prefer lower entry slippage and then static venue priority", () => {
  const quote = routeBestExecution(baseInput, [
    snapshot("hyperliquid", {
      midPrice: 100,
      bidPrice: 100,
      askPrice: 100,
      entryImpactBps: 0,
      exitImpactBps: 0,
    }),
    snapshot("lighter", {
      midPrice: 100,
      bidPrice: 100,
      askPrice: 100,
      entryImpactBps: 0,
      exitImpactBps: 0,
    }),
  ], market(["hyperliquid", "lighter"]));

  assert.equal(quote.winningVenue, "lighter");
});

test("trade settings validation rejects invalid defaults", () => {
  assert.throws(
    () =>
      validateTradeSettings({
        defaultMarketId: "BTC",
        defaultLeverage: 250,
        defaultMarginUsd: 100,
        slippageCapBps: 50,
        market: market(),
      }),
    /cap/i,
  );
  assert.doesNotThrow(() =>
    validateTradeSettings({
      defaultMarketId: "BTC",
      defaultLeverage: 5,
      defaultMarginUsd: 100,
      slippageCapBps: 50,
      market: market(),
    }),
  );
});

test("backend market mapper carries live price fields for dropdown labels", () => {
  const mapped = mapMarket({
    market_id: "ETH",
    label: "ETH Perp",
    base_symbol: "ETH",
    quote_symbol: "USDC",
    category: "crypto",
    max_leverage: 50,
    price_precision: 1,
    mark_price: 3123.45,
    oracle_price: 3122.9,
    prev_day_price: 3000,
    day_change_pct: 4.115,
    open_interest_usd: 10_000_000,
    volume_24h_usd: 20_000_000,
    funding_rate_hourly: 0.0001,
    venues: ["hyperliquid"],
  });

  assert.equal(mapped.markPrice, 3123.45);
  assert.equal(mapped.oraclePrice, 3122.9);
  assert.equal(mapped.dayChangePct, 4.115);
  assert.equal(mapped.volume24hUsd, 20_000_000);
});

test("Hyperliquid live metadata hydrates backend markets that lack prices", () => {
  const routed = market(["hyperliquid", "lighter"], { id: "ETH", markPrice: null, volume24hUsd: null });
  const hydrated = mergeLiveHyperliquidMarketData(routed, [
    market(["hyperliquid"], {
      id: "ETH",
      markPrice: 3123.45,
      oraclePrice: 3122.9,
      volume24hUsd: 20_000_000,
      fundingRateHourly: 0.0001,
    }),
  ]);

  assert.equal(hydrated.markPrice, 3123.45);
  assert.equal(hydrated.oraclePrice, 3122.9);
  assert.equal(hydrated.volume24hUsd, 20_000_000);
  assert.equal(hydrated.fundingRateHourly, 0.0001);
});

test("route preview payload excludes non-perp venues like Uniswap", () => {
  const request = buildRoutePreviewRequest({
    input: baseInput,
    readyVenues: ["hyperliquid", "uniswap", "lighter"],
    allowedVenues: ["uniswap", "gmx"],
    overrideVenue: "uniswap",
  });

  assert.deepEqual(request.ready_venues, ["hyperliquid", "lighter"]);
  assert.deepEqual(request.allowed_venues, ["gmx"]);
  assert.equal(request.override_venue, null);
});
