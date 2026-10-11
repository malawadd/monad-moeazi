import type {MarketDirectoryRow} from '../types/marketDirectory';

export type MarketCategory = 'all' | 'spot' | 'perpl';

export function isDirectoryMarketEligible(market: MarketDirectoryRow, category: MarketCategory = 'all') {
  if (category !== 'all' && market.kind !== category) return false;
  if (market.kind === 'perpl') return market.status === 'open' || market.marketOpen === true;
  if (market.venueId === 'uniswap_v4_testnet' || market.verified === true) return true;
  return market.status === 'open' && Boolean(market.capabilities.marketData);
}

export function isHookedPool(market: MarketDirectoryRow) {
  return Boolean(market.poolKey?.hooks && !/^0x0{40}$/i.test(market.poolKey.hooks));
}

export function hasExecutableSpotRoute(market: MarketDirectoryRow) {
  return market.kind === 'spot' && !market.readOnly && !isHookedPool(market)
    && Boolean(market.capabilities.walletSwap ?? (market.capabilities.buy || market.capabilities.sell));
}

export function isV4PoolLookup(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim()) || /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}
