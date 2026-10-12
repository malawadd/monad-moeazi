import React, {useCallback, useRef, useState} from 'react';
import {Text} from 'react-native';
import type {TypedDataDefinition} from 'viem';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, LoadingBlock, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {perpAutonomyApi, createPerpIdempotencyKey} from '../services/perpAutonomyApi';
import {validatePerpStop} from '../services/perpAutonomyValidation';
import {formatMonadTimestamp, formatMonadUnits, shortenAddress} from '../services/monadFormatting';
import {signAndSubmitWithMera} from '../services/meraSubmission';
import {useApp} from '../state/AppContext';
import type {PerpEvent, PerpRun, PerpRunsPage, PerpStopReview, PerpStopResult} from '../types/perpAutonomy';
import {screenStyles as s} from '../theme/screenStyles';
import {usePreparedReviewGuard} from '../navigation/usePreparedReviewGuard';

const STOPPABLE = new Set(['active', 'uncertain']);

export function PerpStatusScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [current, setCurrent] = useState<PerpRun | null>(null);
  const [history, setHistory] = useState<PerpRunsPage>({runs: [], nextCursor: null, hasMore: false});
  const [stopReview, setStopReview] = useState<PerpStopReview | null>(null);
  const [stopResult, setStopResult] = useState<PerpStopResult | null>(null);
  const [stopUncertain, setStopUncertain] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  usePreparedReviewGuard(Boolean(stopReview));

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true; setError('');
    try {
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      const [currentResponse, historyPage] = await Promise.all([perpAutonomyApi.current(), perpAutonomyApi.history()]);
      if (currentResponse.current) assertRunOwner(currentResponse.current, ownerAddress);
      historyPage.runs.forEach(run => assertRunOwner(run, ownerAddress));
      setCurrent(currentResponse.current); setHistory(historyPage);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Perp status could not be loaded.'); }
    finally { inFlight.current = false; setLoading(false); }
  }, [ownerAddress]);

  useFocusEffect(useCallback(() => {
    void refresh(); const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [refresh]));

  async function loadMore() {
    if (!history.hasMore || !history.nextCursor || busy) return;
    setBusy(true); setError('');
    try {
      const page = await perpAutonomyApi.history(15, history.nextCursor);
      page.runs.forEach(run => assertRunOwner(run, ownerAddress ?? ''));
      setHistory({runs: [...history.runs, ...page.runs], nextCursor: page.nextCursor, hasMore: page.hasMore});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'More Perp history could not be loaded.'); }
    finally { setBusy(false); }
  }

  async function prepareStop() {
    if (!current) return;
    setBusy(true); setError(''); setStopResult(null);
    try {
      const review = await perpAutonomyApi.prepareStop({runId: current.runId, idempotencyKey: createPerpIdempotencyKey()});
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      validatePerpStop(review, ownerAddress, current.vaultAddress); setStopReview(review);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'A fresh stop review could not be prepared.'); }
    finally { setBusy(false); }
  }

  async function signStop() {
    if (!stopReview || !current || !ownerAddress) return;
    setBusy(true); setError('');
    let signatureSent = false;
    try {
      validatePerpStop(stopReview, ownerAddress, current.vaultAddress);
      const result = await signAndSubmitWithMera({ownerAddress,
        reference: {kind: 'perp-stop', id: stopReview.idempotencyKey, relatedId: stopReview.runId, action: 'stop'},
        sign: session => session.signTypedData(10143, stopReview.typedData as unknown as TypedDataDefinition),
        validateSigned: signature => { if (!/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error('Mera returned an invalid stop signature.'); },
        onSubmissionStarting: () => { signatureSent = true; setStopReview(null); },
        submit: signature => perpAutonomyApi.stop({runId: stopReview.runId, idempotencyKey: stopReview.idempotencyKey,
          nonce: String(stopReview.typedData.message.nonce), deadline: Number(stopReview.typedData.message.deadline), signature}),
      });
      setStopResult(result); setStopUncertain(result.status === 'uncertain'); void refresh();
    } catch (reason) {
      if (signatureSent) setStopUncertain(true);
      setError(signatureSent
        ? `The signed stop may still be processing. Check Activity and this run before retrying. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The stop request could not be signed.');
    } finally { setBusy(false); }
  }

  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker="Perp autonomy · Monad Testnet" title="Positions and run history" copy="Status refreshes every 15 seconds. Submitted, executed, and finalized actions are shown as separate states." />
    {error ? <Notice live tone="rose" title="Perp status unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {loading && !current && !history.runs.length ? <LoadingBlock label="Loading Perp status and history" lines={3} /> : null}
    {current ? <>
      <RunCard run={current} />
      {current.position ? <PositionCard run={current} /> : <Card><Text style={s.strong}>No open position</Text><Text style={s.body}>Any pending limit order and the latest decisions remain in run history.</Text></Card>}
      {current.pendingOrder ? <OrderCard order={current.pendingOrder} run={current} /> : null}
      {current.events.length ? <Card><Text style={s.strong}>Latest run activity</Text>{current.events.slice(-8).reverse().map((event, index) => <EventCard key={event.id ?? event.eventId ?? `${event.timestamp}:${index}`} event={event} />)}</Card> : null}
      {current.status === 'activation_pending' ? <Notice tone="orange" title="Funding is still finalizing" message="A stop can be prepared after the initial Circle funding and vault activation have finalized. Follow the funding state here and in Activity." /> : null}
      {stopResult ? <Card tint="#DDF4E7"><Text style={s.strong}>Stop request</Text><DataRow label="Transaction state" value={humanize(stopResult.status)} /><DataRow label="Operator phase" value={humanize(stopResult.phase)} /><Text style={s.body}>The exact owner-signed stop is with the operator. Its state updates as the transaction is submitted, executed, and finalized.</Text>{stopResult.transactionHash ? <Text selectable style={s.body}>Transaction: {stopResult.transactionHash}</Text> : null}</Card> : null}
      {stopUncertain || current.status === 'stopping' ? <Card tint="#FFF1E5"><Text style={s.strong}>Stop outcome is being reconciled</Text><Text style={s.body}>Review this run and Activity before taking another action. The app will not prepare a second stop while the first result is uncertain.</Text><Button label="Review Activity" variant="secondary" onPress={() => navigation.navigate('Main', {screen: 'Activity'})} /></Card> : null}
      {stopReview ? <Card tint="#FFF1E5">
        <Text style={s.strong}>Review fresh Mera stop signature</Text>
        <DataRow label="Mera owner" value={ownerAddress ?? 'Unavailable'} />
        <DataRow label="Perp vault" value={stopReview.vaultAddress} />
        <DataRow label="Chain" value="Monad Testnet · 10143" />
        <DataRow label="Stop nonce" value={String(stopReview.typedData.message.nonce)} />
        <DataRow label="Signature expires" value={formatMonadTimestamp(Number(stopReview.typedData.message.deadline))} />
        <Text style={s.body}>The operator relays this owner-authorized stop and pays MON gas. New positions stop after the onchain stop is confirmed.</Text>
        <Button label="Sign stop with Mera" onPress={() => { void signStop(); }} loading={busy} />
        <Button label="Cancel stop review" variant="secondary" disabled={busy} onPress={() => setStopReview(null)} />
      </Card> : current.status && STOPPABLE.has(current.status) && (!stopResult || stopResult.status === 'failed') && !stopUncertain ? <Button label="Stop this Perp run" variant="danger" onPress={() => { void prepareStop(); }} loading={busy} /> : null}
      <Button label="Open complete run history" variant="secondary" onPress={() => navigation.navigate('PerpHistory', {runId: current.runId})} />
    </> : <Card><Text style={s.strong}>No active Perp run</Text><Text style={s.body}>Start a new test run from the mode selector. Previous runs remain available below.</Text></Card>}
    {history.runs.length ? <Card>
      <Text style={s.strong}>Previous and prepared runs</Text>
      {history.runs.filter(run => run.runId !== current?.runId).map(run => <RunSummary key={run.runId} run={run} navigation={navigation} />)}
      {history.hasMore ? <Button label="Load more runs" variant="secondary" onPress={() => { void loadMore(); }} loading={busy} /> : null}
    </Card> : null}
    <Button label="Choose Spot or Perp" variant="secondary" onPress={() => navigation.navigate('AutonomyChoice')} />
    <Button label="Open Activity" variant="secondary" onPress={() => navigation.navigate('Main', {screen: 'Activity'})} />
  </Screen>;
}

function RunCard({run}: {run: PerpRun}) {
  return <Card>
    <StatusBadge label={humanize(run.status)} tone={run.status === 'active' ? 'mint' : run.status.includes('uncertain') ? 'orange' : 'sky'} />
    <DataRow label="Run" value={run.runId} /><DataRow label="Mera owner" value={shortenAddress(run.ownerAddress)} />
    <DataRow label="Perp vault" value={run.vaultAddress} /><DataRow label="Network" value="Monad Testnet · 10143" />
    <DataRow label="Starting collateral" value={`${formatMonadUnits(run.startingUsdcUnits, 6)} USDC`} />
    <DataRow label="Available vault USDC" value={`${formatMonadUnits(run.availableUsdcUnits, 6)} USDC`} />
    {run.equityUsdcUnits ? <DataRow label="Current equity" value={`${formatMonadUnits(run.equityUsdcUnits, 6)} USDC`} /> : null}
    <DataRow label="Realized PnL" value={`${signedUsdc(run.realizedPnlUsdcUnits)} USDC`} />
    {run.returnedUsdcUnits !== null && run.returnedUsdcUnits !== undefined &&
      <DataRow label="Returned to Mera" value={`${formatMonadUnits(run.returnedUsdcUnits, 6)} USDC`} />}
    <DataRow label="Unrealized PnL" value={`${signedUsdc(run.unrealizedPnlUsdcUnits ?? '0')} USDC`} />
    <DataRow label="Operator-paid vault gas" value={`${formatMonadUnits(run.operatorGasMonWei, 18)} MON · your gas cost is 0`} />
    {run.expiresAt ? <DataRow label="Expires" value={formatMonadTimestamp(run.expiresAt)} /> : null}
    {run.lastFinalizedBlock ? <DataRow label="Last finalized block" value={run.lastFinalizedBlock} /> : null}
    {run.fundingStatus ? <DataRow label="Funding status" value={run.fundingStatus} /> : null}
    {run.fundingTransactionHash ? <Text selectable style={s.meta}>Funding tx · {run.fundingTransactionHash}</Text> : null}
    <Text style={s.body}>Realized USDC profit or loss is separate from operator-paid MON gas. All posted margin can be lost.</Text>
  </Card>;
}

function PositionCard({run}: {run: PerpRun}) {
  const position = run.position!; const market = run.markets[position.marketIndex ?? -1];
  return <Card tint="#E9F5FF">
    <Text style={s.strong}>Open position · {market?.symbol ?? position.market ?? 'Market'}</Text>
    <DataRow label="Direction" value={position.isLong ? 'Long' : 'Short'} />
    <DataRow label="Leverage" value={`${position.leverage ?? '—'}×`} />
    <DataRow label="Isolated margin" value={`${formatMonadUnits(position.marginUsdc ?? '0', 6)} USDC`} />
    {position.sizeWad ? <DataRow label="Position size" value={`${position.sizeWad} WAD`} /> : null}
    {position.entryPriceWad ? <DataRow label="Entry price" value={`${position.entryPriceWad} WAD`} /> : null}
    {position.markPriceWad ? <DataRow label="Mark price" value={`${position.markPriceWad} WAD`} /> : null}
    <DataRow label="Position unrealized PnL" value={`${signedUsdc(position.unrealizedPnlUsdcUnits ?? run.unrealizedPnlUsdcUnits ?? '0')} USDC`} />
    {position.takeProfitWad ? <DataRow label="Take profit" value={`${position.takeProfitWad} WAD`} /> : null}
    {position.stopLossWad ? <DataRow label="Stop loss" value={`${position.stopLossWad} WAD`} /> : null}
  </Card>;
}

function OrderCard({order, run}: {order: NonNullable<PerpRun['pendingOrder']>; run: PerpRun}) {
  return <Card tint="#FFF8E9"><Text style={s.strong}>Pending order</Text>
    <DataRow label="Order ID" value={order.orderId} /><DataRow label="Status" value="Pending" />
    <DataRow label="Market" value={run.markets[order.marketIndex ?? -1]?.symbol ?? String(order.marketIndex ?? '—')} />
    <DataRow label="Direction" value={order.isLong ? 'Long' : 'Short'} />
    <DataRow label="Leverage" value={`${order.leverage ?? '—'}×`} />
    <DataRow label="Margin" value={`${formatMonadUnits(order.marginUsdc ?? '0', 6)} USDC`} />
    {order.limitPriceWad ? <DataRow label="Limit price" value={`${order.limitPriceWad} WAD`} /> : null}
    {order.goodUntil ? <DataRow label="Good until" value={formatMonadTimestamp(order.goodUntil)} /> : null}
  </Card>;
}

function RunSummary({run, navigation}: {run: PerpRun; navigation: any}) {
  return <Card tint="#EEF7FF"><DataRow label="Run status" value={humanize(run.status)} />
    <DataRow label="Starting USDC" value={`${formatMonadUnits(run.startingUsdcUnits, 6)} USDC`} />
    <DataRow label="Realized PnL" value={`${signedUsdc(run.realizedPnlUsdcUnits)} USDC`} />
    <Button label="Open run events" variant="secondary" onPress={() => navigation.navigate('PerpHistory', {runId: run.runId})} />
  </Card>;
}

function EventCard({event}: {event: PerpEvent}) {
  const txHash = event.transactionHash ?? event.txHash;
  return <Card tint="#FFF8E9"><DataRow label={humanize(event.type)} value={humanize(event.status)} />
    <Text style={s.body}>{event.summary}</Text><DataRow label="Recorded" value={formatMonadTimestamp(event.timestampIso ?? event.timestamp)} />
    {event.orderId ? <DataRow label="Order ID" value={event.orderId} /> : null}
    {event.finalizedBlockNumber ?? event.blockNumber ? <DataRow label="Finalized block" value={String(event.finalizedBlockNumber ?? event.blockNumber)} /> : null}
    {txHash ? <Text selectable style={s.meta}>Tx · {txHash}</Text> : null}
    {event.details ? Object.entries(event.details).filter(([, value]) => value === null || typeof value !== 'object').slice(0, 5).map(([label, value]) =>
      <DataRow key={label} label={humanize(label)} value={String(value)} />) : null}
  </Card>;
}

function assertRunOwner(run: PerpRun, owner: string) {
  if (run.chainId !== 10143 || run.ownerAddress.toLowerCase() !== owner.toLowerCase()
      || !/^0x[0-9a-f]{40}$/i.test(run.vaultAddress)) throw new Error('Perp data does not match this Mera owner and Monad Testnet.');
}
function signedUsdc(units?: string) { try { const value = BigInt(units ?? '0'); return `${value > 0n ? '+' : value < 0n ? '−' : ''}${formatMonadUnits((value < 0n ? -value : value).toString(), 6)}`; } catch { return 'Unavailable'; } }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
