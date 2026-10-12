import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {AppState, Pressable, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useFocusEffect, useIsFocused, useNavigation} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {useNetInfo} from '@react-native-community/netinfo';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText} from '../components/user/UserPrimitives';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {userFonts} from '../theme/tokens';
import {formatMonadUnits, formatMonadTimestamp} from '../services/monadFormatting';
import {useMonadActivityQuery, useMonadWalletQuery, usePerplCurrentQuery} from '../services/useMarketQueries';
import {perplApi} from '../services/perplApi';
import {findPerplVenue} from '../services/perplValidation';
import {hasInitialAusdFunding, recordInitialAusdFunding} from '../services/userFundingMilestones';
import {formatHomeAmount, isUserHomeOffline, nextUserHomeAction, ownerScopedPerplRun, readUserWalletAsset, requiredPerplFundingUnits, verifiedPerplBalanceUnits} from '../services/userHomeReadiness';

export function UserHomeScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const {effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const focused = useIsFocused();
  const {isConnected} = useNetInfo();
  const offline = isUserHomeOffline(isConnected);
  const {width, fontScale} = useWindowDimensions();
  const compactWidth = width < 360;
  const walletQuery = useMonadWalletQuery(ownerAddress, focused);
  const currentQuery = usePerplCurrentQuery(ownerAddress, focused);
  const activityQuery = useMonadActivityQuery(ownerAddress, null, focused);
  const ownerKey = ownerAddress?.toLowerCase() ?? 'signed-out';
  const venueQuery = useQuery({
    queryKey: ['mobile', 'owner', ownerKey, 'perpl', 'venues'],
    queryFn: async () => findPerplVenue((await perplApi.venues()).venues),
    enabled: Boolean(ownerAddress && focused), staleTime: 15_000, refetchInterval: focused ? 15_000 : false,
  });
  const [initialFundingComplete, setInitialFundingComplete] = useState<boolean | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const wallet = walletQuery.data ?? null;
  const mon = useMemo(() => readUserWalletAsset(wallet, ownerAddress, 'MON'), [wallet, ownerAddress]);
  const ausd = useMemo(() => readUserWalletAsset(wallet, ownerAddress, 'AUSD'), [wallet, ownerAddress]);
  const rawRun = currentQuery.data?.current ?? null;
  const currentRun = ownerScopedPerplRun(rawRun, ownerAddress);
  const currentRunInvalid = Boolean(rawRun && !currentRun);
  const currentStatusStale = offline || currentQuery.isError || !currentQuery.data
    || Date.now() - currentQuery.dataUpdatedAt > 60_000;
  const venue = venueQuery.data ?? null;
  const required = requiredPerplFundingUnits(venue);
  const walletStale = offline || Boolean(wallet && (wallet.stale || walletQuery.isError || mon?.freshness === 'stale' || ausd?.freshness === 'stale'));
  const walletReady = Boolean(wallet && !walletQuery.isError);
  const currentReady = Boolean(ownerAddress && currentQuery.data && !currentStatusStale);

  useEffect(() => {
    let active = true;
    setInitialFundingComplete(null);
    if (!ownerAddress) return () => { active = false; };
    void hasInitialAusdFunding(ownerAddress).then(value => { if (active) setInitialFundingComplete(value); });
    return () => { active = false; };
  }, [ownerAddress]);

  useEffect(() => {
    if (!ownerAddress || initialFundingComplete || !required || venueQuery.isError || walletStale
        || mon?.freshness !== 'fresh' || ausd?.freshness !== 'fresh'
        || mon.units <= 0n || ausd.units < required) return;
    setInitialFundingComplete(true);
    void recordInitialAusdFunding(ownerAddress);
  }, [ownerAddress, initialFundingComplete, required, venueQuery.isError, walletStale, mon, ausd]);

  const refetchWallet = walletQuery.refetch;
  const refetchCurrent = currentQuery.refetch;
  const refetchActivity = activityQuery.refetch;
  const refetchVenue = venueQuery.refetch;
  const refetchAll = useCallback(async () => {
    await Promise.allSettled([refetchWallet(), refetchCurrent(), refetchActivity(), refetchVenue()]);
  }, [refetchWallet, refetchCurrent, refetchActivity, refetchVenue]);
  useFocusEffect(useCallback(() => { void refetchAll(); }, [refetchAll]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && focused) void refetchAll(); });
    return () => subscription.remove();
  }, [focused, refetchAll]);

  const refresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refetchAll(); } finally { setPullRefreshing(false); }
  }, [refetchAll]);
  const action = nextUserHomeAction({owner: ownerAddress, walletReady, walletStale, mon, ausd,
    currentReady, currentRun: currentReady ? currentRun : null, currentRunInvalid, venueReady: Boolean(venue) && !venueQuery.isError && !offline, venue,
    venueError: venueQuery.isError, initialFundingComplete});
  const actionHeading = compactWidth && action.target === 'setup' ? 'Set up Perpl' : action.title;
  const actionPress = () => {
    if (action.target === 'refresh') { void refresh(); return; }
    if (action.target === 'funding') navigation.navigate('Funding');
    else if (action.target === 'settings') navigation.navigate('AccountSettings');
    else if (action.target === 'setup') navigation.navigate('PerplSetup');
    else if (action.target === 'status') navigation.navigate('PerplStatus');
    else navigation.navigate('Strategies');
  };
  const strategyTotal = currentRun && !currentStatusStale ? verifiedPerplBalanceUnits(currentRun, ownerAddress) : null;
  const strategyObservedAt = currentRun?.positionSnapshot?.observedAt;
  const staleActivity = activityQuery.isError && Boolean(activityQuery.data);
  const exactAusd = ausd ? formatMonadUnits(ausd.units.toString(), 6) : null;
  const exactMon = mon ? formatMonadUnits(mon.units.toString(), 18) : null;
  const visibleAusd = ausd ? formatHomeAmount(ausd.units, 6, 2) : '—';
  const separateApproximation = fontScale >= 1.6 && visibleAusd.startsWith('≈ ');
  const displayAusd = separateApproximation ? visibleAusd.slice(2) : visibleAusd.replace(/^≈ /, '≈\u00a0');
  const visibleMon = mon ? formatHomeAmount(mon.units, 18, 3) : '—';
  const visiblePerpl = strategyTotal === null
    ? currentReady && !currentRunInvalid && !currentRun ? 'No active run' : '—'
    : `${formatHomeAmount(strategyTotal, 6, 2)} AUSD`;

  return <UserPage theme={theme} safeTop={false} refreshing={pullRefreshing} onRefresh={() => { void refresh(); }}>
    <View style={[styles.pageContent, compactWidth && styles.compactPageContent]}>
      <UserHeading kicker={compactWidth ? 'MONAD TESTNET' : 'MONAD TESTNET · PRACTICE ONLY'} title={compactWidth ? 'Balance' : 'Your balance'} theme={theme} />
      <UserCard theme={theme} style={[{backgroundColor: theme.accent, borderColor: theme.accentBorder}, compactWidth && styles.compactCard]}>
        <Text style={[styles.heroLabel, {color: theme.accentText}]}>{walletStale ? 'LAST KNOWN · TEST AUSD' : 'AVAILABLE IN WALLET · TEST AUSD'}</Text>
        {separateApproximation ? <Text style={[styles.heroApprox, {color: theme.accentText}]}>ABOUT</Text> : null}
        <Text accessibilityLabel={ausd ? `Test AUSD available in wallet: ${visibleAusd}` : 'Test AUSD balance unavailable'}
          style={[styles.heroValue, {color: theme.accentText, fontSize: compactWidth ? 34 : 42, lineHeight: compactWidth ? 42 : 52}]}>{displayAusd}</Text>
        <Text style={[styles.heroNote, {color: theme.accentText}]}>{ausd ? 'Test token · no real-world value' : 'Balance not returned'}</Text>
        <View style={[styles.heroDivider, {borderColor: theme.accentText}]} />
        <View style={styles.heroRow}>
          <View style={styles.heroCell}>
            <Text style={[styles.heroLabel, {color: theme.accentText}]}>NETWORK FEES · MON</Text>
            <Text accessibilityLabel={mon ? `Test MON for network fees: ${visibleMon} MON` : 'Test MON balance unavailable'} style={[styles.heroSmallValue, {color: theme.accentText}]}>{visibleMon} MON</Text>
          </View>
          <View style={styles.heroCell}>
            <Text style={[styles.heroLabel, {color: theme.accentText}]}>STRATEGY FUNDS</Text>
            <Text accessibilityLabel={strategyTotal === null ? currentReady && !currentRun ? 'No active Perpl run' : 'Perpl strategy funds unavailable' : `Perpl strategy funds: ${visiblePerpl}`}
              style={[styles.heroSmallValue, {color: theme.accentText}]}>{visiblePerpl}</Text>
          </View>
        </View>
      </UserCard>
      <UserCard theme={theme} texture style={compactWidth ? styles.compactCard : undefined}>
        <UserText theme={theme} kind="meta">YOUR NEXT STEP</UserText>
        <UserText theme={theme} kind="title" style={compactWidth ? styles.compactActionTitle : undefined}>{actionHeading}</UserText>
        <UserButton label={action.label} onPress={actionPress} theme={theme}
          loading={action.target === 'refresh' && (walletQuery.isFetching || currentQuery.isFetching || venueQuery.isFetching)}
          hint={action.target === 'refresh' ? 'Refresh the wallet, strategy and setup status.' : undefined} />
        <UserText theme={theme}>{action.detail}</UserText>
      </UserCard>
      <UserDisclosure theme={theme} label="Exact balance details" value={detailsExpanded ? 'Hide' : 'Show'} expanded={detailsExpanded}
        onPress={() => setDetailsExpanded(value => !value)}>
        <UserText theme={theme}>Available in wallet · Test AUSD: {exactAusd ?? 'Not available'}</UserText>
        <UserText theme={theme}>Network fees · MON: {exactMon ?? 'Not available'}</UserText>
        <UserText theme={theme}>Strategy funds · Perpl: {strategyTotal === null ? 'Not available' : `${formatMonadUnits(strategyTotal.toString(), 6)} AUSD`}</UserText>
        <UserText theme={theme}>Run result: — · Results unavailable</UserText>
        {wallet ? <UserText theme={theme} kind="meta">Wallet checked {formatMonadTimestamp(wallet.observedAt)}</UserText> : null}
        {strategyObservedAt ? <UserText theme={theme} kind="meta">Perpl checked {formatMonadTimestamp(strategyObservedAt)}</UserText> : null}
      </UserDisclosure>
      {activityQuery.data?.events.slice(0, 2).length ? <UserCard theme={theme}>
        <View style={styles.activityHeader}><UserText theme={theme} kind="title">Recent activity</UserText>
          <Pressable accessibilityRole="link" accessibilityLabel="View all activity" onPress={() => navigation.navigate('Activity')} style={styles.activityLink}>
            <Text style={[styles.activityLinkText, {color: theme.ink}]}>View all</Text></Pressable>
        </View>
        {activityQuery.data.events.slice(0, 2).map(event => <Pressable key={event.id} accessibilityRole="button"
          accessibilityLabel={`Open ${event.title}, status ${event.status}`} onPress={() => navigation.navigate('ActivityDetail', {itemId: event.id, event})}
          style={[styles.activityRow, {borderColor: theme.border}]}>
          <View style={styles.activityCopy}><Text numberOfLines={1} style={[styles.activityTitle, {color: theme.ink}]}>{event.title}</Text>
            <Text numberOfLines={2} style={[styles.activitySummary, {color: theme.muted}]}>{event.summary}</Text></View>
          <Text style={[styles.activityStatus, {color: theme.ink}]}>{event.status}</Text>
          {event.status === 'finalized' && event.fundsMoved && event.amount && event.asset ?
            <Text style={[styles.activityAmount, {color: theme.ink}]}>{event.amount} {event.asset}</Text> : null}
        </Pressable>)}
        {staleActivity ? <UserText theme={theme} kind="meta">Activity may be out of date.</UserText> : null}
      </UserCard> : activityQuery.isError ? <UserText theme={theme} kind="meta">Recent activity unavailable</UserText> : null}
    </View>
  </UserPage>;
}

