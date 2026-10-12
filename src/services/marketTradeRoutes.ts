import type {MarketDirectoryRow} from '../types/marketDirectory';
import type {MonadMarketAsset, MonadVenueId} from '../types/monad';

export function spotTradeReviewParams(market: MarketDirectoryRow) {
  if (!market.baseAsset || !market.quoteAsset) return null;
  return {marketId: market.marketId, venue: market.venueId as MonadVenueId, accountScope: 'wallet' as const,
    baseAsset: market.baseAsset as MonadMarketAsset, quoteAsset: market.quoteAsset as MonadMarketAsset,
    poolId: market.poolId, poolKey: market.poolKey, verified: market.verified === true,
    verificationSource: market.verificationSource};
}

export type SpotTradeDraft = {side: 'buy' | 'sell'; amount: string; slippage: string};

/** Restore only the user's editable swap inputs; executable quotes are never route state. */
export function spotTradeDraftFromParams(params: unknown): SpotTradeDraft {
  const route = asRecord(params);
  const draft = asRecord(route.swapDraft);
  return {
    side: draft.side === 'sell' || (draft.side === undefined && route.side === 'sell') ? 'sell' : 'buy',
    amount: typeof draft.amount === 'string' ? draft.amount : '',
    slippage: typeof draft.slippage === 'string' ? draft.slippage : '50',
  };
}

export function spotTradeApprovalReturnParams(params: unknown, draft: SpotTradeDraft) {
  const route = {...asRecord(params)};
  delete route.swapDraft;
  delete route.quote;
  return {...route, swapDraft: {side: draft.side, amount: draft.amount, slippage: draft.slippage}};
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export type PerplTradeAction = 'close_position' | 'reduce_size' | 'add_margin';
export function perplTradeRouteParams(market: MarketDirectoryRow, request: {side?: 'short'; action?: PerplTradeAction; positionSide?: string} = {}) {
  if (market.kind !== 'perpl') return null;
  if (request.action) return {marketId: market.marketId, symbol: market.symbol, side: request.positionSide,
    sizeDecimals: market.sizeDecimals, priceDecimals: market.priceDecimals, action: request.action};
  return {marketId: market.marketId, symbol: market.symbol, priceDecimals: market.priceDecimals,
    sizeDecimals: market.sizeDecimals, maxLeverage: market.maxLeverage, ...(request.side ? {side: request.side} : {})};
}
