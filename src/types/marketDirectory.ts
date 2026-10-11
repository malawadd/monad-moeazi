import type {MonadMarketAsset} from './monad';

export type MarketVenueId = string;
export type MarketCapabilities = {
  marketData: boolean;
  buy?: boolean;
  sell?: boolean;
  walletSwap?: boolean;
  manualLongShort?: boolean;
  limitOrders?: boolean;
  cancelOrders?: boolean;
  closePosition?: boolean;
};

export type V4PoolKey = {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
};

export type MarketQuote = {
  price?: number | string;
  basePerQuote?: number | string;
  buy?: {price?: number | string; amountUnits?: string; [field: string]: unknown};
  sell?: {price?: number | string; amountUnits?: string; [field: string]: unknown};
  oracle?: number | string;
  mark?: number | string;
  last?: number | string;
  mid?: number | string;
  bid?: number | string;
  ask?: number | string;
  observedAt?: number | string;
  blockNumber?: number | string;
};

export type MarketCandle = {
  t: number;
  o: number | string;
  h: number | string;
  l: number | string;
  c: number | string;
  v?: number | string;
  n?: number;
};

export type MarketDirectoryRow = {
  kind: 'perpl' | 'spot';
  venueId: MarketVenueId;
  marketId: string;
  displayName: string;
  symbol: string;
  name: string;
  status: 'open' | 'closed' | 'unavailable';
  marketOpen?: boolean;
  available: boolean;
  capabilities: MarketCapabilities;
  testOnly: boolean;
  chainId?: number;
  priceDecimals?: number;
  sizeDecimals?: number;
  maxLeverage?: number;
  initialMarginBps?: number;
  maintenanceMarginBps?: number;
  minPostingUnits?: string;
  makerFeeMicros?: number;
  takerFeeMicros?: number;
  maxMarketSlippageBps?: number;
  manualMaxOrderUnits?: string;
  manualMaxLeverage?: number;
  manualMaxSlippageBps?: number;
  quote?: MarketQuote | null;
  fundingRateMicros?: number | null;
  fundingObservedAt?: number | string | null;
  baseAsset?: MonadMarketAsset;
  quoteAsset?: MonadMarketAsset;
  reason?: string | null;
  price?: number | string | null;
  change24h?: number | string | null;
  liquidity?: number | string | null;
  quoteAvailable?: boolean;
  poolId?: string;
  poolKey?: V4PoolKey;
  verified?: boolean;
  verificationSource?: string | null;
  readOnly?: boolean;
  [field: string]: unknown;
};

export type MarketDirectoryResponse = {observedAt: number | string; markets: MarketDirectoryRow[]};

export type MarketBook = {
  bids: Array<{price: number | string; size: number | string}>;
  asks: Array<{price: number | string; size: number | string}>;
  observedAt?: number | string;
  blockNumber?: number | string;
};

export type MarketDetailResponse = {
  market: MarketDirectoryRow;
  book?: MarketBook | null;
  candles: MarketCandle[];
  resolutionSeconds: number | null;
  candleTimeUnit?: 'milliseconds' | 'seconds';
  observedAt: number | string;
  manualPosition?: Record<string, unknown> | null;
};

export type MarketSnapshotResponse = {
  market: MarketDirectoryRow;
  book?: MarketBook | null;
  observedAt: number | string;
  unavailable?: boolean;
};

export type MarketCandlesResponse = {
  market: MarketDirectoryRow;
  candles: MarketCandle[];
  resolutionSeconds: number | null;
  candleTimeUnit?: 'milliseconds' | 'seconds';
  candlesUnavailable?: boolean;
  unavailable?: boolean;
  observedAt: number | string;
};

export type MarketTradeSummary = {
  summaryId: string;
  runId?: string | null;
  priceDecimals?: number;
  sizeDecimals?: number;
  venueId: MarketVenueId;
  marketId: string;
  symbol: string;
  direction: 'long' | 'short' | 'buy' | 'sell';
  sizeUnits: string;
  entrySizeUnits?: string | null;
  remainingSizeUnits?: string | null;
  weightedEntryPrice?: number | string | null;
  weightedExitPrice?: number | string | null;
  entryAt?: number | string | null;
  exitAt?: number | string | null;
  feesUnits?: string | null;
  feesKnown?: boolean;
  fundingUnits?: string | null;
  realizedPricePnlUnits?: string | null;
  netRealizedPnlUnits?: string | null;
  status: string;
  source: 'manual' | 'autonomous';
  orderIds: string[];
  transactionHashes: string[];
  activityIds: string[];
};

export type MarketTradeActivity = {
  id: string;
  title: string;
  summary: string;
  status: string;
  occurredAt: string | number;
  transactionHash?: string | null;
};

export type MarketTradesResponse = {summaries: MarketTradeSummary[]; activity: MarketTradeActivity[]};

export function marketIdentity(venueId: string, marketId: string) {
  return `${venueId}:${marketId}`;
}

export function uniqueMarketTradeActivity(activity: MarketTradeActivity[]) {
  const seen = new Set<string>();
  return activity.filter(event => {
    if (!event.id || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}
