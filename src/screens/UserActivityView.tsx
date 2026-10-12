import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {userActivityTitle, type UserActivityItem} from '../services/userActivityPresentation';
import type {UserThemeTokens} from '../theme/userThemes';
import {UserButton, UserCard, UserHeading, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';

export function UserActivityView({theme, items, loading, refreshing, error, pendingCount, dismissingReminders, hasMore, loadingMore, scope,
  showAutonomousActivity, onRefresh, onLoadMore, onSetScope, onPending, onDismissPending, onAutonomousSettings, onOpen}: {
  theme: UserThemeTokens; items: UserActivityItem[]; loading: boolean; refreshing: boolean; error: string;
  pendingCount: number; dismissingReminders: boolean; hasMore: boolean; loadingMore: boolean; scope: 'all' | 'perp';
  showAutonomousActivity: boolean;
  onRefresh(): void; onLoadMore(): void; onSetScope(value: 'all' | 'perp'): void;
  onPending(): void; onDismissPending(): void; onAutonomousSettings(): void; onOpen(item: UserActivityItem): void;
}) {
  return <UserPage theme={theme} refreshing={refreshing} onRefresh={onRefresh}>
    <UserHeading theme={theme} kicker="ACCOUNT · ACTIVITY" title="Recent activity" copy="See wallet and Perpl actions recorded for this account." />
    {pendingCount > 0 ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">An action needs a status check</UserText>
      <UserText theme={theme}>{pendingCount === 1 ? 'One saved action' : `${pendingCount} saved actions`} still need a check.</UserText>
      <UserButton label="Check transaction status" onPress={onPending} theme={theme} secondary />
      <UserButton label="Dismiss reminder" onPress={onDismissPending} theme={theme} secondary loading={dismissingReminders} />
    </UserCard> : null}
    {error ? <UserCard theme={theme}><UserText theme={theme} kind="title">{items.length ? 'Showing saved activity' : 'Activity unavailable'}</UserText>
      <UserText theme={theme}>{error}</UserText><UserButton label="Refresh activity" onPress={onRefresh} theme={theme} secondary /></UserCard> : null}
    {loading ? <UserCard theme={theme}><UserText theme={theme}>Loading activity…</UserText></UserCard> : null}
    <View style={styles.filters} accessibilityRole="radiogroup" accessibilityLabel="Activity filter">
      {(['all', 'perp'] as const).map(item => <Pressable key={item} accessibilityRole="radio"
        accessibilityState={{selected: scope === item}} onPress={() => onSetScope(item)}
        style={[styles.filter, {borderColor: theme.border, backgroundColor: scope === item ? theme.accentSoft : theme.raised}]}>
        <UserText theme={theme}>{item === 'all' ? 'All' : 'Perpl'}</UserText>
      </Pressable>)}
    </View>
    {!items.length && !loading && !error ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">{!showAutonomousActivity ? 'Autonomous updates are hidden' : 'No activity yet'}</UserText>
      <UserText theme={theme}>{!showAutonomousActivity
        ? 'Turn them on in Settings to see grouped strategy checks. Order receipts stay visible.'
        : 'Recorded actions will appear here.'}</UserText>
      {!showAutonomousActivity ? <UserButton label="Autonomous activity settings" secondary onPress={onAutonomousSettings} theme={theme} /> : null}
    </UserCard> : null}
    {items.map(item => {
      const event = item.event;
      const groupedLifecycle = Boolean(item.lifecycle);
      const title = userActivityTitle(item);
      return <Pressable key={item.key} accessibilityRole="button"
        accessibilityLabel={groupedLifecycle ? `Open ${title.toLowerCase()}, latest status ${event.status}, ${item.lifecycle!.events.length} updates`
          : `Open activity: ${event.title}`}
        onPress={() => onOpen(item)} style={({pressed}) => [styles.event, {borderColor: theme.border, backgroundColor: theme.surface}, pressed && {opacity: 0.7}]}>
        <UserText theme={theme} kind="meta">{dateLabel(event.occurredAt)} · {event.status}</UserText>
        <UserText theme={theme} kind="title">{title}</UserText>
        <UserText theme={theme}>{event.summary}</UserText>
        {item.lifecycle ? <UserText theme={theme} kind="meta">{item.lifecycle.events.length} status updates · Open for receipt details</UserText> : null}
        {event.amount && event.asset ? <UserValueRow theme={theme} label="Amount" value={`${event.amount} ${event.asset}`} /> : null}
      </Pressable>;
    })}
    {hasMore ? <UserButton label={loadingMore ? 'Loading activity…' : 'Load more activity'} onPress={onLoadMore}
      theme={theme} secondary loading={loadingMore} /> : null}
  </UserPage>;
}

function dateLabel(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString() : 'Time unavailable';
}
const styles = StyleSheet.create({filters: {flexDirection: 'row', gap: 10},
  filter: {flex: 1, minHeight: 48, borderWidth: 3, alignItems: 'center', justifyContent: 'center', padding: 8},
  event: {borderWidth: 3, padding: 14, gap: 8}});
