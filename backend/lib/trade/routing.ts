import {
  TRADE_VENUE_PRIORITY,
  VENUE_CAPABILITIES,
} from "./markets";
import type {
  BestExecutionQuote,
  CostBreakdown,
  PerpMarket,
  RouteInput,
  TradeSide,
  TradeVenueId,
  VenueLevel,
  VenueQuote,
  VenueSnapshot,
} from "./types";

const MAX_QUOTE_FRESHNESS_MS = 60_000;
const TIE_EPSILON_USD = 0.01;

export function routeBestExecution(
  input: RouteInput,
  snapshots: VenueSnapshot[],
  market: PerpMarket,
): BestExecutionQuote {
  const now = input.now ?? Date.now();
  if (!market) {
    throw new Error(`Unsupported market: ${input.marketId}`);
  }
  validateRouteInput(input);

  const notionalUsd = roundUsd(input.marginUsd * input.leverage);
  const byVenue = new Map(snapshots.map((snapshot) => [snapshot.venue, snapshot]));
  const benchmarkVenue = pickBenchmarkVenue(input, snapshots, market, notionalUsd);
  const benchmark = benchmarkVenue ? byVenue.get(benchmarkVenue) ?? null : null;
  const quotes = TRADE_VENUE_PRIORITY.map((venue) =>
    buildVenueQuote({
      input,
      venue,
      snapshot: byVenue.get(venue) ?? null,
      benchmark,
      now,
      market,
      marketVenues: market.venues,
      notionalUsd,
    }),
  );

  const eligible = quotes.filter((quote) => quote.eligible);
  const winningVenue = eligible.length > 0 ? sortQuotesForBestExecution(eligible)[0].venue : null;

  return {
    input,
    market,
    notionalUsd,
    benchmarkVenue,
    winningVenue,
    quotes,
    createdAt: now,
  };
}

export function validateTradeSettings(args: {
  defaultMarketId: string;
  defaultLeverage: number;
  defaultMarginUsd: number;
  slippageCapBps: number;
  expectedHoldHours?: number | null;
  market?: PerpMarket | null;
}) {
  if (!args.defaultMarketId.trim()) throw new Error("Choose a supported market.");
  if (!Number.isFinite(args.defaultLeverage) || args.defaultLeverage <= 0) {
    throw new Error("Default leverage must be greater than zero.");
  }
  const market = args.market ?? null;
  if (market && args.defaultLeverage > market.maxLeverage) {
    throw new Error(`Default leverage exceeds the ${market.label} cap.`);
  }
  if (!Number.isFinite(args.defaultMarginUsd) || args.defaultMarginUsd <= 0) {
    throw new Error("Default margin must be greater than zero.");
  }
  if (!Number.isFinite(args.slippageCapBps) || args.slippageCapBps < 0) {
    throw new Error("Slippage cap cannot be negative.");
  }
  if (args.expectedHoldHours !== null && args.expectedHoldHours !== undefined) {
    if (!Number.isFinite(args.expectedHoldHours) || args.expectedHoldHours < 0) {
      throw new Error("Expected hold time cannot be negative.");
    }
  }
}

