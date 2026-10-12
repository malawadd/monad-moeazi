import {useEffect, useState} from 'react';

export const PROLONGED_REFRESH_FAILURE_MS = 120_000;

/** Delays connection copy during normal retries and resets after recovery, focus loss, or owner change. */
export function useProlongedRefreshFailure(failed: boolean, hasCachedData: boolean,
  delayMs = PROLONGED_REFRESH_FAILURE_MS, scopeKey?: string | null): boolean {
  const [elapsed, setElapsed] = useState<{scopeKey?: string | null; value: boolean}>({scopeKey, value: false});

  useEffect(() => {
    setElapsed({scopeKey, value: false});
    if (!failed) return undefined;
    const timeout = setTimeout(() => setElapsed({scopeKey, value: true}), delayMs);
    return () => clearTimeout(timeout);
  }, [failed, delayMs, scopeKey]);

  return failed && (!hasCachedData || elapsed.scopeKey === scopeKey && elapsed.value);
}
