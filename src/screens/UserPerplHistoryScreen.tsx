import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';
import {marketDirectoryApi} from '../services/marketDirectoryApi';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import {perplApi} from '../services/perplApi';
import {validatePerplRunOwner} from '../services/perplValidation';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {userFonts} from '../theme/tokens';
import {userThemeTokens} from '../theme/userThemes';
import type {PerplEvent, PerplOrder, PerplRunHistoryPage} from '../types/perpl';
import type {MarketTradeSummary} from '../types/marketDirectory';

type Snapshot = {owner: string; runId: string; page: PerplRunHistoryPage; summaries: MarketTradeSummary[]};

export function UserPerplHistoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const runId = typeof route.params?.runId === 'string' ? route.params.runId : '';
  const {ownerAddress} = useApp();
  const owner = ownerAddress?.toLowerCase() ?? '';
  const {effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const ownerRef = useRef(owner);
  const runRef = useRef(runId);
  ownerRef.current = owner;
  runRef.current = runId;
  const requestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [summaryUnavailable, setSummaryUnavailable] = useState(false);
  const [summariesExpanded, setSummariesExpanded] = useState(false);
  const [observationsExpanded, setObservationsExpanded] = useState(false);
  const [checksExpanded, setChecksExpanded] = useState(false);
  useEffect(() => { setSummariesExpanded(false); setObservationsExpanded(false); setChecksExpanded(false); }, [owner, runId]);

  const refresh = useCallback(async () => {
    const requestedOwner = owner;
    const requestedRunId = runId;
    const request = ++requestRef.current;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (!requestedOwner || !/^[A-Za-z0-9_-]{1,160}$/.test(requestedRunId)) {
      setSnapshot(null);
      setError(!requestedOwner ? 'Sign in to view this run history.' : 'No valid Perpl run was selected.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [historyResult, summaryResult] = await Promise.allSettled([
        perplApi.runHistory(requestedRunId, 50), marketDirectoryApi.trades(undefined, undefined, requestedRunId),
      ]);
      if (request !== requestRef.current || ownerRef.current !== requestedOwner || runRef.current !== requestedRunId) return;
      if (historyResult.status !== 'fulfilled') throw historyResult.reason;
      const page = historyResult.value;
      validatePage(page, requestedRunId, requestedOwner);
      const hasSummaries = summaryResult.status === 'fulfilled' && Array.isArray(summaryResult.value.summaries);
      const summaries = hasSummaries
        ? selectSummaries(summaryResult.value.summaries, requestedRunId) : [];
      setSnapshot({owner: requestedOwner, runId: requestedRunId, page, summaries});
      setSummaryUnavailable(!hasSummaries);
    } catch {
      if (request === requestRef.current && ownerRef.current === requestedOwner && runRef.current === requestedRunId) {
        setSnapshot(null);
        setError('This Perpl run history is unavailable for the current wallet.');
      }
    } finally {
      if (request === requestRef.current && ownerRef.current === requestedOwner && runRef.current === requestedRunId) setLoading(false);
    }
  }, [owner, runId]);

  useFocusEffect(useCallback(() => {
    refresh().catch(() => undefined);
    return () => { requestRef.current += 1; loadingMoreRef.current = false; };
  }, [refresh]));

  const current = snapshot?.owner === owner && snapshot.runId === runId ? snapshot : null;
  const busy = loading;

  async function loadMore() {
    const page = current?.page;
    if (!page?.hasMore || !page.nextCursor || loadingMoreRef.current || !owner || !runId) return;
    const request = requestRef.current;
    const requestedOwner = owner;
    const requestedRunId = runId;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = await perplApi.runHistory(requestedRunId, 50, page.nextCursor);
      if (request !== requestRef.current || ownerRef.current !== requestedOwner || runRef.current !== requestedRunId) return;
      validatePage(next, requestedRunId, requestedOwner);
      setSnapshot(previous => {
        if (!previous || previous.owner !== requestedOwner || previous.runId !== requestedRunId) return previous;
        return {...previous, page: {...next,
          events: appendUnique(previous.page.events, next.events, eventKey),
          orders: appendUnique(previous.page.orders, next.orders, orderKey),
          observations: appendUnique(previous.page.observations, next.observations, observationKey),
          cycles: next.cycles ?? previous.page.cycles, journal: next.journal ?? previous.page.journal,
        }};
      });
      setError('');
    } catch {
      if (request === requestRef.current && ownerRef.current === requestedOwner && runRef.current === requestedRunId) {
        setError('More run history could not be loaded. Retry when connected.');
      }
    } finally {
      if (request === requestRef.current) {
        loadingMoreRef.current = false;
        if (ownerRef.current === requestedOwner && runRef.current === requestedRunId) setLoadingMore(false);
      }
    }
  }

  return <UserPage theme={theme} refreshing={busy} onRefresh={() => { refresh().catch(() => undefined); }}>
    <UserButton label="Back" secondary onPress={() => navigation.goBack()} theme={theme} />
    <UserHeading kicker="PERPL · MONAD TESTNET" title="Run history"
      copy="Review recorded activity and receipts for this Perpl run." theme={theme} />
    {loading && !current ? <UserCard theme={theme}><UserText theme={theme}>Loading run history…</UserText></UserCard> : null}
    {error ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Run history unavailable</UserText>
      <UserText theme={theme}>{error}</UserText>
      <UserButton label="Retry run history" onPress={() => { refresh().catch(() => undefined); }} theme={theme} loading={loading} />
    </UserCard> : null}
    {current ? <>
      <UserCard theme={theme} texture>
        <UserText theme={theme} kind="meta">{humanize(current.page.run.status)}</UserText>
        <UserText theme={theme} kind="title">{current.page.run.venueId === 'perpl-direct-testnet-v1' ? 'Perpl deterministic' : 'Perpl Testnet'}</UserText>
        <UserValueRow label="Starting collateral" value={amount(current.page.run.startingAmountUnits, current.page.run.collateral.decimals)} theme={theme} />
        {validUnits(current.page.run.returnedUnits) ? <UserValueRow label="Recorded return to wallet"
          value={`${formatMonadUnits(current.page.run.returnedUnits, current.page.run.collateral.decimals)} AUSD`} theme={theme} /> : null}
        {(!validUnits(current.page.run.startingAmountUnits) || !validUnits(current.page.run.returnedUnits))
          ? <UserText theme={theme}>Unavailable amounts are not shown as zero.</UserText> : null}
      </UserCard>
      <UserButton label="View run status" onPress={() => navigation.navigate('PerplStatus', {runId: current.page.run.runId})} theme={theme} />
      <UserDisclosure label="Position summaries" value={current.summaries.length ? String(current.summaries.length) : 'None yet'}
        expanded={summariesExpanded} onPress={() => setSummariesExpanded(value => !value)} theme={theme}>
        {summaryUnavailable ? <UserText theme={theme}>Position summaries are unavailable right now.</UserText>
          : current.summaries.length ? current.summaries.map(summary => <SummaryRow key={summary.summaryId} summary={summary} theme={theme}
            onOpen={() => navigation.navigate('MarketDetail', {venueId: summary.venueId, marketId: summary.marketId, summaryId: summary.summaryId})} />)
          : <UserText theme={theme}>No position summaries have been returned for this run.</UserText>}
      </UserDisclosure>
      <UserText theme={theme} kind="title">Recorded activity</UserText>
      {current.page.events.filter(event => !isStrategyTick(event)).length
        ? current.page.events.filter(event => !isStrategyTick(event)).map((event, index) => <EventItem key={eventKey(event) ?? `event-${index}`} event={event} theme={theme} />)
        : current.page.events.length ? null : <UserCard theme={theme}><UserText theme={theme}>No events are recorded for this run yet.</UserText></UserCard>}
      {current.page.events.some(isStrategyTick) ? <UserDisclosure label="Strategy checks"
        value={String(current.page.events.filter(isStrategyTick).length)} expanded={checksExpanded}
        onPress={() => setChecksExpanded(value => !value)} theme={theme}>
        <UserText theme={theme}>Recorded strategy scans and policy checks. These entries do not imply that an order was proposed or filled.</UserText>
        {summarizeStrategyTicks(current.page.events.filter(isStrategyTick)).map(item => <UserValueRow key={item.status}
          label={humanize(item.status)} value={`${item.count} check${item.count === 1 ? '' : 's'}`} theme={theme} />)}
      </UserDisclosure> : null}
      {current.page.orders.length ? <>
        <UserText theme={theme} kind="title">Orders</UserText>
        {current.page.orders.map((order, index) => <OrderItem key={orderKey(order) ?? `order-${index}`} order={order} theme={theme} />)}
      </> : null}
      {current.page.observations.length ? <UserDisclosure label="Market observations" value={String(current.page.observations.length)}
        expanded={observationsExpanded} onPress={() => setObservationsExpanded(value => !value)} theme={theme}>
        {current.page.observations.map((record, index) => <UserText key={observationKey(record) ?? `observation-${index}`} theme={theme}>
          {readableObservation(record)}
        </UserText>)}
      </UserDisclosure> : null}
      {current.page.hasMore ? <UserButton label="Load more history" secondary onPress={() => { loadMore().catch(() => undefined); }} theme={theme} loading={loadingMore} /> : null}
    </> : null}
  </UserPage>;
}

