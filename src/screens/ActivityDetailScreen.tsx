import React, {useCallback, useRef, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {Card, DataRow, FlowScreen, LoadingBlock, Notice, PageHeader} from '../components/Ui';
import {fetchMonadActivityPage} from '../services/useMarketQueries';
import {useApp} from '../state/AppContext';
import type {MonadActivityEvent} from '../types/monad';
import {screenStyles as s} from '../theme/screenStyles';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {UserActivityDetailView} from './UserActivityDetailView';

type DetailState = {owner: string; loading: boolean; error: string; interrupted: boolean; event: MonadActivityEvent | null};

export function ActivityDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const {presentationMode, effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const ownerKey = ownerAddress?.toLowerCase() ?? '';
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;
  const generation = useRef(0);
  const itemId = route.params?.itemId;
  const linkedActivityPath = typeof route.path === 'string' && route.path.startsWith('activity/');
  const [state, setState] = useState<DetailState>({owner: '', loading: true, error: '', interrupted: false, event: null});

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const requestedOwner = ownerKey;
    setState({owner: requestedOwner, loading: true, error: '', interrupted: false, event: null});
    try {
      if (!ownerAddress) throw new Error('Sign in to view account activity.');
      if (typeof itemId !== 'string' || !itemId) throw new Error('This activity reference is incomplete.');
      // Route params are untrusted navigation data. Always resolve this ID through
      // the authenticated owner's activity pages before displaying any facts.
      let page = await fetchMonadActivityPage(ownerAddress, null);
      let match = page.events.find(item => item.id === itemId) ?? null;
      while (!match && page.hasMore && page.nextCursor) {
        page = await fetchMonadActivityPage(ownerAddress, page.nextCursor);
        match = page.events.find(item => item.id === itemId) ?? null;
      }
      if (current === generation.current && ownerRef.current === requestedOwner) {
        setState({owner: requestedOwner, loading: false, error: '', interrupted: false, event: match});
      }
    } catch (reason) {
      if (current === generation.current && ownerRef.current === requestedOwner) {
        setState({owner: requestedOwner, loading: false,
          error: reason instanceof Error ? reason.message : 'This event could not be loaded.',
          interrupted: isRequestCancellation(reason), event: null});
      }
    }
  }, [itemId, ownerAddress, ownerKey]);

  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]));

  const stateMatchesOwner = state.owner === ownerKey;
  const event = stateMatchesOwner ? state.event : null;
  const error = stateMatchesOwner ? state.error : '';
  if (presentationMode === 'user') return <UserActivityDetailView theme={theme} event={event}
    loading={!stateMatchesOwner || state.loading} error={error} interrupted={stateMatchesOwner && state.interrupted}
    onBack={() => linkedActivityPath ? navigation.navigate('Main', {screen: 'Activity'}) : navigation.goBack()}
    onRetry={() => { void refresh(); }} />;
  if (!stateMatchesOwner || state.loading) return <FlowScreen><PageHeader kicker="Activity" title="Loading event" /><LoadingBlock label="Checking recorded event" /></FlowScreen>;
  if (error) return <FlowScreen><PageHeader kicker="Activity" title="Event unavailable" /><Notice live tone="rose" title="Could not load event" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /></FlowScreen>;
  if (!event) return <FlowScreen><PageHeader kicker="Activity" title="Event not found" copy="The activity service did not return this event for the signed-in wallet." /></FlowScreen>;

  return <FlowScreen>
    <PageHeader kicker={event.kind} title={event.title} copy={event.summary} />
    <Card>
      <DataRow label="Status" value={activityStatus(event)} />
      <DataRow label="Funds moved" value={event.fundsMoved ? 'Yes · recorded by service' : 'No successful movement recorded'} />
      <DataRow label="When" value={new Date(event.occurredAt).toLocaleString()} />
      {event.amount && event.asset ? <DataRow label="Amount" value={`${event.amount} ${event.asset}`} /> : null}
      {event.blockNumber !== undefined && event.blockNumber !== null ? <DataRow label="Block" value={String(event.blockNumber)} /> : null}
      {event.transactionHash && !isBlocked(event) ? <DataRow label="Transaction hash" value={event.transactionHash} /> : <Text style={s.body}>{isBlocked(event) ? 'This action was blocked before a transaction was created.' : 'No transaction hash was returned for this event.'}</Text>}
    </Card>
    {event.details?.length ? <Card><Text style={s.strong}>Recorded facts</Text>{event.details.map((detail, index) => <DataRow key={`${detail.label}:${index}`} label={detail.label} value={detail.value} />)}</Card> : null}
  </FlowScreen>;
}

function activityStatus(event: MonadActivityEvent) {
  if (event.kind.includes('order_failed') || event.summary.toLowerCase().includes('transaction reverted')) {
    return event.status === 'finalized' ? 'failed · reverted after finality' : 'reverted · awaiting finality';
  }
  return event.status;
}
function isBlocked(event: MonadActivityEvent) { return event.status === 'blocked' || event.kind.includes('blocked'); }
function isRequestCancellation(reason: unknown) {
  if (!reason || typeof reason !== 'object') return false;
  const candidate = reason as {name?: unknown; message?: unknown};
  return [candidate.name, candidate.message].some(value => typeof value === 'string'
    && /^(?:CancelledError|AbortError)$/i.test(value.trim()));
}
