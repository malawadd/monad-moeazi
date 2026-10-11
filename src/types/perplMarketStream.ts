import type {MarketBook, MarketCandle, MarketQuote} from './marketDirectory';

export type PerplStreamStatus = 'connected' | 'reconnecting' | 'disconnected';
export type PerplPublicTrade = {id: string; price: number; size: number; side: 'buy' | 'sell'; occurredAt: number; blockNumber?: number};
export type PerplBookDelta = {price: number; size: number; orders: number};

export type PerplMarketStreamMessage =
  | {kind: 'gap'; reason: 'heartbeat_timeout' | 'heartbeat_sequence_gap'}
  | {kind: 'subscription'; subscriptions: Array<{stream: string; sid?: number; code?: number; error?: string}>}
  | {kind: 'heartbeat'; sequence: number; head?: number}
  | {kind: 'marketStates'; markets: Array<{marketId: string; quote: MarketQuote}>}
  | {kind: 'fundingUpdates'; updates: Array<{marketId: string; rate: number; observedAt: number}>}
  | {kind: 'candles'; marketId: string; resolutionSeconds: number; snapshot: boolean; candles: MarketCandle[]; observedAt: number}
  | {kind: 'book'; marketId: string; snapshot: boolean; bids: PerplBookDelta[]; asks: PerplBookDelta[]; observedAt: number; blockNumber?: number}
  | {kind: 'trades'; marketId: string; snapshot: boolean; trades: PerplPublicTrade[]; observedAt: number}
  | {kind: 'marketConfig'; raw: unknown};

const finite = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function streamTime(value: unknown): number {
  const parsed = finite(value) ?? 0;
  return parsed > 0 && parsed < 1_000_000_000_000 ? parsed * 1_000 : parsed;
}

function blockTime(value: any) { return streamTime(value?.t); }
function levels(value: unknown): PerplBookDelta[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: any) => {
    const price = finite(row?.p), size = finite(row?.s), orders = finite(row?.o) ?? 1;
    return price !== undefined && size !== undefined && orders >= 0 ? [{price, size, orders}] : [];
  });
}
function candles(value: unknown): MarketCandle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: any) => {
    const t = streamTime(row?.t), o = finite(row?.o), h = finite(row?.h), l = finite(row?.l), c = finite(row?.c);
    if (!t || o === undefined || h === undefined || l === undefined || c === undefined) return [];
    return [{t, o, h, l, c, v: String(row?.v ?? '0'), n: finite(row?.n)}];
  });
}
function publicTrades(value: unknown): PerplPublicTrade[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: any) => {
    const price = finite(row?.p), size = finite(row?.s), occurredAt = blockTime(row?.at);
    const side = finite(row?.sd);
    if (price === undefined || size === undefined || !occurredAt || (side !== 1 && side !== 2)) return [];
    const txid = String(row?.at?.txid ?? row?.at?.tx ?? '');
    const id = txid ? `${txid}:${String(row?.at?.tx ?? '')}` : `${occurredAt}:${price}:${size}:${side}`;
    return [{id, price, size, side: side === 2 ? 'sell' : 'buy', occurredAt,
      ...(finite(row?.at?.b) !== undefined ? {blockNumber: finite(row.at.b)} : {})}];
  });
}
function marketStream(stream: string | undefined, prefix: string): {marketId: string; resolution?: number} | null {
  const match = stream?.match(new RegExp(`^${prefix}@(\\d+)(?:\\*(\\d+))?$`));
  return match ? {marketId: match[1], ...(match[2] ? {resolution: Number(match[2])} : {})} : null;
}