function EventItem({event, theme}: {event: PerplEvent; theme: ReturnType<typeof userThemeTokens>}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const rawSummary = event.summary || event.title;
  const kind = String(event.kind ?? event.type ?? 'perpl_update');
  const title = eventTitle(kind);
  const state = humanize(String(event.phase ?? event.status ?? 'Recorded'));
  const timestamp = event.occurredAt ?? event.timestamp;
  const formattedTime = timestamp ? formatMonadTimestamp(timestamp) : 'Time unavailable';
  const hash = event.transactionHash ?? event.txHash;
  const block = event.blockNumber;
  return <View testID={`user-perpl-event-${eventKey(event) ?? String(event.timestamp ?? 'unknown')}`}>
    <View style={[styles.eventRow, {borderBottomColor: theme.border}]}>
      <Text style={[styles.eventTitle, {color: theme.ink, fontFamily: userFonts.display}]}>{title}</Text>
      <Text style={[styles.eventMeta, {color: theme.muted, fontFamily: userFonts.body}]}>{state} · {formattedTime}</Text>
      <UserDisclosure label="Event details" value={detailsExpanded ? 'Hide' : 'Show'} expanded={detailsExpanded}
        onPress={() => setDetailsExpanded(value => !value)} theme={theme}>
        {rawSummary ? <UserText theme={theme}>{String(rawSummary)}</UserText> : <UserText theme={theme}>No additional event note was recorded.</UserText>}
        {validUnits(event.amountUnits) ? <UserValueRow label="Amount" value={`${formatMonadUnits(event.amountUnits, 6)} AUSD`} theme={theme} /> : null}
        {timestamp ? <UserValueRow label="Recorded" value={formattedTime} theme={theme} /> : null}
        {hash ? <Text selectable style={[styles.hash, {color: theme.ink, fontFamily: userFonts.mono}]}>{String(hash)}</Text> : null}
        {block !== undefined && block !== null ? <UserValueRow label="Block" value={String(block)} theme={theme} /> : null}
        {!hash && (block === undefined || block === null) ? <UserText theme={theme}>No transaction receipt is attached to this event.</UserText> : null}
      </UserDisclosure>
    </View>
  </View>;
}

