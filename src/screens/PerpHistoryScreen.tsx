import React, {useCallback, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, LoadingBlock, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {perpAutonomyApi} from '../services/perpAutonomyApi';
import {formatMonadTimestamp, formatMonadUnits, shortenAddress} from '../services/monadFormatting';
import {useApp} from '../state/AppContext';
import type {PerpEvent, PerpRun} from '../types/perpAutonomy';
import {screenStyles as s} from '../theme/screenStyles';

export function PerpHistoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const runId = route.params?.runId as string | undefined;
  const {ownerAddress} = useApp();
  const [run, setRun] = useState<PerpRun | null>(null);
  const [events, setEvents] = useState<PerpEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const refresh = useCallback(async () => {
    if (!runId) { setError('No Perp run was selected.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const page = await perpAutonomyApi.runHistory(runId, 50);
      if (!ownerAddress || page.run.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()
          || page.run.chainId !== 10143) throw new Error('Run history does not match this Mera owner on Monad Testnet.');
      setRun(page.run); setEvents(page.events); setNextCursor(page.nextCursor); setHasMore(page.hasMore);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Perp run history could not be loaded.'); }
    finally { setLoading(false); }
  }, [runId, ownerAddress]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function loadMore() {
    if (!runId || !nextCursor || !hasMore || loadingMore) return;
    setLoadingMore(true); setError('');
    try {
      const page = await perpAutonomyApi.runHistory(runId, 50, nextCursor);
      setEvents(previous => [...previous, ...page.events]); setNextCursor(page.nextCursor); setHasMore(page.hasMore);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'More run history could not be loaded.'); }
    finally { setLoadingMore(false); }
  }

  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Perp · complete run history" title="Every decision and action" copy="Review decisions, holds, rejected actions, order states, receipts, position changes, funding, settlement, and returned funds." />
    {error ? <Notice live tone="rose" title="Run history unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {loading && !run ? <LoadingBlock label="Loading Perp run history" lines={3} /> : null}
    {run ? <Card>
      <StatusBadge label={humanize(run.status)} />
      <DataRow label="Run ID" value={run.runId} /><DataRow label="Mera owner" value={shortenAddress(run.ownerAddress)} />
      <DataRow label="Vault" value={run.vaultAddress} /><DataRow label="Network" value="Monad Testnet · 10143" />
      <DataRow label="Starting USDC" value={`${formatMonadUnits(run.startingUsdcUnits, 6)} USDC`} />
      <DataRow label="Realized PnL" value={`${signedUsdc(run.realizedPnlUsdcUnits)} USDC`} />
      {run.returnedUsdcUnits !== null && run.returnedUsdcUnits !== undefined &&
        <DataRow label="Returned to Mera" value={`${formatMonadUnits(run.returnedUsdcUnits, 6)} USDC`} />}
      <DataRow label="Operator-paid vault gas" value={`${formatMonadUnits(run.operatorGasMonWei, 18)} MON`} />
    </Card> : null}
    {events.map((event, index) => <EventCard key={event.id ?? event.eventId ?? `${event.timestamp}:${index}`} event={event} />)}
    {run && !events.length && !loading ? <Card><Text style={s.body}>No run events have been recorded yet.</Text></Card> : null}
    {hasMore ? <Button label="Load more run events" variant="secondary" onPress={() => { void loadMore(); }} loading={loadingMore} /> : null}
    <Button label="Open Activity" variant="secondary" onPress={() => navigation.navigate('Main', {screen: 'Activity'})} />
  </Screen>;
}

function EventCard({event}: {event: PerpEvent}) {
  const hash = event.transactionHash ?? event.txHash;
  const block = event.finalizedBlockNumber ?? event.blockNumber;
  return <Card tint="#FFF8E9">
    <DataRow label={humanize(event.type)} value={humanize(event.status)} />
    <Text style={s.body}>{event.summary}</Text>
    <DataRow label="Recorded" value={formatMonadTimestamp(event.timestampIso ?? event.timestamp)} />
    {event.orderId ? <DataRow label="Order ID" value={event.orderId} /> : null}
    {event.realizedPnlUsdcUnits ? <DataRow label="Realized PnL" value={`${signedUsdc(event.realizedPnlUsdcUnits)} USDC`} /> : null}
    {event.amountUnits ? <DataRow label="Amount" value={`${formatMonadUnits(event.amountUnits, 6)} USDC`} /> : null}
    {block ? <DataRow label="Finalized block" value={String(block)} /> : null}
    {hash ? <Text selectable style={s.meta}>Transaction · {hash}</Text> : null}
    {event.details || event.payload ? <EventDetails details={event.details ?? event.payload!} /> : null}
  </Card>;
}

function EventDetails({details}: {details: Record<string, unknown>}) {
  const rows = Object.entries(details).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object');
  return rows.length ? <Card tint="#F4F0E8"><Text style={s.strong}>Recorded details</Text>{rows.map(([label, value]) =>
    <DataRow key={label} label={humanize(label)} value={String(value)} />)}</Card> : null;
}

function signedUsdc(units: string) { try { const value = BigInt(units); return `${value > 0n ? '+' : value < 0n ? '−' : ''}${formatMonadUnits((value < 0n ? -value : value).toString(), 6)}`; } catch { return 'Unavailable'; } }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
