import {useCallback, useEffect, useRef, useState} from 'react';
import {invalidateAfterFinalizedOperation} from '../../services/queryCache';
import {loadPendingOperationReferences, PendingOperationReference} from '../../services/pendingOperationJournal';
import {reconcilePendingOperation} from '../../services/pendingOperationReconcile';
import {perplApi} from '../../services/perplApi';
import {validatePerplRunOwner} from '../../services/perplValidation';
import type {PerplRun} from '../../types/perpl';
import type {PendingUserPerplAction} from './UserPerplStatusView';

function referenceKey(reference: PendingOperationReference) {
  return `${reference.kind}:${reference.id}:${reference.action}`;
}

export function useUserPerplStatus(ownerAddress: string | null, initialRunId?: string) {
  const owner = ownerAddress?.toLowerCase() ?? '';
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const generation = useRef(0);
  const selectedGeneration = useRef(0);
  const selectedRunRef = useRef<PerplRun | null>(null);
  const [selectedRun, setSelectedRun] = useState<PerplRun | null>(null);
  selectedRunRef.current = selectedRun;
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  const [selectedRunFresh, setSelectedRunFresh] = useState(false);
  const [selectedRunError, setSelectedRunError] = useState('');
  const [pendingActions, setPendingActions] = useState<PendingUserPerplAction[]>([]);
  const [journalAvailable, setJournalAvailable] = useState(false);

  useEffect(() => {
    generation.current += 1; selectedGeneration.current += 1;
    selectedRunRef.current = null;
    setSelectedRun(null); setSelectedRunError(''); setSelectedRunLoading(false);
    setSelectedRunFresh(false);
    setPendingActions([]); setJournalAvailable(false);
  }, [owner]);

  const refreshJournal = useCallback(async () => {
    const requestOwner = ownerAddress;
    const requestKey = requestOwner?.toLowerCase() ?? '';
    const requestGeneration = generation.current;
    if (!requestOwner) { setPendingActions([]); setJournalAvailable(false); return false; }
    try {
      const initial = await loadPendingOperationReferences(requestOwner);
      if (ownerRef.current !== requestKey || generation.current !== requestGeneration) return false;
      const perplReferences = initial.filter(reference => ['perpl-run', 'perpl-stop', 'perpl-recovery'].includes(reference.kind));
      const results = await Promise.all(perplReferences.map(reference => reconcilePendingOperation(requestOwner, reference)));
      if (ownerRef.current !== requestKey || generation.current !== requestGeneration) return false;
      const remaining = await loadPendingOperationReferences(requestOwner);
      if (ownerRef.current !== requestKey || generation.current !== requestGeneration) return false;
      const rows = remaining.filter(reference => ['perpl-run', 'perpl-stop', 'perpl-recovery'].includes(reference.kind));
      setPendingActions(rows.map(reference => {
        const result = results.find(item => referenceKey(item.reference) === referenceKey(reference));
        return {id: reference.id, kind: reference.kind, action: reference.action,
          status: result?.status ?? 'saved', note: result?.note ?? 'The original request ID remains saved.'};
      }));
      setJournalAvailable(true);
      if (results.some(result => result.disposition === 'resolved')) {
        void invalidateAfterFinalizedOperation(requestOwner).catch(() => undefined);
      }
      return true;
    } catch {
      if (ownerRef.current === requestKey && generation.current === requestGeneration) {
        setJournalAvailable(false);
      }
      return false;
    }
  }, [ownerAddress]);

  const selectRun = useCallback(async (runId: string) => {
    const requestOwner = ownerAddress;
    const requestKey = requestOwner?.toLowerCase() ?? '';
    const requestGeneration = ++selectedGeneration.current;
    setSelectedRun(null); setSelectedRunError('');
    setSelectedRunFresh(false);
    if (!requestOwner || !/^[A-Za-z0-9_-]{1,160}$/.test(runId)) {
      setSelectedRunLoading(false); setSelectedRunError('This run reference is unavailable.'); return;
    }
    setSelectedRunLoading(true);
    try {
      const page = await perplApi.runHistory(runId);
      if (ownerRef.current !== requestKey || selectedGeneration.current !== requestGeneration) return;
      if (page.run.runId !== runId) throw new Error('The returned run does not match the selected ID.');
      validatePerplRunOwner(page.run, requestOwner);
      setSelectedRun({...page.run, events: page.events, orders: page.orders});
      setSelectedRunFresh(true);
    } catch (reason) {
      if (ownerRef.current === requestKey && selectedGeneration.current === requestGeneration) {
        setSelectedRunError(reason instanceof Error ? reason.message : 'This Perpl run could not be loaded.');
      }
    } finally {
      if (ownerRef.current === requestKey && selectedGeneration.current === requestGeneration) setSelectedRunLoading(false);
    }
  }, [ownerAddress]);

  const refreshSelectedRun = useCallback(async () => {
    const requestOwner = ownerAddress;
    const requestKey = requestOwner?.toLowerCase() ?? '';
    const runId = selectedRunRef.current?.runId ?? initialRunId;
    if (!requestOwner || !runId || !/^[A-Za-z0-9_-]{1,160}$/.test(runId)) return false;
    const requestGeneration = ++selectedGeneration.current;
    const hasExistingRun = selectedRunRef.current?.runId === runId;
    if (!hasExistingRun) { setSelectedRunLoading(true); setSelectedRunFresh(false); }
    setSelectedRunError('');
    try {
      const page = await perplApi.runHistory(runId);
      if (ownerRef.current !== requestKey || selectedGeneration.current !== requestGeneration) return false;
      if (page.run.runId !== runId) throw new Error('The returned run does not match the selected ID.');
      validatePerplRunOwner(page.run, requestOwner);
      setSelectedRun({...page.run, events: page.events, orders: page.orders});
      setSelectedRunFresh(true);
      return true;
    } catch (reason) {
      if (ownerRef.current === requestKey && selectedGeneration.current === requestGeneration) {
        setSelectedRunFresh(false);
        setSelectedRunError(reason instanceof Error ? reason.message : 'This Perpl run could not be refreshed.');
      }
      return false;
    } finally {
      if (ownerRef.current === requestKey && selectedGeneration.current === requestGeneration && !hasExistingRun) {
        setSelectedRunLoading(false);
      }
    }
  }, [ownerAddress, initialRunId]);

  const clearSelectedRun = useCallback(() => {
    selectedGeneration.current += 1; setSelectedRun(null); setSelectedRunFresh(false); setSelectedRunError(''); setSelectedRunLoading(false);
  }, []);

  useEffect(() => {
    if (initialRunId) void selectRun(initialRunId);
    else clearSelectedRun();
  }, [initialRunId, owner, selectRun, clearSelectedRun]);

  return {selectedRun, selectedRunLoading, selectedRunFresh, selectedRunError, pendingActions, journalAvailable,
    refreshJournal, refreshSelectedRun, selectRun, clearSelectedRun};
}
