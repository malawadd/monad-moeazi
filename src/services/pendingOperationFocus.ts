import type {PendingOperationKind, PendingOperationReference} from './pendingOperationJournal';

const kinds = new Set<PendingOperationKind>([
  'monad-operation', 'manual-perpl-operation', 'autonomy-enrollment', 'managed-spot-mandate',
  'perpl-run', 'perpl-stop', 'perpl-recovery', 'perp-run', 'perp-stop',
]);

export function focusPendingReferences(rows: PendingOperationReference[], kind: unknown, id: unknown) {
  if (typeof kind !== 'string' || !kinds.has(kind as PendingOperationKind)
      || typeof id !== 'string' || !id.trim()) {
    return {references: rows, focused: false, missing: false};
  }
  const exact = rows.filter(row => row.kind === kind && row.id === id);
  return exact.length
    ? {references: exact, focused: true, missing: false}
    : {references: rows, focused: false, missing: true};
}
