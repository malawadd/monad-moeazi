import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Card, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
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
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true); setError('');
    try { setEvents(await monadApi.activity()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Activity could not be loaded.'); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  return <Screen refreshing={refreshing} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Activity · on-chain and service events" title="What happened" copy="Events shown here come from the authenticated Monad activity endpoint. A hash appears only when the service reports one." />
    {error ? <Notice live tone="rose" title="Activity unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {!events.length && !refreshing && !error ? <Card><Text style={s.strong}>The service returned no activity events.</Text><Text style={s.body}>New events appear after the backend records an operation, receipt, or agent status change.</Text></Card> : null}
    <View style={styles.timeline}>{events.map(event => <Pressable accessibilityRole="button" accessibilityLabel={`Open event: ${event.title}`} key={event.id} onPress={() => navigation.navigate('ActivityDetail', {itemId: event.id})} style={({pressed}) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rail}><View style={styles.marker} /></View>
      <View style={styles.copy}>
        <View style={styles.metaRow}><StatusBadge label={event.kind} tone={event.fundsMoved ? 'mint' : 'sky'} /><Text style={s.meta}>{eventTime(event.occurredAt)}</Text></View>
        <Text style={s.subheading}>{event.title}</Text>
        <Text style={s.body}>{event.summary}</Text>
        <Text style={s.meta}>Status · {event.status}</Text>
        {event.amount && event.asset ? <Text style={s.strong}>{event.amount} {event.asset}</Text> : null}
        {event.transactionHash ? <Text selectable style={s.meta}>Tx · {event.transactionHash}</Text> : null}
      </View>
    </Pressable>)}</View>
  </Screen>;
}

const styles = StyleSheet.create({
  timeline: {borderTopWidth: 3, borderColor: colors.ink},
  row: {minHeight: 112, flexDirection: 'row', backgroundColor: colors.paper},
  pressed: {backgroundColor: colors.cream},
  rail: {width: 28, alignItems: 'center', borderRightWidth: 3, borderColor: colors.ink},
  marker: {width: 12, height: 12, marginTop: 21, marginRight: -15, backgroundColor: colors.yellow, borderWidth: 3, borderColor: colors.ink},
  copy: {flex: 1, gap: spacing.sm, padding: spacing.md, borderBottomWidth: 2, borderColor: colors.ink},
  metaRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap'},
});
