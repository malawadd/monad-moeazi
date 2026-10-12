import React, {useEffect, useRef, useState} from 'react';
import {Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, Notice, PageHeader, Screen} from '../components/Ui';
import {invalidateAfterFinalizedOperation} from '../services/queryCache';
import {loadPendingOperationReferences, PendingOperationReference, pendingReferenceLabel} from '../services/pendingOperationJournal';
import {ReconciliationResult, reconcilePendingOperation} from '../services/pendingOperationReconcile';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {focusPendingReferences} from '../services/pendingOperationFocus';
import {broadcastVerifiedMonadOperation} from '../services/pendingMonadContinuation';
import {UserPendingOperationsView} from './user-perpl/UserPendingOperationsView';

function keyOf(reference: PendingOperationReference) {
  return `${reference.kind}:${reference.id}:${reference.action}`;
}

export function PendingOperationsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {ownerAddress} = useApp();
  const {presentationMode, effectiveTheme} = usePresentation();
  const userTheme = userThemeTokens(effectiveTheme);
  const owner = ownerAddress?.toLowerCase() ?? '';
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const generation = useRef(0);
  const [references, setReferences] = useState<PendingOperationReference[] | null>(null);
  const [referencesOwner, setReferencesOwner] = useState('');
  const [results, setResults] = useState<Record<string, ReconciliationResult>>({});
  const [resolved, setResolved] = useState<ReconciliationResult[]>([]);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const visibleReferences = referencesOwner === owner ? references : null;
  const visibleResolved = referencesOwner === owner ? resolved : [];
  const focus = focusPendingReferences(visibleReferences ?? [], route.params?.focusKind, route.params?.focusId);
  const focusedResolved = visibleResolved.filter(item => item.reference.kind === route.params?.focusKind
    && item.reference.id === route.params?.focusId);
  const hasFocusedResolved = focusedResolved.length > 0;

  useEffect(() => {
    const current = ++generation.current;
    setReferences(null); setReferencesOwner(owner); setResolved([]); setResults({}); setBusyKey(''); setError('');
    if (!ownerAddress) { setReferences([]); return () => { generation.current += 1; }; }
    void loadPendingOperationReferences(ownerAddress).then(rows => {
      if (generation.current === current) setReferences(rows);
    }).catch(() => {
      if (generation.current === current) { setReferences(null); setError('Saved references could not be read from this device.'); }
    });
    return () => { if (generation.current === current) generation.current += 1; };
  }, [owner, ownerAddress]);

  async function reload() {
    if (!ownerAddress) return;
    const current = generation.current, ownerAtStart = owner;
    try {
      const rows = await loadPendingOperationReferences(ownerAddress);
      if (generation.current === current && ownerRef.current === ownerAtStart) { setReferences(rows); setReferencesOwner(owner); setError(''); }
    } catch {
      if (generation.current === current && ownerRef.current === ownerAtStart) setError('Saved references could not be read from this device.');
    }
  }

  async function check(reference: PendingOperationReference) {
    if (!ownerAddress) return;
    const key = keyOf(reference), current = generation.current, ownerAtStart = owner;
    setBusyKey(key); setError('');
    const result = await reconcilePendingOperation(ownerAddress, reference);
    if (generation.current !== current || ownerRef.current !== ownerAtStart) return;
    setResults(previous => ({...previous, [key]: result}));
    if (result.disposition === 'resolved') {
      setReferences(previous => previous?.filter(item => keyOf(item) !== key) ?? []);
      setResolved(previous => [result, ...previous.filter(item => keyOf(item.reference) !== key)]);
      void invalidateAfterFinalizedOperation(ownerAddress).catch(() => undefined);
    }
    setBusyKey('');
  }

  async function continueOriginal(reference: PendingOperationReference, continuation: NonNullable<ReconciliationResult['continuation']>) {
    if (!ownerAddress) return;
    const key = keyOf(reference), current = generation.current, ownerAtStart = owner;
    setBusyKey(key); setError('');
    try {
      await broadcastVerifiedMonadOperation(ownerAddress, reference, continuation);
      const latest = await reconcilePendingOperation(ownerAddress, reference);
      if (generation.current !== current || ownerRef.current !== ownerAtStart) return;
      setResults(previous => ({...previous, [key]: latest}));
      if (latest.disposition === 'resolved') {
        setReferences(previous => previous?.filter(item => keyOf(item) !== key) ?? []);
        setResolved(previous => [latest, ...previous.filter(item => keyOf(item.reference) !== key)]);
        if (latest.status === 'finalized') void invalidateAfterFinalizedOperation(ownerAddress).catch(() => undefined);
      }
    } catch (reason) {
      if (generation.current === current && ownerRef.current === ownerAtStart) {
        setError(reason instanceof Error ? reason.message : 'The original transaction could not be continued.');
      }
    } finally {
      if (generation.current === current && ownerRef.current === ownerAtStart) setBusyKey('');
    }
  }

  if (presentationMode === 'user') return <UserPendingOperationsView theme={userTheme}
    references={visibleReferences === null ? null : hasFocusedResolved ? [] : focus.references}
    resolved={hasFocusedResolved ? focusedResolved : visibleResolved}
    results={results} busyKey={busyKey} error={error} focusMissing={visibleReferences !== null && focus.missing && !hasFocusedResolved}
    onBack={() => navigation.goBack()} onRetry={() => { void reload(); }} onCheck={reference => { void check(reference); }}
    onContinue={(reference, continuation) => { void continueOriginal(reference, continuation); }} />;

  return <Screen onBack={() => navigation.goBack()}>
    <PageHeader kicker="Owner-scoped recovery" title="Saved operation references"
      copy="These local IDs identify signed owner actions after a restart or presentation change. A read-only check may report prepared, verified, submitted, or terminal; this screen never signs, retries, broadcasts, stops, or recovers." />
    {error ? <Notice live tone="rose" title="References unavailable" message={error} actionLabel="Try again" onAction={() => { void reload(); }} /> : null}
    {visibleReferences === null && !error ? <Card><Text style={s.body}>Loading saved operation IDs…</Text></Card> : null}
    {visibleReferences?.length === 0 && visibleResolved.length === 0 ? <Card><Text style={s.strong}>No saved operation references</Text><Text style={s.body}>A signed action reference is saved on this device before its service request is sent.</Text></Card> : null}
    {visibleReferences?.map(reference => {
      const key = keyOf(reference), result = results[key];
      return <Card key={key}>
        <Text style={s.strong}>{pendingReferenceLabel(reference)}</Text>
        <DataRow label="Action" value={reference.action.replaceAll('_', ' ')} />
        <Text selectable style={s.body}>Original ID: {reference.id}</Text>
        {reference.relatedId ? <Text selectable style={s.body}>Related run ID: {reference.relatedId}</Text> : null}
        {result ? <><DataRow label="Read status" value={result.status} /><Text style={s.body}>{result.note}</Text></> : null}
        <Button label={busyKey === key ? 'Checking original status…' : 'Check original status · read-only'}
          variant="secondary" loading={busyKey === key} disabled={Boolean(busyKey)} onPress={() => { void check(reference); }} />
      </Card>;
    })}
    {visibleResolved.map(result => <Card key={`resolved:${keyOf(result.reference)}`}>
      <Text style={s.strong}>{pendingReferenceLabel(result.reference)} · resolved</Text>
      <Text selectable style={s.body}>Original ID: {result.reference.id}</Text>
      <DataRow label="Verified status" value={result.status} />
      <Text style={s.body}>{result.note}</Text>
    </Card>)}
  </Screen>;
}
