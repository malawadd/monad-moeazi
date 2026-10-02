import { postHyperliquidInfo } from "./hyperliquidApi";
import type { PerpMarket } from "./types";

export type HyperliquidMetaAsset = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  onlyIsolated?: boolean | null;
  isDelisted?: boolean | null;
};

export type HyperliquidAssetCtx = {
  funding?: string;
  openInterest?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  dayBaseVlm?: string;
  oraclePx?: string;
  markPx?: string;
  midPx?: string;
};

export type HyperliquidMetaAndCtxs = [
  { universe: HyperliquidMetaAsset[] },
  HyperliquidAssetCtx[],
];

export const DEFAULT_HYPERLIQUID_COIN = "BTC";
const MARKET_CACHE_MS = 15_000;
const STALE_MARKET_CACHE_MS = 180_000;

let marketCache: { markets: PerpMarket[]; fetchedAt: number } | null = null;

export function canonicalHyperliquidCoin(value: string | null | undefined) {
  const raw = decodeURIComponent(value ?? "").trim();
  if (!raw) return DEFAULT_HYPERLIQUID_COIN;
  return raw.replace(/-PERP$/i, "").toUpperCase();
}

export function tradePathForCoin(value: string | null | undefined) {
  return `/trade/${canonicalHyperliquidCoin(value)}`;
}

export function vizPathForCoin(value: string | null | undefined) {
  return `/viz/${canonicalHyperliquidCoin(value)}`;
}

export function isCanonicalTradePathCoin(value: string | null | undefined) {
  const raw = decodeURIComponent(value ?? "").trim();
  return raw === canonicalHyperliquidCoin(raw);
}

export async function getLiveHyperliquidMarkets(now = Date.now()) {
  if (marketCache && now - marketCache.fetchedAt < MARKET_CACHE_MS) return stampMarkets(marketCache.markets, now);
  try {
    const payload = await postHyperliquidInfo<HyperliquidMetaAndCtxs>({
      type: "metaAndAssetCtxs",
    });
    const markets = buildHyperliquidMarkets(payload, now);
    marketCache = { markets, fetchedAt: now };
    return markets;
  } catch (error) {
    if (marketCache && now - marketCache.fetchedAt < STALE_MARKET_CACHE_MS) return stampMarkets(marketCache.markets, now);
    throw error;
  }
}

export async function getLiveHyperliquidMarket(coin: string, now = Date.now()) {
  try {
    return findHyperliquidMarket(await getLiveHyperliquidMarkets(now), coin);
  } catch {
    const meta = await postHyperliquidInfo<{ universe: HyperliquidMetaAsset[] }>({ type: "meta" });
    return findHyperliquidMarket(buildHyperliquidMarkets([meta, []], now), coin);
  }
}

export function buildHyperliquidMarkets(payload: HyperliquidMetaAndCtxs, now = Date.now()): PerpMarket[] {
  const [meta, ctxs] = payload;
  return meta.universe
    .map((asset, assetIndex) => normalizeMarket(asset, ctxs[assetIndex], assetIndex, now))
    .filter((market): market is PerpMarket => Boolean(market));
}

export function findHyperliquidMarket(markets: PerpMarket[], coin: string) {
  const canonical = canonicalHyperliquidCoin(coin);
  return markets.find((market) => canonicalHyperliquidCoin(market.id) === canonical) ?? null;
}

export function priceDecimalsFromSizeDecimals(szDecimals: number) {
  return Math.max(0, 6 - Math.max(0, szDecimals));
}

function normalizeMarket(
  asset: HyperliquidMetaAsset,
  ctx: HyperliquidAssetCtx | undefined,
  assetIndex: number,
  now: number,
): PerpMarket | null {
  if (!asset?.name || asset.isDelisted) return null;
  const mark = numberOrNull(ctx?.markPx);
  const mid = numberOrNull(ctx?.midPx);
  const oracle = numberOrNull(ctx?.oraclePx);
  const prev = numberOrNull(ctx?.prevDayPx);
  const reference = mark ?? mid ?? oracle;
  const openInterest = numberOrNull(ctx?.openInterest);
  const dayChangePct =
    reference !== null && prev !== null && prev > 0
      ? ((reference - prev) / prev) * 100
      : null;

  return {
    id: asset.name,
    label: `${asset.name} Perp`,
    baseSymbol: asset.name,
    quoteSymbol: "USDC",
    category: "crypto",
    pricePrecision: priceDecimalsFromSizeDecimals(asset.szDecimals),
    maxLeverage: asset.maxLeverage,
    szDecimals: asset.szDecimals,
    assetIndex,
    onlyIsolated: Boolean(asset.onlyIsolated),
    isDelisted: Boolean(asset.isDelisted),
    markPrice: reference,
    oraclePrice: oracle,
    prevDayPrice: prev,
    dayChangePct,
    dayBaseVolume: numberOrNull(ctx?.dayBaseVlm),
    openInterestUsd:
      openInterest !== null && reference !== null ? openInterest * reference : null,
    volume24hUsd: numberOrNull(ctx?.dayNtlVlm),
    fundingRateHourly: numberOrNull(ctx?.funding),
    fetchedAt: now,
    venues: ["hyperliquid"],
  } satisfies PerpMarket;
}

function numberOrNull(value: string | number | null | undefined) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function stampMarkets(markets: PerpMarket[], now: number) {
  return markets.map((market) => ({ ...market, fetchedAt: now }));
}
