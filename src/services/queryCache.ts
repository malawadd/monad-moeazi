import {AppState} from 'react-native';
import {focusManager, QueryClient} from '@tanstack/react-query';

focusManager.setEventListener(setFocused => {
  setFocused(AppState.currentState === 'active');
  const subscription = AppState.addEventListener('change', state => setFocused(state === 'active'));
  return () => subscription.remove();
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchIntervalInBackground: false,
    },
  },
});

export const marketQueryKeys = {
  owner: (owner: string) => ['mobile', 'owner', owner.toLowerCase()] as const,
  root: (owner: string) => [...marketQueryKeys.owner(owner), 'markets'] as const,
  directory: (owner: string) => [...marketQueryKeys.root(owner), 'directory'] as const,
  lookup: (owner: string, query: string) => [...marketQueryKeys.root(owner), 'lookup', query.toLowerCase()] as const,
  snapshot: (owner: string, venueId: string, marketId: string) => [...marketQueryKeys.root(owner), 'snapshot', venueId, marketId] as const,
  candles: (owner: string, venueId: string, marketId: string, resolution: number) =>
    [...marketQueryKeys.root(owner), 'candles', venueId, marketId, resolution] as const,
  trades: (owner: string, venueId?: string, marketId?: string) => [...marketQueryKeys.owner(owner), 'history', 'trades', venueId ?? 'all', marketId ?? 'all'] as const,
  activity: (owner: string, cursor?: string | null) => [...marketQueryKeys.owner(owner), 'history', 'activity', cursor ?? 'first'] as const,
  wallet: (owner: string) => [...marketQueryKeys.owner(owner), 'account', 'wallet'] as const,
  manualAccount: (owner: string) => [...marketQueryKeys.owner(owner), 'account', 'manual-perpl'] as const,
  perplCurrent: (owner: string) => [...marketQueryKeys.owner(owner), 'account', 'perpl-current'] as const,
};

export function clearOwnerScopedQueryCache() {
  queryClient.clear();
}

export async function invalidateAfterFinalizedOperation(ownerAddress: string) {
  await queryClient.invalidateQueries({queryKey: marketQueryKeys.owner(ownerAddress)});
}