function buildVenueQuote(args: {
  input: RouteInput;
  venue: TradeVenueId;
  snapshot: VenueSnapshot | null;
  benchmark: VenueSnapshot | null;
  now: number;
  market: PerpMarket;
  marketVenues: TradeVenueId[];
  notionalUsd: number;
}): VenueQuote {
  const capabilities = VENUE_CAPABILITIES[args.venue];
  const maxLeverage = args.snapshot?.maxLeverage ?? args.market.maxLeverage ?? capabilities.maxLeverage;
  const base = {
    venue: args.venue,
    venueLabel: capabilities.label,
    kind: capabilities.kind,
    source: args.snapshot?.source ?? "none",
    midPrice: args.snapshot?.midPrice ?? null,
    estimatedEntryPrice: null,
    estimatedExitPrice: null,
    notionalUsd: args.notionalUsd,
    marginUsd: args.input.marginUsd,
    maxLeverage,
    availableDepthUsd: args.snapshot ? depthUsd(args.snapshot, args.input.side) : null,
    feeRateBps: capabilities.takerFeeBps,
    freshnessMs: args.snapshot ? args.now - args.snapshot.fetchedAt : null,
    costs: zeroCosts(),
  } satisfies Omit<VenueQuote, "eligible" | "reason">;

  const exclusion = getExclusionReason(args, capabilities);
  if (exclusion) {
    return { ...base, eligible: false, reason: exclusion };
  }

  const snapshot = args.snapshot!;
  const benchmark = args.benchmark ?? snapshot;
  const quantity = args.notionalUsd / snapshot.midPrice;
  const entryPrice = fillPrice(snapshot, args.input.side, "entry", quantity);
  const exitPrice = fillPrice(snapshot, args.input.side === "long" ? "short" : "long", "exit", quantity);
  const entrySlippageUsd = slippageUsd(args.input.side, entryPrice, benchmark.midPrice, quantity);
  const exitSide = args.input.side === "long" ? "short" : "long";
  const exitSlippageUsd = slippageUsd(exitSide, exitPrice, benchmark.midPrice, quantity);
  const entryFeeUsd = feeUsd(args.notionalUsd, capabilities.takerFeeBps);
  const exitFeeUsd = feeUsd(args.notionalUsd, capabilities.takerFeeBps);
  const fundingUsd = fundingCostUsd(args.input.side, args.notionalUsd, snapshot.fundingRateHourly, args.input.holdTimeHours);
  const costs = totalCosts({
    entryFeeUsd,
    exitFeeUsd,
    transferCostUsd: capabilities.transferCostUsd,
    entrySlippageUsd,
    exitSlippageUsd,
    fundingUsd,
  });

  return {
    ...base,
    eligible: true,
    estimatedEntryPrice: entryPrice,
    estimatedExitPrice: exitPrice,
    costs,
  };
}

function getExclusionReason(
  args: {
    input: RouteInput;
    venue: TradeVenueId;
    snapshot: VenueSnapshot | null;
    now: number;
    marketVenues: TradeVenueId[];
    notionalUsd: number;
  },
  capabilities: { maxLeverage: number; minNotionalUsd: number },
) {
  if (!args.marketVenues.includes(args.venue)) return "Market is not listed on this venue.";
  if (!args.snapshot) return "No fresh quote source is available.";
  const maxLeverage = args.snapshot?.maxLeverage ?? capabilities.maxLeverage;
  if (args.input.leverage > maxLeverage) return "Requested leverage is above this venue cap.";
  if (args.notionalUsd < capabilities.minNotionalUsd) return "Trade size is below this venue minimum.";
  if (args.now - args.snapshot.fetchedAt > MAX_QUOTE_FRESHNESS_MS) return "Quote is stale.";
  if (ownImpactBps(args.snapshot, args.input, args.notionalUsd) > args.input.slippageCapBps) {
    return "Estimated impact exceeds slippage cap.";
  }
  return null;
}

function pickBenchmarkVenue(input: RouteInput, snapshots: VenueSnapshot[], market: PerpMarket, notionalUsd: number) {
  const candidates = snapshots.filter((snapshot) => snapshot.marketId === input.marketId && market.venues.includes(snapshot.venue));
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    const impactDiff = ownImpactBps(left, input, notionalUsd) - ownImpactBps(right, input, notionalUsd);
    if (Math.abs(impactDiff) > 0.0001) return impactDiff;
    return TRADE_VENUE_PRIORITY.indexOf(left.venue) - TRADE_VENUE_PRIORITY.indexOf(right.venue);
  })[0].venue;
}

function sortQuotesForBestExecution(quotes: VenueQuote[]) {
  return [...quotes].sort((left, right) => {
    const costDiff = left.costs.totalCostUsd - right.costs.totalCostUsd;
    if (Math.abs(costDiff) > TIE_EPSILON_USD) return costDiff;
    const slippageDiff = left.costs.entrySlippageUsd - right.costs.entrySlippageUsd;
    if (Math.abs(slippageDiff) > TIE_EPSILON_USD) return slippageDiff;
    const freshnessDiff = (left.freshnessMs ?? Infinity) - (right.freshnessMs ?? Infinity);
    if (freshnessDiff !== 0) return freshnessDiff;
    return TRADE_VENUE_PRIORITY.indexOf(left.venue) - TRADE_VENUE_PRIORITY.indexOf(right.venue);
  });
}

