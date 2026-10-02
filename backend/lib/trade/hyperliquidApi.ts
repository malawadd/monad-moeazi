import type { PerpMarket, VenueLevel, VenueSnapshot } from "./types";

export const HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz";
export const HYPERLIQUID_WS_URL = "wss://api.hyperliquid.xyz/ws";
export const HYPERLIQUID_BRIDGE_ADDRESS = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";

export type HyperliquidBook = {
  coin: string;
  bids: VenueLevel[];
  asks: VenueLevel[];
  time: number;
};

export type HyperliquidAccountState = {
  accountValueUsd: number;
  withdrawableUsd: number;
  positions: Array<Record<string, unknown>>;
  raw: unknown;
};

export function coinForHyperliquidMarket(marketId: string) {
  const coin = marketId.trim().replace(/-PERP$/i, "");
  if (!coin || coin.includes("/") || /\s/.test(coin)) return null;
  return coin;
}

export async function postHyperliquidInfo<T>(body: unknown): Promise<T> {
  return await postJsonWithRetry<T>(`${HYPERLIQUID_API_URL}/info`, body, "info");
}

export async function postHyperliquidExchange(body: unknown): Promise<unknown> {
  return await postJsonWithRetry<unknown>(`${HYPERLIQUID_API_URL}/exchange`, body, "exchange");
}

export async function readHyperliquidRestSnapshot(market: PerpMarket, now = Date.now()) {
  const coin = coinForHyperliquidMarket(market.id);
  if (!coin) return null;
  const [mids, book] = await Promise.all([
    postHyperliquidInfo<Record<string, string>>({ type: "allMids" }),
    postHyperliquidInfo<{ levels?: Array<Array<{ px: string; sz: string }>>; time?: number }>({
      type: "l2Book",
      coin,
    }),
  ]);
  const mid = Number(mids[coin]);
  const bids = normalizeLevels(book.levels?.[0]);
  const asks = normalizeLevels(book.levels?.[1]);
  const bid = bids[0]?.price ?? mid;
  const ask = asks[0]?.price ?? mid;
  if (!Number.isFinite(mid) || !Number.isFinite(bid) || !Number.isFinite(ask)) return null;

  const mark = market.markPrice ?? mid;
  const oracle = market.oraclePrice ?? undefined;
  const prev = market.prevDayPrice ?? undefined;
  const dayChangePct =
    mark && prev && prev > 0 ? ((mark - prev) / prev) * 100 : market.dayChangePct ?? undefined;
  return {
    venue: "hyperliquid",
    marketId: market.id,
    coin,
    assetIndex: market.assetIndex,
    szDecimals: market.szDecimals,
    maxLeverage: market.maxLeverage,
    midPrice: mid,
    markPrice: mark,
    oraclePrice: oracle,
    prevDayPrice: prev,
    dayChangePct,
    bidPrice: bid,
    askPrice: ask,
    bids,
    asks,
    entryImpactBps: 0,
    exitImpactBps: 0,
    fundingRateHourly: Number(market.fundingRateHourly ?? 0),
    dayBaseVolume: market.dayBaseVolume ?? undefined,
    openInterestUsd: market.openInterestUsd ?? 0,
    volume24hUsd: Number(market.volume24hUsd ?? 0),
    fetchedAt: book.time ?? now,
    source: "public",
  } satisfies VenueSnapshot;
}

export async function readHyperliquidAccountState(user: string): Promise<HyperliquidAccountState> {
  const raw = await postHyperliquidInfo<Record<string, unknown>>({ type: "clearinghouseState", user });
  const margin = asRecord(raw.marginSummary);
  return {
    accountValueUsd: Number(margin.accountValue ?? 0),
    withdrawableUsd: Number(raw.withdrawable ?? margin.accountValue ?? 0),
    positions: Array.isArray(raw.assetPositions)
      ? (raw.assetPositions as Array<Record<string, unknown>>)
      : [],
    raw,
  };
}

export async function waitForHyperliquidCredit(user: string, minAccountValueUsd: number, timeoutMs = 70_000) {
  const startedAt = Date.now();
  let last: HyperliquidAccountState | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    last = await readHyperliquidAccountState(user);
    if (last.accountValueUsd >= minAccountValueUsd) return last;
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }
  throw new Error(
    `Hyperliquid deposit is not credited yet. Last account value: ${last?.accountValueUsd ?? 0} USDC.`,
  );
}

export function normalizeLevels(levels: Array<{ px: string; sz: string }> | undefined) {
  return (levels ?? [])
    .map((level) => ({ price: Number(level.px), size: Number(level.sz) }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size) && level.size > 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function postJsonWithRetry<T>(url: string, body: unknown, label: string) {
  let lastError = "";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return (await response.json()) as T;
    const text = await response.text();
    lastError = `Hyperliquid ${label} failed (${response.status}): ${text.slice(0, 240)}`;
    if (![429, 500, 502, 503, 504].includes(response.status)) break;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(6000, 600 * 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(lastError);
}
