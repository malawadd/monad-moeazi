jest.mock('../src/services/marketDirectoryApi', () => ({marketDirectoryApi: {
  resolve: jest.fn(),
  snapshot: jest.fn(),
}}));
jest.mock('../src/services/manualPerplApi', () => ({manualPerplApi: {account: jest.fn()}}));
jest.mock('../src/services/perplApi', () => ({perplApi: {current: jest.fn()}}));
jest.mock('../src/services/monadApi', () => ({monadApi: {wallet: jest.fn(), activity: jest.fn()}}));

import {marketDirectoryApi} from '../src/services/marketDirectoryApi';
import {marketCacheTimes, marketSnapshotQueryOptions, resolveMarketsForInput} from '../src/services/useMarketQueries';
import {invalidateAfterFinalizedOperation, marketQueryKeys, queryClient} from '../src/services/queryCache';

const resolve = marketDirectoryApi.resolve as jest.MockedFunction<typeof marketDirectoryApi.resolve>;

describe('owner-scoped market query cache', () => {
  beforeEach(() => { queryClient.clear(); jest.clearAllMocks(); });
  afterAll(() => queryClient.clear());

  it('uses separate cache keys for different owners', () => {
    expect(marketQueryKeys.directory('0xAAAA')).not.toEqual(marketQueryKeys.directory('0xBBBB'));
    expect(marketQueryKeys.lookup('0xAAAA', '0xPOOL')).not.toEqual(marketQueryKeys.lookup('0xBBBB', '0xPOOL'));
  });

  it('uses the requested freshness windows for market and account data', () => {
    expect(marketCacheTimes).toEqual({directory: 30_000, snapshot: 10_000, candles: 60_000, account: 15_000, history: 15_000});
  });

  it('deduplicates concurrent lookup requests and reuses a fresh owner-scoped result', async () => {
    resolve.mockImplementation(async query => {
      await Promise.resolve();
      return {markets: [{kind: 'spot', venueId: 'uniswap_v4_testnet', marketId: query, displayName: 'Uniswap v4',
        symbol: 'WMON/USDC', name: 'WMON/USDC', status: 'open', available: true,
        capabilities: {marketData: true}, testOnly: true}]};
    });
    const [first, concurrent] = await Promise.all([
      resolveMarketsForInput('0xAAAA', `0x${'a'.repeat(64)}`),
      resolveMarketsForInput('0xAAAA', `0x${'a'.repeat(64)}`),
    ]);
    expect(first).toEqual(concurrent);
    await resolveMarketsForInput('0xAAAA', `0x${'a'.repeat(64)}`);
    expect(resolve).toHaveBeenCalledTimes(1);
    await resolveMarketsForInput('0xBBBB', `0x${'a'.repeat(64)}`);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('does not repeat a snapshot call when reopening a market within its fresh window', async () => {
    const snapshot = marketDirectoryApi.snapshot as jest.MockedFunction<typeof marketDirectoryApi.snapshot>;
    snapshot.mockImplementation(async (_venue, marketId) => ({market: {
      kind: 'spot', venueId: 'uniswap_v4_testnet', marketId, displayName: 'Uniswap v4', symbol: 'WMON/USDC',
      name: 'Wrapped MON / USDC', status: 'open', available: true, capabilities: {marketData: true}, testOnly: true,
    }, observedAt: Date.now(), book: null}));
    const openMarket = (owner: string) => queryClient.fetchQuery(marketSnapshotQueryOptions(owner, 'uniswap_v4_testnet', 'WMON_USDC'));

    await openMarket('0xAAAA');
    // Leave the market screen, then reopen it within the same owner's ten-second freshness window.
    await openMarket('0xAAAA');
    expect(snapshot).toHaveBeenCalledTimes(1);
    await openMarket('0xBBBB');
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('invalidates balances, positions, markets, and history only for the finalized owner', async () => {
    const ownerA = '0xAAAA';
    const ownerB = '0xBBBB';
    const keysA = [marketQueryKeys.wallet(ownerA), marketQueryKeys.manualAccount(ownerA),
      marketQueryKeys.snapshot(ownerA, 'uniswap_v4_testnet', 'WMON_USDC'), marketQueryKeys.activity(ownerA)];
    const keyB = marketQueryKeys.wallet(ownerB);
    [...keysA, keyB].forEach(key => queryClient.setQueryData(key, {cached: true}));

    await invalidateAfterFinalizedOperation(ownerA);

    keysA.forEach(key => expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(keyB)?.isInvalidated).toBe(false);
  });
});
