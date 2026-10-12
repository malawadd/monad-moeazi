import React, {useCallback, useMemo, useRef, useState} from 'react';
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
import {activityLifecycleReferenceFromParams, eventMatchesLifecycle, lifecycleEventPrefix} from '../services/userActivityPresentation';

type DetailState = {owner: string; loading: boolean; error: string; interrupted: boolean;
  event: MonadActivityEvent | null; timeline: MonadActivityEvent[]};

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
  const operationIdParam = route.params?.operationId;
  const manualOperationIdParam = route.params?.manualPerplOperationId;
  const perplVenueParam = route.params?.perplOrder?.venueId;
  const perplRunParam = route.params?.perplOrder?.runId;
  const perplRequestParam = route.params?.perplOrder?.requestId;
  const autonomousVenueParam = route.params?.autonomousUpdates?.venueId;
  const autonomousRunParam = route.params?.autonomousUpdates?.runId;
  const lifecycleReference = useMemo(() => activityLifecycleReferenceFromParams({
    operationId: operationIdParam, manualPerplOperationId: manualOperationIdParam,
    perplOrder: typeof perplVenueParam === 'string' && typeof perplRunParam === 'string'
      ? {venueId: perplVenueParam, runId: perplRunParam, requestId: perplRequestParam} : undefined,
    autonomousUpdates: typeof autonomousVenueParam === 'string' && typeof autonomousRunParam === 'string'
      ? {venueId: autonomousVenueParam, runId: autonomousRunParam} : undefined,
  }), [operationIdParam, manualOperationIdParam, perplVenueParam, perplRunParam, perplRequestParam,
    autonomousVenueParam, autonomousRunParam]);
  const lifecyclePrefix = useMemo(() => lifecycleReference ? lifecycleEventPrefix(lifecycleReference) : null, [lifecycleReference]);
  const linkedActivityPath = typeof route.path === 'string' && route.path.startsWith('activity/');
  const [state, setState] = useState<DetailState>({owner: '', loading: true, error: '', interrupted: false, event: null, timeline: []});

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const requestedOwner = ownerKey;
    setState({owner: requestedOwner, loading: true, error: '', interrupted: false, event: null, timeline: []});
    try {
      if (!ownerAddress) throw new Error('Sign in to view account activity.');
      if (typeof itemId !== 'string' || !itemId) throw new Error('This activity reference is incomplete.');
      if (lifecyclePrefix && !itemId.startsWith(lifecyclePrefix)) throw new Error('This activity timeline reference is invalid.');
      // Route params are untrusted navigation data. Always resolve this ID through
      // the authenticated owner's activity pages before displaying any facts.
      let page = await fetchMonadActivityPage(ownerAddress, null);
      const isExpected = (item: MonadActivityEvent) => !lifecycleReference || eventMatchesLifecycle(item, lifecycleReference);
      let match = page.events.find(item => item.id === itemId && isExpected(item)) ?? null;
      const timelineById = new Map<string, MonadActivityEvent>();
      if (lifecycleReference) {
        for (const item of page.events) if (eventMatchesLifecycle(item, lifecycleReference)) timelineById.set(item.id, item);
      }
      const seenCursors = new Set<string>();
      // A lifecycle ID identifies one operation/order, not a whole Perpl run.
      // Its older stages can span pages, so resolve the authenticated feed
      // before showing a grouped timeline. A single-event lookup can stop as soon
      // as its exact event is found.
      while ((lifecycleReference || !match) && page.hasMore && page.nextCursor
          && !seenCursors.has(page.nextCursor) && current === generation.current && ownerRef.current === requestedOwner) {
        const nextCursor = page.nextCursor;
        seenCursors.add(nextCursor);
        page = await fetchMonadActivityPage(ownerAddress, nextCursor);
        match ??= page.events.find(item => item.id === itemId && isExpected(item)) ?? null;
        if (lifecycleReference) {
          for (const item of page.events) if (eventMatchesLifecycle(item, lifecycleReference)) timelineById.set(item.id, item);
        }
      }
      if (current !== generation.current || ownerRef.current !== requestedOwner) return;
      const orderedTimeline = [...timelineById.values()].sort((first, second) => Date.parse(first.occurredAt) - Date.parse(second.occurredAt));
      if (current === generation.current && ownerRef.current === requestedOwner) {
        setState({owner: requestedOwner, loading: false, error: '', interrupted: false, event: match, timeline: orderedTimeline});
      }
    } catch (reason) {
      if (current === generation.current && ownerRef.current === requestedOwner) {
        setState({owner: requestedOwner, loading: false,
          error: reason instanceof Error ? reason.message : 'This event could not be loaded.',
          interrupted: isRequestCancellation(reason), event: null, timeline: []});
      }
    }
  }, [itemId, lifecyclePrefix, lifecycleReference, ownerAddress, ownerKey]);

  useFocusEffect(useCallback(() => {
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]));

  const stateMatchesOwner = state.owner === ownerKey;
  const event = stateMatchesOwner ? state.event : null;
  const timeline = stateMatchesOwner ? state.timeline : [];
  const error = stateMatchesOwner ? state.error : '';
  const lifecycleTitle = lifecycleReference?.family === 'autonomous_updates' ? 'Autonomous updates' : undefined;
  if (presentationMode === 'user') return <UserActivityDetailView theme={theme} event={event}
    timeline={timeline}
    lifecycleTitle={lifecycleTitle}
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
    {timeline.length > 1 ? <Card><Text style={s.strong}>Operation timeline</Text>{timeline.map(item => <Card key={item.id}>
      <DataRow label="Stage" value={`${activityStatus(item)} · ${item.kind.replaceAll('_', ' ')}`} />
      <Text style={s.body}>{item.summary}</Text>
      <DataRow label="When" value={new Date(item.occurredAt).toLocaleString()} />
      {item.transactionHash && !isBlocked(item) ? <DataRow label="Transaction hash" value={item.transactionHash} /> : null}
    </Card>)}</Card> : null}
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
