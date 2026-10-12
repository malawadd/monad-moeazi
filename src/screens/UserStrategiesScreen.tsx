import React, {useCallback, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';
import {monadApi} from '../services/monadApi';
import {perplApi} from '../services/perplApi';
import {validatePerplRunOwner} from '../services/perplValidation';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {userFonts} from '../theme/tokens';
import {userThemeTokens} from '../theme/userThemes';
import type {PerplRun} from '../types/perpl';
import type {PublicStrategyMetrics, StrategyCatalogEntry, StrategyCatalogResponse} from '../types/strategies';

const REQUIRED_ID = 'perpl-deterministic';
const OPEN_RUN_STATUSES = new Set(['activation_pending', 'active', 'stopping', 'settling', 'uncertain', 'incomplete_settlement']);
const TERMINAL_RUN_STATUSES = new Set(['complete', 'completed', 'settled', 'stopped', 'expired', 'failed', 'cancelled']);

type CatalogState = {owner: string | null; catalog: StrategyCatalogResponse | null; run: PerplRun | null;
  catalogError: string; runError: string; runKnown: boolean};
const EMPTY_STATE: CatalogState = {owner: null, catalog: null, run: null, catalogError: '', runError: '', runKnown: false};

export function UserStrategiesScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const owner = ownerAddress?.toLowerCase() ?? null;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const requestRef = useRef(0);
  const {effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const [snapshot, setSnapshot] = useState<CatalogState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const requestedOwner = owner;
    const request = ++requestRef.current;
    if (!requestedOwner) {
      setSnapshot({...EMPTY_STATE, catalogError: 'Sign in to view strategies.'});
      setLoading(false);
      return;
    }
    setLoading(true);
    const [catalogResult, runResult] = await Promise.allSettled([monadApi.strategies(), perplApi.current()]);
    if (request !== requestRef.current || ownerRef.current !== requestedOwner) return;
    let catalog: StrategyCatalogResponse | null = null;
    let catalogError = '';
    let run: PerplRun | null = null;
    let runError = '';
    let runKnown = false;
    if (catalogResult.status === 'fulfilled') catalog = catalogResult.value;
    else catalogError = errorMessage(catalogResult.reason, 'Strategy catalog could not be loaded.');
    if (runResult.status === 'fulfilled') {
      try {
        const candidate = runResult.value.current;
        if (candidate) validatePerplRunOwner(candidate, requestedOwner);
        run = candidate;
        runKnown = true;
      } catch (reason) { runError = errorMessage(reason, 'Perpl status could not be checked.'); }
    } else runError = errorMessage(runResult.reason, 'Perpl status could not be checked.');
    setSnapshot({owner: requestedOwner, catalog, run, catalogError, runError, runKnown});
    setLoading(false);
  }, [owner]);

  useFocusEffect(useCallback(() => { refresh().catch(() => undefined); return () => { requestRef.current += 1; }; }, [refresh]));
  const current = snapshot.owner === owner ? snapshot : EMPTY_STATE;
  const busy = loading || snapshot.owner !== owner;
  const required = current.catalog?.strategies.find(strategy => strategy.strategyId === REQUIRED_ID);
  const runStatus = current.run?.status.toLowerCase() ?? '';
  const openRun = current.run && (OPEN_RUN_STATUSES.has(runStatus) || !TERMINAL_RUN_STATUSES.has(runStatus)) ? current.run : null;
  const metrics = usableMetrics(current.catalog?.metrics);
  const strategies = current.catalog?.strategies.slice().sort((a, b) => Number(b.strategyId === REQUIRED_ID) - Number(a.strategyId === REQUIRED_ID));

  return <UserPage theme={theme} refreshing={busy} onRefresh={() => { refresh().catch(() => undefined); }}>
    <UserHeading kicker="MONAD TESTNET · PRACTICE ONLY" title="Strategies"
      copy="Review Testnet strategies and current availability." theme={theme} />
    {busy && !current.catalog ? <UserCard theme={theme}><UserText theme={theme}>Loading strategy catalog…</UserText></UserCard> : null}
    {current.catalogError ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Strategy catalog unavailable</UserText>
      <UserText theme={theme}>Check your connection, then retry.</UserText>
      <UserButton label="Retry catalog" onPress={() => { refresh().catch(() => undefined); }} theme={theme} loading={busy} />
    </UserCard> : null}
    {current.runError ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Perpl status needs a check</UserText>
      <UserText theme={theme}>Setup stays unavailable until your current Perpl status can be checked.</UserText>
      <UserButton label="Refresh status" onPress={() => { refresh().catch(() => undefined); }} theme={theme} loading={busy} />
    </UserCard> : null}
    {openRun ? <UserCard theme={theme}>
      <UserText theme={theme} kind="meta">PERPL · {OPEN_RUN_STATUSES.has(runStatus) ? 'CURRENT RUN' : 'STATUS CHECK'}</UserText>
      <UserText theme={theme} kind="title">{OPEN_RUN_STATUSES.has(runStatus) ? openRun.status.replaceAll('_', ' ') : 'Run state needs a check'}</UserText>
      <UserButton label="View Perpl status" onPress={() => navigation.navigate('PerplStatus', {runId: openRun.runId})} theme={theme} />
    </UserCard> : null}
    {strategies?.map(strategy => <StrategyCard key={strategy.strategyId} strategy={strategy}
      selected={strategy.strategyId === REQUIRED_ID} metrics={strategy.strategyId === REQUIRED_ID ? metrics : null} theme={theme}
      onDetails={() => navigation.navigate('StrategyDetail', {strategyId: strategy.strategyId})} />)}
    {current.catalog && !required ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Required Perpl setup is unavailable</UserText>
      <UserText theme={theme}>The current catalog does not include the required Perpl strategy. No setup action is offered.</UserText>
    </UserCard> : null}
  </UserPage>;
}

