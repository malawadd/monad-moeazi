import {perplApi} from './perplApi';
import type {PerplRun} from '../types/perpl';
import {validatePerplRunOwner} from './perplValidation';

const MAX_HISTORY_PAGES = 20;
const COMPLETED_STATUSES = new Set(['complete', 'completed', 'settled', 'stopped', 'expired']);
const OPTIMIZER_VERSIONS = new Set(['perpl-deterministic-v2', 'perpl-deterministic-v3-soak']);

export async function hasCompletedDeterministicEnrollment(ownerAddress: string | null) {
  if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_HISTORY_PAGES; pageNumber += 1) {
    const page = await perplApi.history(100, cursor);
    for (const run of page.runs) {
      validatePerplRunOwner(run, ownerAddress);
      if (isCompletedDeterministicRun(run)) return true;
    }
    if (!page.hasMore) return false;
    if (!page.nextCursor) throw new Error('Perpl enrollment history could not be fully checked. Retry before starting another run.');
    cursor = page.nextCursor;
  }
  throw new Error('Enrollment history is longer than the safe lookup limit. Retry before starting another run.');
}

function isCompletedDeterministicRun(run: PerplRun) {
  return run.venueId === 'perpl-direct-testnet-v1'
    && OPTIMIZER_VERSIONS.has(String(run.optimizer?.version ?? ''))
    && COMPLETED_STATUSES.has(run.status.toLowerCase());
}