/** Parses only documented public market frames; it never interprets trading/account frames. */
export function parsePerplPublicFrame(input: unknown, sidToStream: ReadonlyMap<number, string> = new Map()): PerplMarketStreamMessage[] {
  let frame: any = input;
  if (typeof input === 'string') { try { frame = JSON.parse(input); } catch { return []; } }
  if (!frame || typeof frame !== 'object') return [];
  if (frame.mt === 6) return [{kind: 'subscription', subscriptions: (Array.isArray(frame.subs) ? frame.subs : []).map((row: any) => ({
    stream: String(row?.stream ?? ''), sid: finite(row?.sid), code: finite(row?.status?.code), error: row?.status?.error,
  }))}];
  if (frame.mt === 100 && finite(frame.sn) !== undefined) return [{kind: 'heartbeat', sequence: Number(frame.sn), head: finite(frame.h)}];
  if (frame.mt === 8) return [{kind: 'marketConfig', raw: frame.d ?? frame}];
  if (frame.mt === 9 && frame.d && typeof frame.d === 'object') return [{kind: 'marketStates', markets: Object.entries(frame.d).flatMap(([marketId, raw]: [string, any]) => {
    const at = blockTime(raw?.at); const fields: Array<[keyof MarketQuote, unknown]> = [
      ['oracle', raw?.orl], ['mark', raw?.mrk], ['last', raw?.lst], ['mid', raw?.mid], ['bid', raw?.bid], ['ask', raw?.ask],
    ];
    const quote: MarketQuote = {observedAt: at, blockNumber: finite(raw?.at?.b)};
    for (const [key, value] of fields) { const parsed = finite(value); if (parsed !== undefined) (quote as any)[key] = parsed; }
    return at ? [{marketId, quote}] : [];
  })}];
  if (frame.mt === 10 && frame.d && typeof frame.d === 'object') return [{kind: 'fundingUpdates', updates: Object.entries(frame.d).flatMap(([marketId, row]: [string, any]) => {
    const rate = finite(row?.rate), observedAt = blockTime(row?.at);
    return rate !== undefined && observedAt ? [{marketId, rate, observedAt}] : [];
  })}];
  const sid = finite(frame.sid); const stream = sid === undefined ? undefined : sidToStream.get(sid);
  if (frame.mt === 11 || frame.mt === 12) {
    const match = marketStream(stream, 'candles'); const resolutionSeconds = finite(frame.r) ?? match?.resolution;
    const rows = candles(frame.d), observedAt = blockTime(frame.at) || rows.at(-1)?.t || Date.now();
    return match && resolutionSeconds ? [{kind: 'candles', marketId: match.marketId, resolutionSeconds,
      snapshot: frame.mt === 11, candles: rows, observedAt}] : [];
  }
  if (frame.mt === 15 || frame.mt === 16) {
    const match = marketStream(stream, 'order-book'); const observedAt = blockTime(frame.at) || Date.now();
    return match ? [{kind: 'book', marketId: match.marketId, snapshot: frame.mt === 15,
      bids: levels(frame.bid), asks: levels(frame.ask), observedAt, blockNumber: finite(frame.at?.b)}] : [];
  }
  if (frame.mt === 17 || frame.mt === 18) {
    const match = marketStream(stream, 'trades'); const trades = publicTrades(frame.d);
    return match ? [{kind: 'trades', marketId: match.marketId, snapshot: frame.mt === 17,
      trades, observedAt: trades[0]?.occurredAt ?? Date.now()}] : [];
  }
  return [];
}

export function mergeCandles(previous: MarketCandle[], incoming: MarketCandle[], limit = 1_024): MarketCandle[] {
  const byTime = new Map<number, MarketCandle>();
  for (const candle of [...previous, ...incoming]) {
    if (Number.isFinite(Number(candle.t)) && Number(candle.t) > 0) byTime.set(Number(candle.t), candle);
  }
  return [...byTime.values()].sort((a, b) => Number(a.t) - Number(b.t)).slice(-limit);
}

export function mergePublicTrades(previous: PerplPublicTrade[], incoming: PerplPublicTrade[], limit = 50) {
  const byId = new Map<string, PerplPublicTrade>();
  for (const trade of [...previous, ...incoming]) if (trade.id) byId.set(trade.id, trade);
  return [...byId.values()].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, limit);
}