const styles = StyleSheet.create({
  pageContent: {gap: 16}, compactPageContent: {gap: 10}, compactCard: {padding: 10, gap: 8},
  compactActionTitle: {fontSize: 18, lineHeight: 23},
  heroLabel: {fontFamily: userFonts.mono, fontSize: 11, lineHeight: 16, fontWeight: '700', letterSpacing: 0.7},
  heroApprox: {fontFamily: userFonts.mono, fontSize: 11, lineHeight: 16, fontWeight: '700', letterSpacing: 0.7},
  heroValue: {fontFamily: userFonts.display, lineHeight: 52, fontWeight: '800', flexShrink: 1, fontVariant: ['tabular-nums']},
  heroNote: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 20, fontWeight: '700'},
  heroDivider: {borderTopWidth: 2, opacity: 0.42, marginVertical: 4},
  heroRow: {flexDirection: 'row', flexWrap: 'wrap', gap: 14}, heroCell: {flex: 1, minWidth: 112, gap: 3},
  heroSmallValue: {fontFamily: userFonts.body, fontSize: 17, lineHeight: 24, fontWeight: '800', flexShrink: 1},
  activityHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  activityLink: {minHeight: 48, minWidth: 48, justifyContent: 'center', alignItems: 'flex-end'},
  activityLinkText: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 20, fontWeight: '800', textDecorationLine: 'underline'},
  activityRow: {minHeight: 52, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingVertical: 8, borderBottomWidth: 1},
  activityCopy: {flex: 1, minWidth: 150, gap: 2}, activityTitle: {fontFamily: userFonts.body, fontWeight: '800', fontSize: 14, lineHeight: 19},
  activitySummary: {fontFamily: userFonts.body, fontSize: 12, lineHeight: 16}, activityStatus: {fontFamily: userFonts.mono, fontWeight: '700', fontSize: 10},
  activityAmount: {fontFamily: userFonts.body, fontWeight: '800', fontSize: 13, lineHeight: 19},
});