function OrderItem({order, theme}: {order: PerplOrder; theme: ReturnType<typeof userThemeTokens>}) {
  const [expanded, setExpanded] = useState(false);
  const hash = typeof order.txHash === 'string' ? order.txHash : '';
  return <UserCard theme={theme}>
    <UserText theme={theme} kind="title">{order.symbol || (order.marketId !== undefined ? `Market ${order.marketId}` : 'Perpl order')}</UserText>
    <UserValueRow label="Status" value={humanize(String(order.phase ?? order.status ?? 'Recorded'))} theme={theme} />
    {order.side ? <UserValueRow label="Side" value={humanize(order.side)} theme={theme} /> : null}
    {order.size !== undefined ? <UserValueRow label="Size" value={String(order.size)} theme={theme} /> : null}
    {order.price !== undefined ? <UserValueRow label="Price" value={String(order.price)} theme={theme} /> : null}
    {hash || order.orderId !== undefined ? <UserDisclosure label="Order details" value={expanded ? 'Hide' : 'Show'} expanded={expanded}
      onPress={() => setExpanded(value => !value)} theme={theme}>
      {order.orderId !== undefined ? <UserValueRow label="Order ID" value={String(order.orderId)} theme={theme} /> : null}
      {hash ? <Text selectable style={[styles.hash, {color: theme.ink, fontFamily: userFonts.mono}]}>{hash}</Text> : null}
    </UserDisclosure> : null}
  </UserCard>;
}

