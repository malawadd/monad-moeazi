import React, {useCallback, useRef, useState} from 'react';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {StyleSheet, Text, View} from 'react-native';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';
import {monadApi} from '../services/monadApi';
import {perplApi} from '../services/perplApi';
import {validatePerplRunOwner} from '../services/perplValidation';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {userFonts} from '../theme/tokens';
import {userThemeTokens} from '../theme/userThemes';
import type {PerplRun} from '../types/perpl';
import type {PublicStrategyMetrics, StrategyCatalogResponse} from '../types/strategies';

const REQUIRED_ID = 'perpl-deterministic';
const SETUP_ROUTE = 'PerplSetup';
const SETUP_VENUE = 'perpl-direct-testnet-v1';
const OPEN_RUN_STATUSES = new Set(['activation_pending', 'active', 'stopping', 'settling', 'uncertain', 'incomplete_settlement']);
const TERMINAL_RUN_STATUSES = new Set(['complete', 'completed', 'settled', 'stopped', 'expired', 'failed', 'cancelled']);

type DetailState = {owner: string | null; catalog: StrategyCatalogResponse | null; run: PerplRun | null;
  catalogError: string; runError: string; runKnown: boolean};
const EMPTY: DetailState = {owner: null, catalog: null, run: null, catalogError: '', runError: '', runKnown: false};

