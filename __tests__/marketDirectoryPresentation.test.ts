import {hasExecutableSpotRoute, isDirectoryMarketEligible, isHookedPool, isV4PoolLookup} from '../src/services/marketDirectoryPresentation';
import type {MarketDirectoryRow} from '../src/types/marketDirectory';

const verifiedPool: MarketDirectoryRow = {
  kind: 'spot', venueId: 'uniswap_v4_testnet', marketId: 'WMON_USDC', displayName: 'Uniswap v4',
  symbol: 'WMON/USDC', name: 'Wrapped MON / USDC', status: 'unavailable', available: false, verified: true,
  capabilities: {marketData: true, walletSwap: false}, testOnly: true,
};

describe('market directory presentation', () => {
  it('keeps a verified pool listed while its trade gate or quote is unavailable', () => {
    expect(isDirectoryMarketEligible(verifiedPool)).toBe(true);
    expect(isDirectoryMarketEligible({...verifiedPool, status: 'closed'})).toBe(true);
    expect(hasExecutableSpotRoute(verifiedPool)).toBe(false);
  });

  it('marks hook pools read only even when a wallet route is accidentally reported', () => {
    const hooked = {...verifiedPool, status: 'open' as const, available: true,
      poolKey: {currency0: `0x${'1'.repeat(40)}`, currency1: `0x${'2'.repeat(40)}`, fee: 3000, tickSpacing: 60, hooks: `0x${'3'.repeat(40)}`},
      capabilities: {marketData: true, walletSwap: true}};
    expect(isHookedPool(hooked)).toBe(true);
    expect(hasExecutableSpotRoute(hooked)).toBe(false);
  });

  it('keeps a pasted Uniswap pool visible when its quote or route is unavailable', () => {
    expect(isDirectoryMarketEligible({...verifiedPool, verified: false, status: 'unavailable', available: false,
      capabilities: {marketData: true, walletSwap: false}})).toBe(true);
  });

  it('accepts pasted token addresses and bytes32 Pool IDs only', () => {
    expect(isV4PoolLookup(`0x${'a'.repeat(40)}`)).toBe(true);
    expect(isV4PoolLookup(`0x${'b'.repeat(64)}`)).toBe(true);
    expect(isV4PoolLookup('WMON/USDC')).toBe(false);
    expect(isV4PoolLookup(`0x${'a'.repeat(41)}`)).toBe(false);
  });
});
