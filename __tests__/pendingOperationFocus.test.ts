import {focusPendingReferences} from '../src/services/pendingOperationFocus';
import type {PendingOperationReference} from '../src/services/pendingOperationJournal';

const rows: PendingOperationReference[] = [
  {kind: 'monad-operation', id: 'wallet-1', action: 'submit', createdAt: 1},
  {kind: 'autonomy-enrollment', id: 'run-1', action: 'enroll', createdAt: 2},
  {kind: 'perpl-run', id: 'run-1', action: 'enroll', createdAt: 3},
];

describe('pending-operation route focus', () => {
  it('filters to the exact kind and ID for the current owner journal', () => {
    expect(focusPendingReferences(rows, 'perpl-run', 'run-1')).toEqual({
      references: [rows[2]], focused: true, missing: false,
    });
  });

  it('does not confuse matching IDs from another operation family', () => {
    expect(focusPendingReferences(rows, 'perpl-stop', 'run-1')).toEqual({
      references: rows, focused: false, missing: true,
    });
  });

  it('falls back to the full owner list for missing or malformed focus params', () => {
    expect(focusPendingReferences(rows, 'perpl-run', 'missing')).toEqual({
      references: rows, focused: false, missing: true,
    });
    expect(focusPendingReferences(rows, 'not-a-kind', 'run-1')).toEqual({
      references: rows, focused: false, missing: false,
    });
  });
});