function StrategyCard({strategy, selected, metrics, theme, onDetails}: {strategy: StrategyCatalogEntry; selected: boolean;
  metrics: PublicStrategyMetrics | null; theme: ReturnType<typeof userThemeTokens>; onDetails: () => void}) {
  const [expanded, setExpanded] = useState(false);
  const status = selected ? 'Included · required' : strategy.status === 'available' ? 'Available' : 'Coming soon';
  return <UserCard theme={theme} texture={selected}>
      <View style={styles.headingRow}>
        <Text style={[styles.badge, {color: selected ? theme.accentText : theme.ink,
          backgroundColor: selected ? theme.accent : theme.raised, borderColor: theme.border}]}>{status}</Text>
        <UserText theme={theme} kind="title" style={styles.rowTitle}>{strategy.name}</UserText>
      </View>
      <Text accessibilityLabel={`Creator: ${strategy.creator}`} style={[styles.creator, {color: theme.muted, fontFamily: userFonts.body}]}>By {strategy.creator}</Text>
      {!selected ? <Text style={[styles.summary, {color: theme.muted}]}>Not available yet.</Text> : null}
      {selected ? metrics ? <>
        <View accessible accessibilityLabel={`Verified Perpl Testnet aggregate. Net realized P&L ${formatMetricPnl(metrics)}; activated wallet addresses ${countLabel(metrics.uniqueActivatedWalletCount)}. Exact scope and precision are in Result details.`}
          style={[styles.metricStrip, {borderColor: theme.border}]}>
          <View style={styles.metricCell}>
            <Text style={[styles.metricLabel, {color: theme.muted}]}>NET REALIZED P&amp;L</Text>
            <Text style={[styles.metricValue, {color: theme.ink}]}>{compactMetricPnl(metrics)}</Text>
          </View>
          <View style={styles.metricCell}>
            <Text style={[styles.metricLabel, {color: theme.muted}]}>ACTIVATED WALLETS</Text>
            <Text style={[styles.metricValue, {color: theme.ink}]}>{compactCount(metrics.uniqueActivatedWalletCount)}</Text>
          </View>
        </View>
      </> : <UserText theme={theme} kind="meta">VERIFIED RESULT TOTALS · NOT AVAILABLE</UserText> : null}
      <UserButton label={selected ? 'View Perpl details' : 'View concept details'} secondary onPress={onDetails} theme={theme} />
      {selected && metrics ? <UserDisclosure label="Result details" value={expanded ? 'Hide' : 'Show'} expanded={expanded}
        onPress={() => setExpanded(value => !value)} theme={theme}>
        <UserText theme={theme}>Verified Monad Testnet aggregate from finalized Perpl cycles. Activated wallets counts addresses, not people. This is not a personal result; open-position changes and MON operator gas are excluded.</UserText>
        <UserValueRow label="Exact net realized P&amp;L" value={formatMetricPnl(metrics)} theme={theme} />
        <UserValueRow label="Verified completed cycles" value={countLabel(metrics.verifiedCycleCount)} theme={theme} />
        <UserValueRow label="Activated wallet addresses" value={countLabel(metrics.uniqueActivatedWalletCount)} theme={theme} />
        <UserValueRow label="Observed" value={formatObservedAt(metrics.observedAt)} theme={theme} />
      </UserDisclosure> : null}
  </UserCard>;
}

