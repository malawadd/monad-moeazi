import React, {useCallback, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {monadApi} from '../services/monadApi';
import type {MonadActivityEvent} from '../types/monad';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

function eventTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : 'Time not returned';
}

export function ActivityScreen() {
  const navigation = useNavigation<any>();
  const [events, setEvents] = useState<MonadActivityEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [scope, setScope] = useState<'all' | 'perp'>('all');
  const pageGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++pageGeneration.current;
    setRefreshing(true); setError('');
    try {
      const page = await monadApi.activity(60);
      if (generation === pageGeneration.current) {
        setEvents(page.events); setNextCursor(page.nextCursor); setHasMore(page.hasMore);
      }
    }
    catch (reason) { if (generation === pageGeneration.current) setError(reason instanceof Error ? reason.message : 'Activity could not be loaded.'); }
    finally { if (generation === pageGeneration.current) setRefreshing(false); }
  }, []);
  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingMore) return;
    const generation = pageGeneration.current;
    setLoadingMore(true); setError('');
    try {
      const page = await monadApi.activity(60, nextCursor);
      if (generation === pageGeneration.current) {
        setEvents(previous => {
          const seen = new Set(previous.map(event => event.id));
          return [...previous, ...page.events.filter(event => !seen.has(event.id))];
        });
        setNextCursor(page.nextCursor); setHasMore(page.hasMore);
      }
    } catch (reason) { if (generation === pageGeneration.current) setError(reason instanceof Error ? reason.message : 'More activity could not be loaded.'); }
    finally { setLoadingMore(false); }
  }, [hasMore, nextCursor, loadingMore]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const visibleEvents = scope === 'perp' ? events.filter(event => event.kind.startsWith('perp_')) : events;

  return <Screen refreshing={refreshing} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Activity · trades and service events" title="What happened" copy="Perp orders, holds, position changes, funding, stop requests, receipts, and returned funds appear here with their submitted, executed, or finalized state." />
    {error ? <Notice live tone="rose" title="Activity unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    <View style={styles.filters}>
      <Button label="All activity" variant={scope === 'all' ? 'primary' : 'secondary'} onPress={() => setScope('all')} />
      <Button label="Perp only" variant={scope === 'perp' ? 'primary' : 'secondary'} onPress={() => setScope('perp')} />
    </View>
    {!events.length && !refreshing && !error ? <Card><Text style={s.strong}>The service returned no activity events.</Text><Text style={s.body}>New events appear after the backend records an operation, receipt, or agent status change.</Text></Card> : null}
    {scope === 'perp' && events.length > 0 && !visibleEvents.length ? <Card><Text style={s.body}>No Perp events are in the loaded pages yet.</Text></Card> : null}
    <View style={styles.timeline}>{visibleEvents.map(event => <Pressable accessibilityRole="button" accessibilityLabel={`Open event: ${event.title}`} key={event.id} onPress={() => navigation.navigate('ActivityDetail', {itemId: event.id, event})} style={({pressed}) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rail}><View style={styles.marker} /></View>
      <View style={styles.copy}>
        <View style={styles.metaRow}>{event.kind.startsWith('perp_') ? <StatusBadge label="Perp · test" tone="lilac" /> : null}<StatusBadge label={event.kind} tone={event.fundsMoved ? 'mint' : 'sky'} /><Text style={s.meta}>{eventTime(event.occurredAt)}</Text></View>
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
  if (event.kind === 'perp_order_failed' || event.summary.toLowerCase().includes('transaction reverted')) {
    return event.status === 'finalized' ? 'failed · reverted after finality' : 'reverted · awaiting finality';
  }
  return event.status;
}
function isBlocked(event: MonadActivityEvent) { return event.status === 'blocked' || event.kind.includes('blocked'); }
