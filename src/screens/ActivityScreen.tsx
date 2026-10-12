import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useIsFocused, useNavigation} from '@react-navigation/native';
import {Button, Card, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {fetchMonadActivityPage, useMarketTradesQuery, useMonadActivityQuery} from '../services/useMarketQueries';
import {subscribeNotificationActivityRefresh} from '../services/notifications/NotificationEvents';
import {MarketTradeSummaryCard} from '../components/MarketTradeSummaryCard';
import type {MonadActivityEvent} from '../types/monad';
import type {MarketTradeSummary} from '../types/marketDirectory';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {useApp} from '../state/AppContext';
import {loadPendingOperationReferences} from '../services/pendingOperationJournal';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {UserActivityView} from './UserActivityView';

function eventTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : 'Time not returned';
}

export function ActivityScreen() {
  const navigation = useNavigation<any>();
  const focused = useIsFocused();
  const {ownerAddress} = useApp();
  const {presentationMode, effectiveTheme} = usePresentation();
  const userTheme = userThemeTokens(effectiveTheme);
  const activity = useMonadActivityQuery(ownerAddress, null, focused);
  const summaries = useMarketTradesQuery(ownerAddress, undefined, undefined, focused);
  const {refetch: refetchActivity, isStale: activityStale, data: activityData} = activity;
  const {refetch: refetchSummaries, isStale: summariesStale, data: summaryData} = summaries;
  const [moreEvents, setMoreEvents] = useState<MonadActivityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [paginationError, setPaginationError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [scope, setScope] = useState<'all' | 'perp'>('all');
  const [pendingReferenceCount, setPendingReferenceCount] = useState(0);
  const pageGeneration = useRef(0);
  const pendingGeneration = useRef(0);

  useFocusEffect(useCallback(() => {
    const current = ++pendingGeneration.current;
    setPendingReferenceCount(0);
    if (!ownerAddress || presentationMode !== 'user') return () => { pendingGeneration.current += 1; };
    void loadPendingOperationReferences(ownerAddress).then(rows => {
      if (pendingGeneration.current === current) setPendingReferenceCount(rows.length);
    }).catch(() => {
      if (pendingGeneration.current === current) setPendingReferenceCount(0);
    });
    return () => { if (pendingGeneration.current === current) pendingGeneration.current += 1; };
  }, [ownerAddress, presentationMode]));

  useEffect(() => {
    pageGeneration.current += 1;
    setMoreEvents([]);
    setNextCursor(activityData?.nextCursor ?? null);
    setHasMore(activityData?.hasMore ?? false);
  }, [ownerAddress, activityData]);
  const events = useMemo(() => [...(activityData?.events ?? []), ...moreEvents], [activityData?.events, moreEvents]);
  const tradeSummaries: MarketTradeSummary[] = summaryData?.summaries ?? [];
  const refresh = useCallback(async () => {
    setPaginationError('');
    await Promise.allSettled([refetchActivity(), refetchSummaries()]);
  }, [refetchActivity, refetchSummaries]);
  const pullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);
  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    const generation = pageGeneration.current;
    setLoadingMore(true); setPaginationError('');
    try {
      if (!ownerAddress) throw new Error('Sign in to load account activity.');
      const page = await fetchMonadActivityPage(ownerAddress, nextCursor);
      if (generation === pageGeneration.current) {
        setMoreEvents(previous => {
          const seen = new Set([...events, ...previous].map(event => event.id));
          return [...previous, ...page.events.filter(event => !seen.has(event.id))];
        });
        setNextCursor(page.nextCursor); setHasMore(page.hasMore);
      }
    } catch (reason) { if (generation === pageGeneration.current) setPaginationError(reason instanceof Error ? reason.message : 'More activity could not be loaded.'); }
    finally { setLoadingMore(false); }
  }, [hasMore, nextCursor, loadingMore, ownerAddress, events]);
  useFocusEffect(useCallback(() => { if (activityStale || summariesStale) void refresh(); },
    [activityStale, summariesStale, refresh]));
  useEffect(() => subscribeNotificationActivityRefresh(() => { void refresh(); }), [refresh]);
  const visibleEvents = scope === 'perp' ? events.filter(isPerpVenueEvent) : events;
  const userVisibleEvents = scope === 'perp' ? events.filter(isUserPerplEvent) : events;
  const visibleSummaries = scope === 'perp' ? tradeSummaries.filter(item => item.venueId.startsWith('perpl-')) : tradeSummaries;
  const activityError = activity.error instanceof Error ? activity.error.message : '';
  const hasError = Boolean(activityError || paginationError);

  if (presentationMode === 'user') return <UserActivityView theme={userTheme} events={userVisibleEvents}
    loading={!activityData && activity.isLoading} refreshing={pullRefreshing} error={[activityError, paginationError].filter(Boolean).join(' ')}
    pendingCount={pendingReferenceCount} hasMore={hasMore} loadingMore={loadingMore} scope={scope === 'all' ? 'all' : 'perp'}
    onRefresh={() => { void pullToRefresh(); }} onLoadMore={() => { void loadMore(); }}
    onSetScope={setScope} onPending={() => navigation.navigate('PendingOperations')}
    onOpen={event => navigation.navigate('ActivityDetail', {itemId: event.id, event})} />;

  return <Screen refreshing={pullRefreshing || (!activityData && activity.isLoading)} onRefresh={() => { void pullToRefresh(); }}>
    <PageHeader kicker="Activity · trades and service events" title="What happened" copy="Perp orders, holds, position changes, funding, stop requests, receipts, and returned funds appear here with their submitted, executed, or finalized state." />
    {hasError ? <Notice live tone="orange" title={activityData ? 'Showing last good activity' : 'Activity unavailable'} message={[activityError, paginationError].filter(Boolean).join(' ')} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    <Card><Text style={s.strong}>Recent trade summaries</Text>
      {summaries.isError ? <Text style={s.body}>{summaryData ? 'Showing cached trade summaries; refresh failed.' : 'Trade summaries are unavailable.'}</Text> : visibleSummaries.length ? visibleSummaries.slice(0, 8).map(summary =>
        <MarketTradeSummaryCard key={summary.summaryId} summary={summary} onOpen={() => navigation.navigate('MarketDetail', {
          venueId: summary.venueId, marketId: summary.marketId, summaryId: summary.summaryId,
        })} />) : <Text style={s.body}>No verified trade summaries have been returned yet. Uncertain and open orders remain visible in the event timeline below.</Text>}
    </Card>
    <View style={styles.filters}>
      <Button label="All activity" variant={scope === 'all' ? 'primary' : 'secondary'} onPress={() => setScope('all')} />
      <Button label="Perp venues" variant={scope === 'perp' ? 'primary' : 'secondary'} onPress={() => setScope('perp')} />
    </View>
    {!events.length && !activity.isFetching && !hasError ? <Card><Text style={s.strong}>The service returned no activity events.</Text><Text style={s.body}>New events appear after the backend records an operation, receipt, or agent status change.</Text></Card> : null}
    {scope === 'perp' && events.length > 0 && !visibleEvents.length ? <Card><Text style={s.body}>No Perp events are in the loaded pages yet.</Text></Card> : null}
    <View style={styles.timeline}>{visibleEvents.map(event => <Pressable accessibilityRole="button" accessibilityLabel={`Open event: ${event.title}`} key={event.id} onPress={() => navigation.navigate('ActivityDetail', {itemId: event.id, event})} style={({pressed}) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rail}><View style={styles.marker} /></View>
      <View style={styles.copy}>
        <View style={styles.metaRow}>{isPerpVenueEvent(event) ? <StatusBadge label={event.venueId === 'perpl-direct-testnet-v1' ? 'Perpl · direct' : event.venueId === 'perpl-testnet-v1' ? 'Perpl · API' : 'Perp · mock'} tone="lilac" /> : null}<StatusBadge label={event.kind} tone={event.fundsMoved ? 'mint' : 'sky'} /><Text style={s.meta}>{eventTime(event.occurredAt)}</Text></View>
        <Text style={s.subheading}>{event.title}</Text>
        <Text style={s.body}>{event.summary}</Text>
        <Text style={s.meta}>Status · {activityStatus(event)}</Text>
        {event.amount && event.asset ? <Text style={s.strong}>{event.amount} {event.asset}</Text> : null}
        {event.transactionHash && !isBlocked(event) ? <Text selectable style={s.meta}>Tx · {event.transactionHash}</Text> : null}
      </View>
    </Pressable>)}</View>
    {hasMore ? <Button label="Load more activity" variant="secondary" onPress={() => { void loadMore(); }} loading={loadingMore} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  filters: {flexDirection: 'row', gap: spacing.sm},
  timeline: {borderTopWidth: 3, borderColor: colors.ink},
  row: {minHeight: 112, flexDirection: 'row', backgroundColor: colors.paper},
  pressed: {backgroundColor: colors.cream},
  rail: {width: 28, alignItems: 'center', borderRightWidth: 3, borderColor: colors.ink},
  marker: {width: 12, height: 12, marginTop: 21, marginRight: -15, backgroundColor: colors.yellow, borderWidth: 3, borderColor: colors.ink},
  copy: {flex: 1, gap: spacing.sm, padding: spacing.md, borderBottomWidth: 2, borderColor: colors.ink},
  metaRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap'},
});

function activityStatus(event: MonadActivityEvent) {
  if (event.kind.includes('order_failed') || event.summary.toLowerCase().includes('transaction reverted')) {
    return event.status === 'finalized' ? 'failed · reverted after finality' : 'reverted · awaiting finality';
  }
  return event.status;
}
function isBlocked(event: MonadActivityEvent) { return event.status === 'blocked' || event.kind.includes('blocked'); }
function isPerpVenueEvent(event: MonadActivityEvent) {
  return event.kind.startsWith('perp_') || event.kind.startsWith('perpl_')
    || event.venueId === 'monad-mock-clearinghouse-v1' || event.venueId === 'perpl-testnet-v1' || event.venueId === 'perpl-direct-testnet-v1';
}
function isUserPerplEvent(event: MonadActivityEvent) {
  return event.kind.startsWith('perpl_') || event.venueId === 'perpl-testnet-v1' || event.venueId === 'perpl-direct-testnet-v1';
}