function usableMetrics(metrics: PublicStrategyMetrics | null | undefined): PublicStrategyMetrics | null {
  if (!metrics || metrics.strategyId !== REQUIRED_ID || metrics.currency !== 'AUSD' || metrics.decimals !== 6
      || !/^-?\d+$/.test(metrics.netRealizedPnlUnits) || !validCount(metrics.verifiedCycleCount)
      || !validCount(metrics.uniqueActivatedWalletCount) || !Number.isFinite(metrics.observedAt)) return null;
  return metrics;
}
function validCount(value: number) { return Number.isSafeInteger(value) && value >= 0; }
function countLabel(value: number) { return validCount(value) ? String(value) : 'Not available'; }
function formatMetricPnl(metrics: PublicStrategyMetrics) {
  const value = formatUnits(metrics.netRealizedPnlUnits, metrics.decimals);
  return value === null ? 'Not available' : `${value} AUSD`;
}
function compactMetricPnl(metrics: PublicStrategyMetrics) {
  const exact = formatUnits(metrics.netRealizedPnlUnits, metrics.decimals);
  if (exact === null) return 'Not available';
  if (exact.length > 12) return 'See details';
  const match = /^([+−-]?)(\d+)(?:\.(\d+))?$/.exec(exact);
  if (!match) return `${exact} AUSD`;
  const [, sign, whole, fraction = ''] = match;
  const visibleFraction = fraction.slice(0, 3);
  const hasHiddenPrecision = /[1-9]/.test(fraction.slice(3));
  return `${sign}${whole}${visibleFraction ? `.${visibleFraction}` : ''}${hasHiddenPrecision ? '…' : ''} AUSD`;
}
function compactCount(value: number) { const exact = countLabel(value); return exact.length > 7 ? 'See details' : exact; }
function formatUnits(units: string, decimals: number) {
  if (!/^-?\d+$/.test(units) || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const amount = BigInt(units); const absolute = amount < 0n ? -amount : amount;
  const base = 10n ** BigInt(decimals); const fraction = (absolute % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  const sign = amount > 0n ? '+' : amount < 0n ? '−' : '';
  return `${sign}${absolute / base}${fraction ? `.${fraction}` : ''}`;
}
function formatObservedAt(value: number) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not available'; }
function errorMessage(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback; }

const styles = StyleSheet.create({
  headingRow: {alignItems: 'flex-start', gap: 8},
  rowTitle: {width: '100%'},
  badge: {alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 2, paddingHorizontal: 8, paddingVertical: 5, fontFamily: userFonts.mono, fontWeight: '700'},
  creator: {fontSize: 13, lineHeight: 19, fontWeight: '700'},
  summary: {fontFamily: userFonts.body, fontSize: 13, lineHeight: 18},
  metricStrip: {borderTopWidth: 2, borderBottomWidth: 2, paddingVertical: 10, flexDirection: 'row', gap: 10},
  metricCell: {flex: 1, gap: 4},
  metricLabel: {fontFamily: userFonts.mono, fontSize: 10, lineHeight: 14, fontWeight: '700'},
  metricValue: {fontFamily: userFonts.display, fontSize: 16, lineHeight: 22, fontWeight: '800', flexShrink: 1, flexWrap: 'wrap'},
});
