import type {MonadActivityEvent} from '../types/monad';

/** Keep the refreshed head first while retaining already loaded owner history without duplicates. */
export function mergeActivityEventPages(head: readonly MonadActivityEvent[], older: readonly MonadActivityEvent[]) {
  const seen = new Set<string>();
  const merged: MonadActivityEvent[] = [];
  for (const event of [...head, ...older]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    merged.push(event);
  }
  return merged;
}

export function activityEventsForOwner(currentOwner: string, loadedOwner: string,
  head: readonly MonadActivityEvent[], older: readonly MonadActivityEvent[]) {
  if (!currentOwner || currentOwner.toLowerCase() !== loadedOwner.toLowerCase()) return [];
  return mergeActivityEventPages(head, older);
}
