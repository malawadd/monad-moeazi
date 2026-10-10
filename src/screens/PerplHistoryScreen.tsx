import React, {useCallback, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, LoadingBlock, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {perplApi} from '../services/perplApi';
import {formatMonadTimestamp, formatMonadUnits, shortenAddress} from '../services/monadFormatting';
import {validatePerplRunOwner} from '../services/perplValidation';
import {useApp} from '../state/AppContext';
import type {PerplEvent, PerplOrder, PerplRun, PerplRunHistoryPage} from '../types/perpl';
import {screenStyles as s} from '../theme/screenStyles';
import {PerplOptimizerCard} from '../components/PerplOptimizerCard';

export function PerplHistoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const runId = route.params?.runId as string | undefined;
  const {ownerAddress} = useApp();
  const [page, setPage] = useState<PerplRunHistoryPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const refresh = useCallback(async () => {
    if (!runId) { setError('No Perpl run was selected.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const next = await perplApi.runHistory(runId, 50);
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      validatePerplRunOwner(next.run, ownerAddress);
      setPage(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Perpl run history could not be loaded.'); }
    finally { setLoading(false); }
  }, [runId, ownerAddress]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function loadMore() {
    if (!page?.hasMore || !page.nextCursor || !runId || loadingMore) return;
    setLoadingMore(true); setError('');
    try {
      const next = await perplApi.runHistory(runId, 50, page.nextCursor);
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      validatePerplRunOwner(next.run, ownerAddress);
      setPage(previous => previous ? {...next, events: [...previous.events, ...next.events], orders: [...previous.orders, ...next.orders], observations: [...previous.observations, ...next.observations], cycles: next.cycles ?? previous.cycles, journal: next.journal ?? previous.journal} : next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'More Perpl events could not be loaded.'); }
    finally { setLoadingMore(false); }
  }

  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker="Perpl · complete run history" title="Every venue update" copy="Review enrollment, account setup, accepted and submitted orders, fills, position changes, fees, funding, settlement, and stop activity." />
    {error ? <Notice live tone="rose" title="Perpl history unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {loading && !page ? <LoadingBlock label="Loading Perpl run history" lines={3} /> : null}
    {page ? <>
      <RunSummary run={page.run} />
      <PerplOptimizerCard run={{...page.run, cycles: page.cycles, journal: page.journal}} />
      {page.events.length ? <Card><Text style={s.strong}>Perpl cycle events</Text>{page.events.map((event, index) => <EventCard key={String(event.id ?? event.eventId ?? `${event.timestamp}:${index}`)} event={event} />)}</Card>
        : <Card><Text style={s.body}>No Perpl events have been recorded for this run yet.</Text></Card>}
      {page.orders.length ? <Card><Text style={s.strong}>Order records</Text>{page.orders.map((order, index) => <OrderCard key={String(order.orderId ?? `${order.marketId}:${index}`)} order={order} />)}</Card> : null}
      {page.observations.length ? <Card><Text style={s.strong}>Market and account observations</Text>{page.observations.map((row, index) => <RecordCard key={String(row.id ?? row.observedAt ?? index)} record={row} />)}</Card> : null}
      {page.hasMore ? <Button label="Load more run history" variant="secondary" onPress={() => { void loadMore(); }} loading={loadingMore} /> : null}
    </> : null}
    <Button label="Perpl status" variant="secondary" onPress={() => navigation.navigate('PerplStatus')} />
    <Button label="Open Activity" variant="secondary" onPress={() => navigation.navigate('Main', {screen: 'Activity'})} />
  </Screen>;
}

function RunSummary({run}: {run: PerplRun}) {
  return <Card>
    <StatusBadge label={humanize(run.status)} />
    <DataRow label="Run ID" value={run.runId} /><DataRow label="Mera owner" value={shortenAddress(run.ownerAddress)} />
    <DataRow label="Perpl vault" value={run.vaultAddress} /><DataRow label="Network" value={`Monad Testnet · ${run.chainId}`} />
    {run.delegatedAccountAddress ? <DataRow label="Perpl account" value={run.delegatedAccountAddress} /> : null}
    {run.accountId !== undefined ? <DataRow label="Account ID" value={String(run.accountId)} /> : null}
    {run.startingAmountUnits ? <DataRow label="Starting AUSD" value={`${formatMonadUnits(run.startingAmountUnits, run.collateral.decimals)} AUSD`} /> : null}
    {run.availableUnits ? <DataRow label="Available AUSD" value={`${formatMonadUnits(run.availableUnits, run.collateral.decimals)} AUSD`} /> : null}
    {run.equityUnits ? <DataRow label="Equity" value={`${formatMonadUnits(run.equityUnits, run.collateral.decimals)} AUSD`} /> : null}
    {run.realizedPnlUnits !== undefined ? <DataRow label="Realized PnL" value={`${signedAUSD(run.realizedPnlUnits, run.collateral.decimals)} AUSD`} /> : null}
    {run.returnedUnits !== null && run.returnedUnits !== undefined ? <DataRow label="Returned to Mera wallet" value={`${formatMonadUnits(run.returnedUnits, run.collateral.decimals)} AUSD`} /> : null}
    {typeof run.settlement?.ownerBalanceUnits === 'string' ? <DataRow label="Mera wallet AUSD after settlement" value={`${formatMonadUnits(run.settlement.ownerBalanceUnits, run.collateral.decimals)} AUSD`} /> : null}
    {run.unrealizedPnlUnits !== undefined ? <DataRow label="Unrealized PnL" value={`${signedAUSD(run.unrealizedPnlUnits, run.collateral.decimals)} AUSD`} /> : null}
    {run.feesUnits ? <DataRow label="Fees" value={`${formatMonadUnits(run.feesUnits, run.collateral.decimals)} AUSD`} /> : null}
    {run.fundingUnits ? <DataRow label="Funding" value={`${formatMonadUnits(run.fundingUnits, run.collateral.decimals)} AUSD`} /> : null}
    {run.settlement ? <Text style={s.body}>Settlement record is included below with the full run history.</Text> : null}
  </Card>;
}

function EventCard({event}: {event: PerplEvent}) {
  const timestamp = event.occurredAt ?? event.timestamp;
  const hash = event.transactionHash ?? event.txHash;
  return <Card tint="#FFF8E9">
    <DataRow label={humanize(String(event.kind ?? event.type ?? 'Event'))} value={humanize(String(event.phase ?? event.status ?? 'Recorded'))} />
    {event.summary || event.title ? <Text style={s.body}>{String(event.summary ?? event.title)}</Text> : null}
    {timestamp ? <DataRow label="Recorded" value={formatMonadTimestamp(timestamp)} /> : null}
    {event.blockNumber ? <DataRow label="Block" value={String(event.blockNumber)} /> : null}
    {event.amountUnits ? <DataRow label="Amount" value={`${formatMonadUnits(event.amountUnits, 6)} AUSD`} /> : null}
    {hash ? <Text selectable style={s.meta}>Transaction · {String(hash)}</Text> : null}
    {event.details ? <RecordRows record={event.details} /> : null}
  </Card>;
}

function OrderCard({order}: {order: PerplOrder}) {
  const action = parseOrderJson(order.actionJson); const response = parseOrderJson(order.rawResponseJson);
  return <Card tint="#EEF7FF">
    <DataRow label="Order ID" value={String(order.orderId ?? 'Not returned')} />
    <DataRow label="Phase" value={humanize(String(order.phase ?? order.status ?? 'Unknown'))} />
    {(order.marketId ?? action.marketId) !== undefined ? <DataRow label="Market ID" value={String(order.marketId ?? action.marketId)} /> : null}
    {order.symbol ? <DataRow label="Market" value={order.symbol} /> : null}
    {order.side ?? action.side ? <DataRow label="Side" value={humanize(String(order.side ?? action.side))} /> : null}
    {(order.size ?? action.size) !== undefined ? <DataRow label="Size" value={String(order.size ?? action.size)} /> : null}
    {order.price !== undefined ? <DataRow label="Price" value={String(order.price)} /> : null}
    {order.txHash ? <Text selectable style={s.meta}>Transaction · {String(order.txHash)}</Text> : null}
    {response.feeUnits !== undefined ? <DataRow label="Perpl fees" value={`${formatMonadUnits(String(response.feeUnits), 6)} AUSD`} /> : null}
    {response.operatorGasWei !== undefined ? <DataRow label="Operator gas" value={`${formatMonadUnits(String(response.operatorGasWei), 18)} MON`} /> : null}
  </Card>;
}
function parseOrderJson(value: unknown): Record<string, unknown> { try { const parsed = JSON.parse(String(value ?? '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }

function RecordCard({record}: {record: Record<string, unknown>}) {
  const rows = Object.entries(record).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object');
  return <Card tint="#F4F0E8">{rows.map(([key, value]) => <DataRow key={key} label={humanize(key)} value={String(value)} />)}</Card>;
}
function RecordRows({record}: {record: Record<string, unknown>}) { return <RecordCard record={record} />; }
function signedAUSD(units: string, decimals: number) { try { const value = BigInt(units); return `${value > 0n ? '+' : value < 0n ? '−' : ''}${formatMonadUnits((value < 0n ? -value : value).toString(), decimals)}`; } catch { return 'Unavailable'; } }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