function SummaryRow({summary, theme, onOpen}: {summary: MarketTradeSummary; theme: ReturnType<typeof userThemeTokens>; onOpen: () => void}) {
  const pnl = validSignedUnits(summary.netRealizedPnlUnits) && summary.feesKnown === true
    ? `${formatMonadUnits(summary.netRealizedPnlUnits, 6)} AUSD` : 'Not available';
  return <View>
    <UserText theme={theme} kind="title">{summary.symbol} · {humanize(summary.direction)}</UserText>
    <UserValueRow label="Position status" value={humanize(summary.status)} theme={theme} />
    <UserValueRow label="Size" value={summary.sizeUnits} theme={theme} />
    <UserValueRow label="Reported net realized P&amp;L" value={pnl} theme={theme} />
    {summary.entryAt ? <UserValueRow label="Opened" value={formatMonadTimestamp(summary.entryAt)} theme={theme} /> : null}
    {summary.exitAt ? <UserValueRow label="Closed" value={formatMonadTimestamp(summary.exitAt)} theme={theme} /> : null}
    <UserButton label={`View ${summary.symbol} market summary`} onPress={onOpen} theme={theme} secondary />
  </View>;
}

function validatePage(page: PerplRunHistoryPage, runId: string, owner: string) {
  if (!page?.run || page.run.runId !== runId) throw new Error('Selected run mismatch.');
  validatePerplRunOwner(page.run, owner);
}
function selectSummaries(rows: MarketTradeSummary[], runId: string) {
  return rows.filter(row => row && row.runId === runId && typeof row.venueId === 'string'
    && row.venueId.startsWith('perpl-') && row.source === 'autonomous');
}
function appendUnique<T>(previous: T[], next: T[], key: (item: T) => string | null) {
  const seen = new Set(previous.map(key).filter((value): value is string => Boolean(value)));
  const appended: T[] = [];
  for (const item of next) {
    const itemKey = key(item);
    if (itemKey && seen.has(itemKey)) continue;
    if (itemKey) seen.add(itemKey);
    appended.push(item);
  }
  return [...previous, ...appended];
}
function eventKey(event: PerplEvent) { return String(event.id ?? event.eventId ?? (event.timestamp ? `${event.kind ?? event.type}:${event.timestamp}` : '')) || null; }
function orderKey(order: PerplOrder) { return String(order.orderId ?? (order.txHash ? `tx:${order.txHash}` : '')) || null; }
function observationKey(record: Record<string, unknown>) { return String(record.id ?? record.observedAt ?? '') || null; }
function validUnits(value: unknown): value is string { return typeof value === 'string' && /^\d+$/.test(value); }
function validSignedUnits(value: unknown): value is string { return typeof value === 'string' && /^-?\d+$/.test(value); }
function amount(value: unknown, decimals: number) { return validUnits(value) ? `${formatMonadUnits(value, decimals)} AUSD` : 'Not available'; }
function readableObservation(record: Record<string, unknown>) {
  const market = typeof record.symbol === 'string' ? record.symbol : typeof record.marketId === 'string' || typeof record.marketId === 'number' ? `Market ${record.marketId}` : 'Market update';
  const observed = record.observedAt ? ` · ${formatMonadTimestamp(String(record.observedAt))}` : '';
  return `${market}${observed}`;
}
function eventTitle(kind: string) {
  const key = kind.toLowerCase();
  if (key.includes('enrollment_prepared')) return 'Setup prepared';
  if (key.includes('funding_signed')) return 'Funding approved';
  if (key.includes('direct_run_activated') || key.includes('run_activated')) return 'Perpl run active';
  if (key.includes('stop_requested') || key.includes('stop_signed')) return 'Stop request sent';
  if (key.includes('recovery') && (key.includes('finalized') || key.includes('complete'))) return 'Collateral returned';
  if (key.includes('recovery')) return 'Recovery update';
  if (key.includes('stop')) return 'Stop request update';
  if (key.includes('settlement')) return 'Settlement update';
  if (key.includes('fund')) return 'Funding update';
  if (key.includes('order') || key.includes('fill')) return 'Order update';
  if (key.includes('position')) return 'Position update';
  if (key.includes('cycle')) return 'Strategy cycle update';
  return 'Perpl run update';
}
function isStrategyTick(event: PerplEvent) {
  const kind = String(event.kind ?? event.type ?? '').toLowerCase();
  return kind.includes('optimizer') || kind.includes('scanner');
}
function summarizeStrategyTicks(events: PerplEvent[]) {
  const counts = new Map<string, number>();
  for (const event of events) {
    const status = String(event.status ?? event.phase ?? event.kind ?? 'recorded');
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return [...counts].map(([status, count]) => ({status, count}));
}
function humanize(value: string) { return value.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }

const styles = StyleSheet.create({
  eventRow: {gap: 5, paddingTop: 7, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth},
  eventTitle: {fontSize: 17, lineHeight: 23, fontWeight: '800'},
  eventMeta: {fontSize: 12, lineHeight: 17, fontWeight: '600'},
  hash: {fontSize: 12, lineHeight: 18},
});
