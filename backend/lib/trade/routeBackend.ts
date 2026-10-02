import { agentRequest } from "@/lib/agentBackend";
import { findHyperliquidMarket, getLiveHyperliquidMarkets } from "./hyperliquidMarkets";
import type { BestExecutionQuote, PerpMarket, RouteInput, TradeVenueId } from "./types";

type BackendMarket = {
  market_id: string; label: string; base_symbol: string; quote_symbol: string;
  category: "crypto" | "rwa"; max_leverage: number; price_precision: number; venues: TradeVenueId[];
  mark_price?: number | null; oracle_price?: number | null; prev_day_price?: number | null;
  day_change_pct?: number | null; open_interest_usd?: number | null; volume_24h_usd?: number | null;
  funding_rate_hourly?: number | null;
};

type BackendQuote = {
  venue: TradeVenueId; venue_label: string; kind: "clob" | "onchain";
  market_eligible: boolean; account_ready: boolean; executable: boolean;
  reason?: string | null; setup_requirement?: string | null;
  mid_price?: number | null; estimated_entry_price?: number | null; estimated_exit_price?: number | null;
  available_depth_usd?: number | null; notional_usd: number; max_leverage: number;
  fee_rate_bps: number; freshness_ms?: number | null; source: string;
  costs: {
    entry_fee_usd: number; exit_fee_usd: number; entry_slippage_usd: number;
    exit_slippage_usd: number; funding_usd: number; setup_cost_usd: number; total_cost_usd: number;
  };
};

type BackendPreview = {
  request: { market_id: string; side: "long" | "short"; margin_usd: number; leverage: number; hold_time_hours?: number | null; slippage_cap_bps: number };
  market: BackendMarket; best_market_venue?: TradeVenueId | null; best_executable_venue?: TradeVenueId | null;
  selected_venue?: TradeVenueId | null; override_applied: boolean; quotes: BackendQuote[];
  warnings: string[]; created_at: string;
};

const ROUTING_VENUES = new Set<string>(["hyperliquid", "lighter", "orderly", "gmx", "ostium"]);

export async function loadRoutingMarkets(): Promise<PerpMarket[]> {
  const result = await agentRequest<{ markets: BackendMarket[] }>("v1/routing/markets");
  return hydrateMarketPrices(result.markets.map(mapMarket));
}

export async function previewBestRoute(args: {
  input: RouteInput; readyVenues: TradeVenueId[]; allowedVenues?: TradeVenueId[]; overrideVenue?: TradeVenueId | null;
}): Promise<BestExecutionQuote> {
  const request = buildRoutePreviewRequest(args);
  const payload = await agentRequest<BackendPreview>("v1/routing/preview", {
    method: "POST",
    body: JSON.stringify(request),
  });
  return {
    input: args.input, market: mapMarket(payload.market),
    notionalUsd: payload.request.margin_usd * payload.request.leverage,
    benchmarkVenue: payload.best_market_venue ?? null,
    winningVenue: payload.selected_venue ?? null,
    bestMarketVenue: payload.best_market_venue ?? null,
    bestExecutableVenue: payload.best_executable_venue ?? null,
    selectedVenue: payload.selected_venue ?? null,
    overrideApplied: payload.override_applied, warnings: payload.warnings,
    createdAt: Date.parse(payload.created_at),
    quotes: payload.quotes.map((row) => ({
      venue: row.venue, venueLabel: row.venue_label, kind: row.kind,
      eligible: row.market_eligible, accountReady: row.account_ready, executable: row.executable,
      reason: row.reason ?? undefined, setupRequirement: row.setup_requirement,
      source: row.source === "none" ? "none" : "public",
      midPrice: row.mid_price ?? null, estimatedEntryPrice: row.estimated_entry_price ?? null,
      estimatedExitPrice: row.estimated_exit_price ?? null, notionalUsd: row.notional_usd,
      marginUsd: payload.request.margin_usd, maxLeverage: row.max_leverage,
      availableDepthUsd: row.available_depth_usd, feeRateBps: row.fee_rate_bps,
      freshnessMs: row.freshness_ms ?? null,
      costs: {
        entryFeeUsd: row.costs.entry_fee_usd, exitFeeUsd: row.costs.exit_fee_usd,
        transferCostUsd: row.costs.setup_cost_usd,
        entrySlippageUsd: row.costs.entry_slippage_usd, exitSlippageUsd: row.costs.exit_slippage_usd,
        fundingUsd: row.costs.funding_usd, totalCostUsd: row.costs.total_cost_usd,
      },
    })),
  };
}