export function UserStrategyDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const strategyId = typeof route.params?.strategyId === 'string' ? route.params.strategyId : REQUIRED_ID;
  const {ownerAddress} = useApp();
  const owner = ownerAddress?.toLowerCase() ?? null;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const requestRef = useRef(0);
  const {effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const [snapshot, setSnapshot] = useState<DetailState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [feeOpen, setFeeOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const refresh = useCallback(async () => {
    const requestedOwner = owner;
    const request = ++requestRef.current;
    if (!requestedOwner) {
      setSnapshot({...EMPTY, catalogError: 'Sign in to view strategy details.'}); setLoading(false); return;
    }
    setLoading(true);
    const [catalogResult, runResult] = await Promise.allSettled([monadApi.strategies(), perplApi.current()]);
    if (request !== requestRef.current || ownerRef.current !== requestedOwner) return;
    let catalog: StrategyCatalogResponse | null = null; let catalogError = '';
    let run: PerplRun | null = null; let runError = ''; let runKnown = false;
    if (catalogResult.status === 'fulfilled') catalog = catalogResult.value;
    else catalogError = errorMessage(catalogResult.reason, 'Strategy details could not be loaded.');
    if (runResult.status === 'fulfilled') {
      try {
        const candidate = runResult.value.current;
        if (candidate) validatePerplRunOwner(candidate, requestedOwner);
        run = candidate; runKnown = true;
      } catch (reason) { runError = errorMessage(reason, 'Perpl status could not be checked.'); }
    } else runError = errorMessage(runResult.reason, 'Perpl status could not be checked.');
    setSnapshot({owner: requestedOwner, catalog, run, catalogError, runError, runKnown}); setLoading(false);
  }, [owner]);
  useFocusEffect(useCallback(() => { refresh().catch(() => undefined); return () => { requestRef.current += 1; }; }, [refresh]));

  const state = snapshot.owner === owner ? snapshot : EMPTY;
  const busy = loading || snapshot.owner !== owner;
  const strategy = state.catalog?.strategies.find(item => item.strategyId === strategyId);
  const status = state.run?.status.toLowerCase() ?? '';
  const activeRun = state.run && OPEN_RUN_STATUSES.has(status) ? state.run : null;
  const knownTerminalRun = state.run && TERMINAL_RUN_STATUSES.has(status);
  const required = strategy?.strategyId === REQUIRED_ID && strategy.kind === 'deterministic';
  const routeAvailable = Boolean(strategy && required && strategy.status === 'available'
    && strategy.enrollmentDestination?.type === 'mobile_route'
    && strategy.enrollmentDestination.route === SETUP_ROUTE
    && strategy.enrollmentDestination.venueId === SETUP_VENUE);
  const canReview = Boolean(routeAvailable && state.runKnown && (state.run === null || knownTerminalRun));
  const unresolvedRun = Boolean(state.run && !activeRun && !knownTerminalRun);
  const metrics = strategy?.strategyId === REQUIRED_ID ? usableMetrics(state.catalog?.metrics) : null;
  const plannedUnavailable = strategy?.status === 'planned_unavailable';
  const availabilityCopy = required ? routeAvailable ? 'Available on Testnet' : 'Not available yet'
    : strategy?.status === 'available' ? 'Listed in catalog' : 'Coming soon';

  return <UserPage theme={theme} refreshing={busy} onRefresh={() => { refresh().catch(() => undefined); }}>
    <UserButton label="Back to Strategies" secondary onPress={() => navigation.goBack()} theme={theme} />
    <UserHeading kicker="STRATEGY DETAILS · MONAD TESTNET" title={strategy?.name ?? 'Strategy details'}
      copy={required ? 'The required base strategy. Review its current setup before deciding.'
        : plannedUnavailable ? 'A planned concept, not available in the current catalog.' : strategy?.creator ?? 'Review current catalog information.'} theme={theme} />
    {busy && !strategy ? <UserCard theme={theme}><UserText theme={theme}>Loading strategy details…</UserText></UserCard> : null}
    {state.catalogError ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Strategy details unavailable</UserText>
      <UserText theme={theme}>Check your connection, then retry.</UserText>
      <UserButton label="Retry details" onPress={() => { refresh().catch(() => undefined); }} theme={theme} loading={busy} />
    </UserCard> : null}
    {state.runError ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Perpl status needs a check</UserText>
      <UserText theme={theme}>Setup stays unavailable until your current Perpl status can be checked.</UserText>
      <UserButton label="Refresh status" onPress={() => { refresh().catch(() => undefined); }} theme={theme} loading={busy} />
    </UserCard> : null}
    {strategy ? <>
      {activeRun ? <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Perpl run · {activeRun.status.replaceAll('_', ' ')}</UserText>
        <UserButton label="View Perpl status" onPress={() => navigation.navigate('PerplStatus', {runId: activeRun.runId})} theme={theme} />
      </UserCard> : null}
      {unresolvedRun ? <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Perpl run state needs a check</UserText>
        <UserText theme={theme}>Check its current status before starting another run.</UserText>
        <UserButton label="Check Perpl status" onPress={() => navigation.navigate('PerplStatus', {runId: state.run!.runId})} theme={theme} />
      </UserCard> : null}
      {required ? <UserButton label="Review Perpl setup" disabled={!canReview || Boolean(activeRun)}
        hint={!state.runKnown ? 'Wait for the current Perpl status check before setup.' : state.run ? 'Check the existing Perpl run before starting another.' : 'Opens setup for review; it does not enroll or trade.'}
        onPress={() => navigation.navigate(SETUP_ROUTE)} theme={theme} loading={busy} />
        : <UserButton label={plannedUnavailable ? 'Coming soon' : 'Not available yet'} disabled hint="Setup is not available for this item yet." onPress={() => undefined} theme={theme} />}
      <UserCard theme={theme} texture={required}>
        <UserText theme={theme} kind="meta">{required ? 'INCLUDED · REQUIRED BASE' : plannedUnavailable ? 'COMING SOON' : 'CATALOG STATUS'}</UserText>
        <UserValueRow label="Availability" value={availabilityCopy} theme={theme} />
        <UserValueRow label={plannedUnavailable ? 'Planned Moeazi fee' : 'Moeazi fee'} value={compactStrategyFee(strategy.fee.rateBps)} theme={theme} />
        <UserValueRow label="Creator" value={strategy.creator} theme={theme} />
        {!required ? <UserText theme={theme}>{plannedUnavailable ? 'Planned concept.' : 'Not available yet.'}</UserText> : null}
      </UserCard>
      {required && !routeAvailable ? <UserText theme={theme}>Perpl setup is not available right now.</UserText> : null}
      {required && !state.runKnown && !state.runError ? <UserText theme={theme}>Checking current Perpl status before setup…</UserText> : null}
      {required && metrics ? <MetricsCard metrics={metrics} theme={theme} expanded={metricsOpen} onToggle={() => setMetricsOpen(value => !value)} /> : required ? <UserText theme={theme} kind="meta">VERIFIED RESULTS · NOT AVAILABLE</UserText> : null}
      <UserDisclosure label={required ? 'How it works' : 'Concept description'} value={descriptionOpen ? 'Hide' : 'Show'}
        expanded={descriptionOpen} onPress={() => setDescriptionOpen(value => !value)} theme={theme}>
        <UserText theme={theme}>{strategy.description}</UserText>
        {!required ? <UserText theme={theme}>This item does not have a supported setup route in the app.</UserText> : null}
      </UserDisclosure>
      <UserDisclosure label="Fee details" value={feeOpen ? 'Hide' : 'Show'}
        expanded={feeOpen} onPress={() => setFeeOpen(value => !value)} theme={theme}>
        <UserText theme={theme}>Moeazi: {strategy.fee.description}</UserText>
        <UserText theme={theme}>Venue: {strategy.venueFees?.description ?? 'Venue fee information was not returned.'}</UserText>
      </UserDisclosure>
    </> : !busy && !state.catalogError ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Strategy not available in this catalog</UserText>
      <UserText theme={theme}>Return to Strategies and choose an item currently listed by the service.</UserText>
      <UserButton label="Back to strategies" secondary onPress={() => navigation.navigate('Main', {screen: 'Strategies'})} theme={theme} />
    </UserCard> : null}
  </UserPage>;
}

function MetricsCard({metrics, theme, expanded, onToggle}: {metrics: PublicStrategyMetrics; theme: ReturnType<typeof userThemeTokens>; expanded: boolean; onToggle: () => void}) {
  return <UserCard theme={theme}>
    <UserText theme={theme} kind="meta">VERIFIED TESTNET TOTALS</UserText>
    <View accessible accessibilityLabel={`Verified Perpl Testnet aggregate. Net realized P&L ${formatMetricPnl(metrics)}; activated wallet addresses ${countLabel(metrics.uniqueActivatedWalletCount)}. Exact scope and precision are in Result scope.`}
      style={styles.metricStrip}>
      <View style={styles.metricCell}><Text style={[styles.metricLabel, {color: theme.muted}]}>NET REALIZED P&amp;L</Text>
        <Text style={[styles.metricValue, {color: theme.ink}]}>{compactMetricPnl(metrics)}</Text></View>
      <View style={styles.metricCell}><Text style={[styles.metricLabel, {color: theme.muted}]}>ACTIVATED WALLETS</Text>
        <Text style={[styles.metricValue, {color: theme.ink}]}>{compactCount(metrics.uniqueActivatedWalletCount)}</Text></View>
    </View>
    <UserDisclosure label="Result scope" value={expanded ? 'Hide' : 'Show'} expanded={expanded} onPress={onToggle} theme={theme}>
      <UserText theme={theme}>Verified Monad Testnet aggregate from finalized Perpl cycles, not your wallet balance or current-run result. Activated wallets counts addresses, not people. Open-position changes and operator gas paid in MON are excluded; no lifetime period is reported.</UserText>
      <UserValueRow label="Exact net realized P&amp;L" value={formatMetricPnl(metrics)} theme={theme} />
      <UserValueRow label="Verified completed cycles" value={countLabel(metrics.verifiedCycleCount)} theme={theme} />
      <UserValueRow label="Activated wallet addresses" value={countLabel(metrics.uniqueActivatedWalletCount)} theme={theme} />
      <UserValueRow label="Observed" value={formatObservedAt(metrics.observedAt)} theme={theme} />
    </UserDisclosure>
  </UserCard>;
}

function usableMetrics(metrics: PublicStrategyMetrics | null | undefined): PublicStrategyMetrics | null {
  return metrics && metrics.strategyId === REQUIRED_ID && metrics.currency === 'AUSD' && metrics.decimals === 6
    && /^-?\d+$/.test(metrics.netRealizedPnlUnits) && validCount(metrics.verifiedCycleCount)
    && validCount(metrics.uniqueActivatedWalletCount) && Number.isFinite(metrics.observedAt) ? metrics : null;
}
function validCount(value: number) { return Number.isSafeInteger(value) && value >= 0; }
function countLabel(value: number) { return validCount(value) ? String(value) : 'Not available'; }
function formatUnits(units: string, decimals: number) {
  if (!/^-?\d+$/.test(units) || !Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const value = BigInt(units); const absolute = value < 0n ? -value : value; const base = 10n ** BigInt(decimals);
  const fraction = (absolute % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${value > 0n ? '+' : value < 0n ? '−' : ''}${absolute / base}${fraction ? `.${fraction}` : ''}`;
}
function formatMetricPnl(metrics: PublicStrategyMetrics) {
  const value = formatUnits(metrics.netRealizedPnlUnits, metrics.decimals);
  return value === null ? 'Not available' : `${value} AUSD`;
}
function compactStrategyFee(rateBps: number) {
  if (!Number.isSafeInteger(rateBps) || rateBps < 0) return 'See fee details';
  const whole = Math.floor(rateBps / 100);
  const fraction = String(rateBps % 100).padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}% on positive net profit`;
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
function formatObservedAt(value: number) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Not available'; }
function errorMessage(reason: unknown, fallback: string) { return reason instanceof Error ? reason.message : fallback; }

const styles = StyleSheet.create({
  metricStrip: {flexDirection: 'row', gap: 10},
  metricCell: {flex: 1, gap: 4},
  metricLabel: {fontFamily: userFonts.mono, fontSize: 10, lineHeight: 14, fontWeight: '700'},
  metricValue: {fontFamily: userFonts.display, fontSize: 18, lineHeight: 24, fontWeight: '800', flexShrink: 1},
});