function validateRouteInput(input: RouteInput) {
  if (!Number.isFinite(input.marginUsd) || input.marginUsd <= 0) throw new Error("Margin must be greater than zero.");
  if (!Number.isFinite(input.leverage) || input.leverage <= 0) throw new Error("Leverage must be greater than zero.");
  if (!Number.isFinite(input.slippageCapBps) || input.slippageCapBps < 0) {
    throw new Error("Slippage cap cannot be negative.");
  }
  if (input.holdTimeHours !== null && input.holdTimeHours !== undefined) {
    if (!Number.isFinite(input.holdTimeHours) || input.holdTimeHours < 0) throw new Error("Hold time cannot be negative.");
  }
}

function fillPrice(snapshot: VenueSnapshot, side: TradeSide, phase: "entry" | "exit", quantity: number) {
  const levels = side === "long" ? snapshot.asks : snapshot.bids;
  const swept = sweepBook(levels, quantity);
  if (swept !== null) return swept;

  const impactBps = phase === "entry" ? snapshot.entryImpactBps : snapshot.exitImpactBps;
  const impact = snapshot.midPrice * (impactBps / 10_000);
  return side === "long" ? snapshot.askPrice + impact : snapshot.bidPrice - impact;
}

function slippageUsd(side: TradeSide, fill: number, benchmarkMid: number, quantity: number) {
  const priceDiff = side === "long" ? fill - benchmarkMid : benchmarkMid - fill;
  return roundUsd(Math.max(0, priceDiff * quantity));
}

function ownImpactBps(snapshot: VenueSnapshot, input: RouteInput, notionalUsd: number) {
  const quantity = notionalUsd / snapshot.midPrice;
  const entry = fillPrice(snapshot, input.side, "entry", quantity);
  const exitSide = input.side === "long" ? "short" : "long";
  const exit = fillPrice(snapshot, exitSide, "exit", quantity);
  const entryImpact = priceImpactBps(input.side, entry, snapshot.midPrice);
  const exitImpact = priceImpactBps(exitSide, exit, snapshot.midPrice);
  return entryImpact + exitImpact;
}

function sweepBook(levels: VenueLevel[] | undefined, quantity: number) {
  if (!levels?.length || !Number.isFinite(quantity) || quantity <= 0) return null;
  let remaining = quantity;
  let notional = 0;
  for (const level of levels) {
    if (!Number.isFinite(level.price) || !Number.isFinite(level.size) || level.size <= 0) continue;
    const fillSize = Math.min(remaining, level.size);
    notional += fillSize * level.price;
    remaining -= fillSize;
    if (remaining <= 1e-12) return notional / quantity;
  }
  return null;
}

function depthUsd(snapshot: VenueSnapshot, side: TradeSide) {
  const levels = side === "long" ? snapshot.asks : snapshot.bids;
  if (!levels?.length) return null;
  const total = levels.reduce((sum, level) => sum + level.price * level.size, 0);
  return Number.isFinite(total) ? roundUsd(total) : null;
}

function priceImpactBps(side: TradeSide, fill: number, mid: number) {
  if (!Number.isFinite(fill) || !Number.isFinite(mid) || mid <= 0) return Infinity;
  const diff = side === "long" ? fill - mid : mid - fill;
  return Math.max(0, (diff / mid) * 10_000);
}

function feeUsd(notionalUsd: number, feeBps: number) {
  return roundUsd(notionalUsd * (feeBps / 10_000));
}

function fundingCostUsd(side: TradeSide, notionalUsd: number, rate: number, hours?: number | null) {
  if (!hours) return 0;
  const signedRate = side === "long" ? rate : -rate;
  return roundUsd(notionalUsd * signedRate * hours);
}

function totalCosts(costs: Omit<CostBreakdown, "totalCostUsd">): CostBreakdown {
  return {
    ...costs,
    totalCostUsd: roundUsd(Object.values(costs).reduce((sum, value) => sum + value, 0)),
  };
}

function zeroCosts(): CostBreakdown {
  return totalCosts({
    entryFeeUsd: 0,
    exitFeeUsd: 0,
    transferCostUsd: 0,
    entrySlippageUsd: 0,
    exitSlippageUsd: 0,
    fundingUsd: 0,
  });
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}