export function isRoutingVenue(value: unknown): value is TradeVenueId {
  return typeof value === "string" && ROUTING_VENUES.has(value);
}

export function buildRoutePreviewRequest(args: {
  input: RouteInput;
  readyVenues: unknown[];
  allowedVenues?: unknown[];
  overrideVenue?: unknown;
}) {
  return {
    market_id: args.input.marketId,
    side: args.input.side,
    margin_usd: args.input.marginUsd,
    leverage: args.input.leverage,
    hold_time_hours: args.input.holdTimeHours,
    slippage_cap_bps: args.input.slippageCapBps,
    ready_venues: args.readyVenues.filter(isRoutingVenue),
    allowed_venues: args.allowedVenues?.filter(isRoutingVenue),
    override_venue: isRoutingVenue(args.overrideVenue) ? args.overrideVenue : null,
  };
}

export function mapMarket(market: BackendMarket): PerpMarket {
  return {
    id: market.market_id, label: market.label, baseSymbol: market.base_symbol,
    quoteSymbol: "USDC", category: market.category, pricePrecision: market.price_precision,
    maxLeverage: market.max_leverage,
    markPrice: market.mark_price ?? null,
    oraclePrice: market.oracle_price ?? null,
    prevDayPrice: market.prev_day_price ?? null,
    dayChangePct: market.day_change_pct ?? null,
    openInterestUsd: market.open_interest_usd ?? null,
    volume24hUsd: market.volume_24h_usd ?? null,
    fundingRateHourly: market.funding_rate_hourly ?? null,
    venues: market.venues,
  };
}

async function hydrateMarketPrices(markets: PerpMarket[]) {
  if (markets.every((market) => market.markPrice !== null && market.markPrice !== undefined)) return markets;
  const hyperliquidMarkets = await getLiveHyperliquidMarkets().catch(() => []);
  if (hyperliquidMarkets.length === 0) return markets;
  return markets.map((market) => mergeLiveHyperliquidMarketData(market, hyperliquidMarkets));
}

export function mergeLiveHyperliquidMarketData(market: PerpMarket, hyperliquidMarkets: PerpMarket[]) {
  if (!market.venues.includes("hyperliquid")) return market;
  const live = findHyperliquidMarket(hyperliquidMarkets, market.id);
  if (!live) return market;
  return {
    ...market,
    pricePrecision: market.pricePrecision ?? live.pricePrecision,
    szDecimals: market.szDecimals ?? live.szDecimals,
    assetIndex: market.assetIndex ?? live.assetIndex,
    onlyIsolated: market.onlyIsolated ?? live.onlyIsolated,
    isDelisted: market.isDelisted ?? live.isDelisted,
    markPrice: market.markPrice ?? live.markPrice ?? null,
    oraclePrice: market.oraclePrice ?? live.oraclePrice ?? null,
    prevDayPrice: market.prevDayPrice ?? live.prevDayPrice ?? null,
    dayChangePct: market.dayChangePct ?? live.dayChangePct ?? null,
    dayBaseVolume: market.dayBaseVolume ?? live.dayBaseVolume ?? null,
    openInterestUsd: market.openInterestUsd ?? live.openInterestUsd ?? null,
    volume24hUsd: market.volume24hUsd ?? live.volume24hUsd ?? null,
    fundingRateHourly: market.fundingRateHourly ?? live.fundingRateHourly ?? null,
    fetchedAt: market.fetchedAt ?? live.fetchedAt,
  };
}
