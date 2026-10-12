import {useCallback, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {loadPendingOperationReferences, PendingOperationKind, PendingOperationReference} from '../services/pendingOperationJournal';
import {reconcilePendingOperation} from '../services/pendingOperationReconcile';

export type SetupGuardReference = {reference: PendingOperationReference; status: string; note: string};
export type SetupGuardState = {owner: string; status: 'checking' | 'clear' | 'blocked' | 'unavailable'; references: SetupGuardReference[]};

/** Prevents a setup screen from replacing an unresolved, already-signed enrollment ID. */
export function useSetupEnrollmentGuard(ownerAddress: string | null | undefined, kind: Extract<PendingOperationKind, 'autonomy-enrollment' | 'perp-run'>) {
  const owner = ownerAddress?.toLowerCase() ?? '';
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const generation = useRef(0);
  const [state, setState] = useState<SetupGuardState>({owner: '', status: 'checking', references: []});

  const refresh = useCallback(async (): Promise<SetupGuardState> => {
    const currentOwner = ownerAddress?.toLowerCase() ?? '';
    const request = ++generation.current;
    if (!currentOwner) {
      const unavailable: SetupGuardState = {owner: '', status: 'unavailable', references: []};
      setState(unavailable);
      return unavailable;
    }
    setState({owner: currentOwner, status: 'checking', references: []});
    try {
      const saved = await loadPendingOperationReferences(ownerAddress!);
      const family = saved.filter(reference => reference.kind === kind && reference.action === 'enroll');
      const checked = await Promise.all(family.map(async reference => ({
        reference, result: await reconcilePendingOperation(ownerAddress!, reference),
      })));
      const outstanding = checked.filter(row => row.result.disposition !== 'resolved');
      const result: SetupGuardState = {
        owner: currentOwner,
        status: outstanding.length === 0 ? 'clear'
          : outstanding.some(row => row.result.disposition === 'unavailable') ? 'unavailable' : 'blocked',
        references: outstanding.map(row => ({reference: row.reference, status: row.result.status, note: row.result.note})),
      };
      if (generation.current !== request || ownerRef.current !== currentOwner) {
        return {owner: currentOwner, status: 'unavailable', references: []};
      }
      setState(result);
      return result;
    } catch {
      const unavailable: SetupGuardState = {owner: currentOwner, status: 'unavailable', references: []};
      if (generation.current === request && ownerRef.current === currentOwner) setState(unavailable);
      return unavailable;
    }
  }, [kind, ownerAddress]);

  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]));

  const visibleState = state.owner === owner ? state : {owner, status: 'checking' as const, references: []};
  return {state: visibleState, refresh};
}
