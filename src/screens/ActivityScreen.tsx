import React, {useCallback, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Card, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {useApp} from '../state/AppContext';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {haptics} from '../services/haptics';

const filters = ['All', 'AI', 'Trades', 'Money', 'Credits', 'Safety'] as const;

export function ActivityScreen() {
  const navigation = useNavigation<any>(); const {activity, refreshActivity, refreshHome, home, mode} = useApp(); const [filter, setFilter] = useState<(typeof filters)[number]>('All'); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState('');
  const refreshRef = useRef(refreshActivity); refreshRef.current = refreshActivity;
  const homeRef = useRef(refreshHome); homeRef.current = refreshHome;
  useFocusEffect(useCallback(() => {
    if (mode !== 'authenticated') return;
    refreshRef.current().catch(() => setError('Could not load the latest activity. Pull down to retry.'));
    homeRef.current().catch(() => undefined);
  }, [mode]));
  const rows = filter === 'All' ? activity : activity.filter(item => item.category === filter);
  const refresh = async () => { setRefreshing(true); setError(''); try { await refreshActivity(); } catch (reason) { haptics.reject(); setError(reason instanceof Error ? reason.message : 'Could not refresh activity.'); } finally { setRefreshing(false); } };
  return <Screen refreshing={refreshing} onRefresh={refresh}>
    <PageHeader kicker="Activity" title="What happened" copy="One readable timeline for AI work, trades, money, credits, and safety." />
    {home.analysisProviderStatus === 'unavailable' ? <Notice live tone="rose" title="Market checks cannot finish right now" message="Moeazi's analysis provider is unavailable. Your Autopilot schedule is still on; this status does not confirm any trade." /> : null}
    <View style={styles.filters}>{filters.map(item => <Pressable accessibilityRole="button" accessibilityState={{selected: filter === item}} key={item} onPress={() => setFilter(item)} style={[styles.filter, filter === item && styles.selected]}><Text style={styles.filterText}>{item}</Text></Pressable>)}</View>
    {error ? <Notice live tone="rose" title="Activity is not current" message={error} actionLabel="Retry" onAction={refresh} /> : null}
    {rows.length === 0 ? <Card><Text style={s.strong}>{filter === 'All' ? 'No activity recorded yet.' : `No ${filter.toLowerCase()} events recorded yet.`}</Text><Text style={s.body}>When Moeazi checks a market, reserves credits, moves money, or confirms a trade, the recorded steps appear here. Pull down to refresh.</Text></Card> : null}
    <View style={styles.timeline}>{rows.map(item => <Pressable accessibilityRole="button" accessibilityLabel={`Open activity: ${item.title}`} key={item.id} onPress={() => navigation.navigate('ActivityDetail', {itemId: item.id})} style={({pressed}) => [styles.timelineRow, pressed && styles.timelinePressed]}><View style={styles.rail}><View style={styles.marker} /></View><View style={styles.timelineBody}><View style={s.row}><StatusBadge label={item.category} tone={item.category === 'Safety' ? 'rose' : item.category === 'Money' ? 'mint' : 'sky'} /><Text style={s.meta}>{item.timeLabel}</Text></View><Text style={s.subheading}>{item.title}</Text><Text style={s.body}>{item.summary}</Text><Text style={s.strong}>{item.result}</Text></View></Pressable>)}</View>
  </Screen>;
}

const styles = StyleSheet.create({
  filters: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  filter: {minHeight: 48, justifyContent: 'center', paddingHorizontal: 13, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper},
  selected: {backgroundColor: colors.pink},
  filterText: {...type.meta, color: colors.ink, fontSize: 11, textTransform: 'uppercase'},
  timeline: {borderTopWidth: 3, borderColor: colors.ink},
  timelineRow: {minHeight: 108, flexDirection: 'row', backgroundColor: colors.paper},
  timelinePressed: {backgroundColor: colors.cream},
  rail: {width: 28, alignItems: 'center', borderRightWidth: 3, borderColor: colors.ink},
  marker: {width: 12, height: 12, marginTop: 21, marginRight: -15, backgroundColor: colors.yellow, borderWidth: 3, borderColor: colors.ink},
  timelineBody: {flex: 1, gap: spacing.sm, padding: spacing.md, borderBottomWidth: 2, borderColor: colors.ink},
});
