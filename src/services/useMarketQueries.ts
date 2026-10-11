import {useQuery} from '@tanstack/react-query';
import {marketDirectoryApi} from './marketDirectoryApi';
import {manualPerplApi} from './manualPerplApi';
import {perplApi} from './perplApi';
import {monadApi} from './monadApi';
import {marketQueryKeys, queryClient} from './queryCache';

const ownerKey = (ownerAddress: string | null | undefined) => ownerAddress?.toLowerCase() ?? 'signed-out';

export const marketCacheTimes = {directory: 30_000, snapshot: 10_000, candles: 60_000, account: 15_000, history: 15_000} as const;

export function marketSnapshotQueryOptions(ownerAddress: string, venueId: string, marketId: string) {
  return {
    queryKey: marketQueryKeys.snapshot(ownerKey(ownerAddress), venueId, marketId),
    queryFn: () => marketDirectoryApi.snapshot(venueId, marketId),
    staleTime: marketCacheTimes.snapshot,
  };
}

export function useMarketDirectoryQuery(ownerAddress: string | null, focused: boolean) {
  const owner = ownerKey(ownerAddress);
  return useQuery({
    queryKey: marketQueryKeys.directory(owner),
    queryFn: () => marketDirectoryApi.list(),
    enabled: Boolean(ownerAddress),
    staleTime: marketCacheTimes.directory,
    refetchInterval: focused ? marketCacheTimes.directory : false,
  });
}

export function useMarketSnapshotQuery(ownerAddress: string | null, venueId: string, marketId: string, enabled: boolean) {
  const owner = ownerKey(ownerAddress);
  return useQuery({
    ...marketSnapshotQueryOptions(owner, venueId, marketId),
    enabled: Boolean(ownerAddress && venueId && marketId && enabled),
    refetchInterval: enabled ? marketCacheTimes.snapshot : false,
  });
}

export function useMarketCandlesQuery(ownerAddress: string | null, venueId: string, marketId: string,
  window: {resolutionSeconds: number; durationMs: number}, enabled: boolean) {
  const owner = ownerKey(ownerAddress);
  return useQuery({
    queryKey: marketQueryKeys.candles(owner, venueId, marketId, window.resolutionSeconds),
    queryFn: () => marketDirectoryApi.candles(venueId, marketId, {
      resolutionSeconds: window.resolutionSeconds,
      from: Date.now() - window.durationMs,
      to: Date.now(),
    }),
    enabled: Boolean(ownerAddress && venueId && marketId && enabled),
    staleTime: marketCacheTimes.candles,
    refetchInterval: enabled ? marketCacheTimes.candles : false,
  });
}

export function useMarketTradesQuery(ownerAddress: string | null, venueId: string | undefined, marketId: string | undefined, enabled: boolean) {
  const owner = ownerKey(ownerAddress);
  return useQuery({
    queryKey: marketQueryKeys.trades(owner, venueId, marketId),
    queryFn: () => marketDirectoryApi.trades(venueId, marketId),
    enabled: Boolean(ownerAddress && enabled),
    staleTime: marketCacheTimes.history,
    refetchInterval: enabled ? marketCacheTimes.history : false,
  });
}

export function useMonadWalletQuery(ownerAddress: string | null, enabled: boolean) {
  const owner = ownerKey(ownerAddress);
  return useQuery({
    queryKey: marketQueryKeys.wallet(owner),
    queryFn: async () => {
      const snapshot = await monadApi.wallet();
      if (!ownerAddress || snapshot.chainId !== 10143 || snapshot.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new Error('The wallet snapshot does not match this Mera session on Monad Testnet.');
      }
      return snapshot;
    },
    enabled: Boolean(ownerAddress && enabled),
    staleTime: marketCacheTimes.account,
    refetchInterval: enabled ? marketCacheTimes.account : false,
  });
}

export function useMonadActivityQuery(ownerAddress: string | null, cursor: string | null = null, enabled = true) {
  const owner = ownerKey(ownerAddress);
  return useQuery({
    queryKey: marketQueryKeys.activity(owner, cursor),
    queryFn: () => monadApi.activity(60, cursor ?? undefined),
    enabled: Boolean(ownerAddress && enabled),
    staleTime: marketCacheTimes.history,
    refetchInterval: enabled && !cursor ? marketCacheTimes.history : false,
  });
}

export function fetchMonadActivityPage(ownerAddress: string, cursor: string | null) {
  const owner = ownerKey(ownerAddress);
  return queryClient.fetchQuery({
    queryKey: marketQueryKeys.activity(owner, cursor),
    queryFn: () => monadApi.activity(60, cursor ?? undefined),
    staleTime: marketCacheTimes.history,
  });
}

export function useManualPerplAccountQuery(ownerAddress: string | null, enabled: boolean) {
  const owner = ownerKey(ownerAddress);
  return useQuery({
    queryKey: marketQueryKeys.manualAccount(owner),
    queryFn: () => manualPerplApi.account(),
    enabled: Boolean(ownerAddress && enabled),
    staleTime: marketCacheTimes.account,
    refetchInterval: enabled ? marketCacheTimes.account : false,
  });
}

export function usePerplCurrentQuery(ownerAddress: string | null, enabled: boolean) {
  const owner = ownerKey(ownerAddress);
  return useQuery({
    queryKey: marketQueryKeys.perplCurrent(owner),
    queryFn: () => perplApi.current(),
    enabled: Boolean(ownerAddress && enabled),
    staleTime: marketCacheTimes.account,
    refetchInterval: enabled ? marketCacheTimes.account : false,
  });
}

export function resolveMarketsForInput(ownerAddress: string, query: string) {
  const owner = ownerKey(ownerAddress);
  const normalized = query.trim();
  return queryClient.fetchQuery({
    queryKey: marketQueryKeys.lookup(owner, normalized),
    queryFn: () => marketDirectoryApi.resolve(normalized),
    staleTime: marketCacheTimes.directory,
  });
}
