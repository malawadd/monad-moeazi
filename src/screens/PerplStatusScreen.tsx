import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Text} from 'react-native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {PerplStopReview, PerplRun, PerplRunsPage} from '../types/perpl';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {keccak256, type Hex} from 'viem';
import {Button, Card, DataRow, LoadingBlock, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {perplApi, createPerplIdempotencyKey} from '../services/perplApi';
import {formatMonadTimestamp, formatMonadUnits, shortenAddress} from '../services/monadFormatting';
import {signAndSubmitWithMera} from '../services/meraSubmission';
import {validatePerplRawTransaction, validatePerplRunOwner, validatePerplStop} from '../services/perplValidation';
import {PerplRecoveryPanel} from './PerplRecoveryPanel';
import {PerplOptimizerCard} from '../components/PerplOptimizerCard';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {screenStyles as s} from '../theme/screenStyles';
import {usePreparedReviewGuard} from '../navigation/usePreparedReviewGuard';
import {loadPendingOperationReferences} from '../services/pendingOperationJournal';
import {useUserPerplStatus} from './user-perpl/useUserPerplStatus';
import {UserPerplStatusView} from './user-perpl/UserPerplStatusView';
import {userThemeTokens} from '../theme/userThemes';

const TERMINAL = new Set(['stopped', 'settled', 'failed', 'expired', 'inactive', 'complete', 'completed']);

export function PerplStatusScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {ownerAddress} = useApp();
  const {presentationMode, effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const selectedRunId = typeof route.params?.runId === 'string' ? route.params.runId : undefined;
  const userStatus = useUserPerplStatus(ownerAddress, selectedRunId);
  const [current, setCurrent] = useState<PerplRun | null>(null);
  const [history, setHistory] = useState<PerplRunsPage>({runs: [], hasMore: false, nextCursor: null});
  const [stopReview, setStopReview] = useState<PerplStopReview | null>(null);
  const [stopResult, setStopResult] = useState<{status: string; phase: string} | null>(null);
  const [stopUncertain, setStopUncertain] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentStatusFresh, setCurrentStatusFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recoveryReviewOpen, setRecoveryReviewOpen] = useState(false);
  const ownerKey = ownerAddress?.toLowerCase() ?? '';
  const hasOwner = Boolean(ownerAddress);
  const refreshUserJournal = userStatus.refreshJournal;
  const refreshSelectedRun = userStatus.refreshSelectedRun;
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;
  const currentRef = useRef(current);
  currentRef.current = current;
  const requestGeneration = useRef(0);
  const requestSequence = useRef(0);
  const inFlight = useRef<number | null>(null);
  const writeFlight = useRef(false);
  usePreparedReviewGuard(Boolean(stopReview));

  useEffect(() => {
    requestGeneration.current += 1;
    inFlight.current = null;
    writeFlight.current = false;
    setCurrent(null); setHistory({runs: [], hasMore: false, nextCursor: null});
    setCurrentStatusFresh(false);
    setStopReview(null); setStopResult(null); setStopUncertain(false); setRecoveryReviewOpen(false);
    setError(''); setLoading(hasOwner); setBusy(false);
  }, [ownerKey, hasOwner]);

  const refresh = useCallback(async () => {
    const requestOwner = ownerAddress;
    const requestKey = requestOwner?.toLowerCase() ?? '';
    if (!requestOwner) { setCurrent(null); setHistory({runs: [], hasMore: false, nextCursor: null}); setCurrentStatusFresh(false); setLoading(false); return; }
    if (inFlight.current !== null) return;
    const generation = requestGeneration.current;
    const sequence = ++requestSequence.current;
    inFlight.current = sequence;
    const isCurrentRequest = () => generation === requestGeneration.current && ownerRef.current === requestKey;
    setError('');
    try {
      const [currentResponse, historyPage] = await Promise.all([perplApi.current(), perplApi.history()]);
      if (!isCurrentRequest()) return;
      const active = currentResponse.current?.venueId === 'perpl-testnet-v1' || currentResponse.current?.venueId === 'perpl-direct-testnet-v1' ? currentResponse.current : null;
      if (active) validatePerplRunOwner(active, requestOwner);
      const runs = historyPage.runs.filter(run => run.venueId === 'perpl-testnet-v1' || run.venueId === 'perpl-direct-testnet-v1');
      runs.forEach(run => validatePerplRunOwner(run, requestOwner));
      if (presentationMode === 'user') await refreshUserJournal();
      if (!isCurrentRequest()) return;
      setCurrent(active); setHistory({...historyPage, runs}); setCurrentStatusFresh(true);
    } catch (reason) { if (isCurrentRequest()) { setCurrentStatusFresh(false); setError(reason instanceof Error ? reason.message : 'Perpl status could not be loaded.'); } }
    finally {
      if (presentationMode === 'user' && selectedRunId && isCurrentRequest()) await refreshSelectedRun();
      if (inFlight.current === sequence) inFlight.current = null;
      if (isCurrentRequest()) setLoading(false);
    }
  }, [ownerAddress, presentationMode, refreshUserJournal, refreshSelectedRun, selectedRunId]);

  useFocusEffect(useCallback(() => {
    void refresh(); const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [refresh]));

  async function loadMore() {
    if (!history.hasMore || !history.nextCursor || busy) return;
    const requestOwner = ownerAddress;
    const requestKey = requestOwner?.toLowerCase() ?? '';
    const generation = requestGeneration.current;
    const cursor = history.nextCursor;
    setBusy(true); setError('');
    try {
      const page = await perplApi.history(20, cursor);
      if (ownerRef.current !== requestKey || generation !== requestGeneration.current) return;
      const runs = page.runs.filter(run => run.venueId === 'perpl-testnet-v1' || run.venueId === 'perpl-direct-testnet-v1');
      runs.forEach(run => validatePerplRunOwner(run, requestOwner ?? ''));
      setHistory({runs: [...history.runs, ...runs], hasMore: page.hasMore, nextCursor: page.nextCursor});
    } catch (reason) { if (ownerRef.current === requestKey && generation === requestGeneration.current) setError(reason instanceof Error ? reason.message : 'More Perpl history could not be loaded.'); }
    finally { if (ownerRef.current === requestKey && generation === requestGeneration.current) setBusy(false); }
  }

  async function prepareStop() {
    const target = currentRef.current;
    const requestOwner = ownerAddress;
    const requestKey = requestOwner?.toLowerCase() ?? '';
    const generation = requestGeneration.current;
    if (!target || !requestOwner || writeFlight.current) return;
    writeFlight.current = true;
    setBusy(true); setError(''); setStopResult(null); setStopUncertain(false);
    try {
      const saved = await loadPendingOperationReferences(requestOwner);
      if (ownerRef.current !== requestKey || generation !== requestGeneration.current) return;
      if (hasUnresolvedRunAction(saved, target.runId)) {
        if (presentationMode === 'user') await userStatus.refreshJournal();
        throw new Error('A saved signed action for this run is still being checked. Refresh its status before preparing another action.');
      }
      const review = await perplApi.prepareStop({runId: target.runId, idempotencyKey: createPerplIdempotencyKey()});
      if (ownerRef.current !== requestKey || generation !== requestGeneration.current || currentRef.current?.runId !== target.runId) return;
      validatePerplStop(review, requestOwner, target.vaultAddress); setStopReview(review);
    } catch (reason) { if (ownerRef.current === requestKey && generation === requestGeneration.current) setError(reason instanceof Error ? reason.message : 'A fresh Perpl stop review could not be prepared.'); }
    finally { if (generation === requestGeneration.current) { writeFlight.current = false; if (ownerRef.current === requestKey) setBusy(false); } }
  }

  async function signStop() {
    const selectedReview = stopReview;
    const target = currentRef.current;
    const requestOwner = ownerAddress;
    const requestKey = requestOwner?.toLowerCase() ?? '';
    const generation = requestGeneration.current;
    if (!selectedReview || !target || !requestOwner || writeFlight.current) return;
    writeFlight.current = true;
    setBusy(true); setError('');
    let signatureSent = false;
    try {
      const saved = await loadPendingOperationReferences(requestOwner);
      if (ownerRef.current !== requestKey || generation !== requestGeneration.current) return;
      if (hasUnresolvedRunAction(saved, selectedReview.runId)) {
        if (presentationMode === 'user') await userStatus.refreshJournal();
        throw new Error('A saved signed action for this run is still being checked. Refresh its status before signing another action.');
      }
      if (currentRef.current?.runId !== target.runId || selectedReview.runId !== target.runId) {
        throw new Error('The selected Perpl run changed. Refresh its status and prepare a new review.');
      }
      validatePerplStop(selectedReview, requestOwner, target.vaultAddress);
      const result = await signAndSubmitWithMera({ownerAddress: requestOwner,
        reference: {kind: 'perpl-stop', id: selectedReview.runId, action: 'stop'},
        sign: session => session.signEip1559Transaction(10143, selectedReview.stopTransaction),
        validateSigned: validatePerplRawTransaction,
        referenceTxHash: signedTransaction => keccak256(signedTransaction as Hex),
        onSubmissionStarting: () => {
          if (ownerRef.current !== requestKey || generation !== requestGeneration.current || currentRef.current?.runId !== target.runId) {
            throw new Error('The selected run or Mera owner changed. The signed stop was not submitted.');
          }
          signatureSent = true; setStopReview(null); setStopUncertain(true);
        },
        submit: signedTransaction => perplApi.stop({runId: selectedReview.runId, signedTransaction}),
      });
      if (ownerRef.current !== requestKey || generation !== requestGeneration.current) return;
      if (result.runId !== selectedReview.runId || result.venueId !== selectedReview.venueId) throw new Error('The service returned a different Perpl stop request.');
      setStopResult({status: result.status, phase: result.phase}); setStopUncertain(false); void refresh();
    } catch (reason) {
      if (ownerRef.current !== requestKey || generation !== requestGeneration.current) return;
      if (signatureSent) setStopUncertain(true);
      setError(signatureSent
        ? `The signed stop may still be processing. Check this run and Activity before retrying. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The Perpl stop could not be signed.');
    } finally { if (generation === requestGeneration.current) { writeFlight.current = false; if (ownerRef.current === requestKey) setBusy(false); } }
  }

  const currentStatus = current?.status.toLowerCase() ?? '';
  const unsignedPrepared = currentStatus === 'prepared';
  const currentPendingAction = current && userStatus.pendingActions.some(item => item.id === current.runId
    && ['perpl-stop', 'perpl-recovery'].includes(item.kind));
  const canStop = Boolean(currentStatusFresh && current && !unsignedPrepared && !TERMINAL.has(currentStatus) && currentStatus !== 'stopping'
    && !stopUncertain && !currentPendingAction);
  const selectedRun = userStatus.selectedRun;
  const recoveryTarget = selectedRun ?? current;
  const recoveryTargetFresh = Boolean(selectedRun ? userStatus.selectedRunFresh : currentStatusFresh);
  const recoveryContent = recoveryTarget ? <PerplRecoveryPanel run={recoveryTarget} ownerAddress={ownerAddress}
    userActionsFresh={presentationMode !== 'user' || recoveryTargetFresh}
    disabled={busy || Boolean(stopReview) || stopUncertain || !userStatus.journalAvailable
      || (presentationMode === 'user' && !recoveryTargetFresh)
      || userStatus.pendingActions.some(item => item.id === recoveryTarget.runId && item.kind === 'perpl-recovery')}
    onRefresh={() => { void refresh(); }} onReviewOpenChange={setRecoveryReviewOpen} /> : null;
  if (presentationMode === 'user') return <UserPerplStatusView theme={theme} current={current} history={history.runs}
    currentKnown={currentStatusFresh}
    selectedRun={selectedRun} selectedRunLoading={userStatus.selectedRunLoading} selectedRunError={userStatus.selectedRunError}
    historyHasMore={history.hasMore} loading={loading} error={error} journalAvailable={userStatus.journalAvailable}
    busy={busy} canStop={canStop} stopReview={stopReview} stopResult={stopResult} stopUncertain={stopUncertain}
    recoveryReviewOpen={recoveryReviewOpen} pendingActions={userStatus.pendingActions} recoveryContent={recoveryContent}
    onBack={() => navigation.goBack()} onRefresh={() => { void refresh(); }} onPrepareStop={() => { void prepareStop(); }}
    onSignStop={() => { void signStop(); }} onCancelStop={() => setStopReview(null)}
    onSelectRun={runId => navigation.setParams({runId})} onClearSelection={() => {
      userStatus.clearSelectedRun(); navigation.setParams({runId: undefined});
    }} onLoadMore={() => { void loadMore(); }} onOpenPending={() => navigation.navigate('PendingOperations')}
    onOpenSetup={() => navigation.navigate('PerplSetup')} onOpenStrategies={() => navigation.navigate('Main', {screen: 'Strategies'})}
    onOpenActivity={() => navigation.navigate('Main', {screen: 'Activity'})}
    onOpenHistory={runId => navigation.navigate('PerplHistory', {runId})} />;
  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker="Perpl · Monad Testnet" title="Positions and activity" copy="Status refreshes every 15 seconds. Direct runs show finalized onchain orders and account state; API runs remain labeled separately." />
    {error ? <Notice live tone="rose" title="Perpl status unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {loading && !current && !history.runs.length ? <LoadingBlock label="Loading Perpl status" lines={3} /> : null}
    {current ? <>
      <RunCard run={current} />
      {unsignedPrepared ? <Card tint="#E9F5FF">
        <Text style={s.strong}>Unsigned setup review</Text>
        <Text style={s.body}>This run has not been signed or funded, so there is nothing to stop. Return to setup to continue signing or prepare a fresh review.</Text>
        <Button label="Return to Perpl setup" onPress={() => navigation.navigate('PerplSetup')} />
      </Card> : <>
      <PerplOptimizerCard run={current} />
      {current.position ? <PositionCard run={current} /> : <Card><Text style={s.strong}>No open position</Text><Text style={s.body}>Positions and orders appear here after the selected Perpl transport confirms them.</Text></Card>}
      {current.orders?.length ? <Card><Text style={s.strong}>Orders</Text>{current.orders.map((order, index) => <OrderCard key={String(order.orderId ?? `${order.marketId}:${index}`)} order={order} run={current} />)}</Card> : null}
      {current.markets?.length ? <MarketSnapshots markets={current.markets} /> : null}
      {current.events?.length ? <Card><Text style={s.strong}>Latest Perpl events</Text>{current.events.slice(-8).reverse().map((event, index) => <EventCard key={String(event.id ?? event.eventId ?? `${event.timestamp}:${index}`)} event={event} />)}</Card> : null}
      {current.settlement ? <RecordCard title="Settlement" record={current.settlement} /> : null}
      {stopResult ? <Card tint="#DDF4E7"><Text style={s.strong}>Stop request recorded</Text><DataRow label="Status" value={humanize(stopResult.status)} /><DataRow label="Phase" value={humanize(stopResult.phase)} /><Text style={s.body}>The service will reconcile this stop with the Perpl account and update the run history.</Text></Card> : null}
      {stopUncertain ? <Card tint="#FFF1E5"><Text style={s.strong}>Stop outcome is being reconciled</Text><Text style={s.body}>Refresh this screen and Activity before preparing another stop.</Text><Button label="Refresh Perpl status" variant="secondary" onPress={() => { void refresh(); }} /></Card> : null}
      {stopReview && !unsignedPrepared ? <Card tint="#FFF1E5">
        <Text style={s.strong}>Review owner-signed stop transaction</Text>
        <DataRow label="Mera owner" value={ownerAddress ?? 'Unavailable'} /><DataRow label="Perpl vault" value={stopReview.stopTransaction.to} />
        <DataRow label="Network" value="Monad Testnet · EIP-1559 · 10143" />
        <DataRow label="Vault call" value="requestStop() · no MON value sent" />
        <DataRow label="Maximum network fee" value={`${formatMonadUnits(maximumCost(stopReview.stopTransaction.gasLimit, stopReview.stopTransaction.maxFeePerGas), 18)} MON`} />
        <DataRow label="Review expires" value={formatMonadTimestamp(stopReview.preparedExpiresAt)} />
        <Text style={s.body}>This exact requestStop() call is addressed to the displayed Perpl vault. Your Mera wallet may pay up to the shown network fee. Mera signs once; the short-lived signing session closes before the service receives the signed transaction.</Text>
        <Button label="Sign stop with Mera" onPress={() => { void signStop(); }} loading={busy} />
        <Button label="Cancel stop review" variant="secondary" disabled={busy} onPress={() => setStopReview(null)} />
      </Card> : canStop ? <Button label="Prepare Perpl stop review" variant="danger" onPress={() => { void prepareStop(); }} loading={busy} /> : null}
      <PerplRecoveryPanel run={current} ownerAddress={ownerAddress} disabled={stopReview !== null || stopUncertain || busy} onRefresh={() => { void refresh(); }} />
      </>}
      <Button label="Open complete run history" variant="secondary" onPress={() => navigation.navigate('PerplHistory', {runId: current.runId})} />
    </> : <Card><Text style={s.strong}>No active Perpl run</Text><Text style={s.body}>Previous enrollment and trading cycles remain available below.</Text><Button label="Review Perpl markets" onPress={() => navigation.navigate('PerplMarkets')} /></Card>}
    {history.runs.length ? <Card><Text style={s.strong}>Previous Perpl runs</Text>
      {history.runs.filter(run => run.runId !== current?.runId).map(run => <React.Fragment key={run.runId}><RunSummary run={run} navigation={navigation} /><PerplOptimizerCard run={run} compact /></React.Fragment>)}
      {history.hasMore ? <Button label="Load more runs" variant="secondary" onPress={() => { void loadMore(); }} loading={busy} /> : null}
    </Card> : null}
    <Button label="Review Perpl markets" variant="secondary" onPress={() => navigation.navigate('PerplMarkets')} />
    <Button label="Open Activity" variant="secondary" onPress={() => navigation.navigate('Main', {screen: 'Activity'})} />
    {presentationMode === 'developer' ? <Button label="Mock Spot and Perp" variant="secondary" onPress={() => navigation.navigate('AutonomyChoice')} /> : null}
  </Screen>;
}

function RunCard({run}: {run: PerplRun}) {
  return <Card>
    <StatusBadge label={humanize(run.status)} tone={run.status.toLowerCase() === 'active' ? 'mint' : 'sky'} />
    <DataRow label="Run ID" value={run.runId} /><DataRow label="Mera owner" value={shortenAddress(run.ownerAddress)} />
    <DataRow label="Vault" value={run.vaultAddress} /><DataRow label="Network" value={`Monad Testnet · ${run.chainId}`} />
    {run.delegatedAccountAddress ? <DataRow label="Perpl account" value={run.delegatedAccountAddress} /> : null}
    {run.accountId !== undefined ? <DataRow label="Perpl account ID" value={String(run.accountId)} /> : null}
    <DataRow label="Collateral" value={run.collateral.symbol} />
    {run.startingAmountUnits ? <DataRow label="Starting collateral" value={`${formatMonadUnits(run.startingAmountUnits, run.collateral.decimals)} ${run.collateral.symbol}`} /> : null}
    {run.availableUnits ? <DataRow label="Available collateral" value={`${formatMonadUnits(run.availableUnits, run.collateral.decimals)} ${run.collateral.symbol}`} /> : null}
    {run.equityUnits ? <DataRow label="Current equity" value={`${formatMonadUnits(run.equityUnits, run.collateral.decimals)} ${run.collateral.symbol}`} /> : null}
    {run.realizedPnlUnits !== undefined ? <DataRow label="Realized PnL" value={`${signedUnits(run.realizedPnlUnits, run.collateral.decimals)} ${run.collateral.symbol}`} /> : null}
    {run.unrealizedPnlUnits !== undefined ? <DataRow label="Unrealized PnL" value={`${signedUnits(run.unrealizedPnlUnits, run.collateral.decimals)} ${run.collateral.symbol}`} /> : null}
    {run.feesUnits ? <DataRow label="Fees" value={`${formatMonadUnits(run.feesUnits, run.collateral.decimals)} ${run.collateral.symbol}`} /> : null}
    {run.fundingUnits ? <DataRow label="Funding" value={`${formatMonadUnits(run.fundingUnits, run.collateral.decimals)} ${run.collateral.symbol}`} /> : null}
    {run.expiresAt ? <DataRow label="Expires" value={formatMonadTimestamp(run.expiresAt)} /> : null}
    {run.observedAt ? <DataRow label="Observed" value={formatMonadTimestamp(run.observedAt)} /> : null}
  </Card>;
}

function PositionCard({run}: {run: PerplRun}) {
  const position = run.position!;
  const market = run.markets?.find(item => item.id === position.marketId);
  return <Card tint="#E9F5FF"><Text style={s.strong}>Position · {market?.symbol ?? position.symbol ?? `Market ${position.marketId ?? '—'}`}</Text>
    {position.side ? <DataRow label="Side" value={humanize(position.side)} /> : null}
    {position.size !== undefined ? <DataRow label="Size" value={String(position.size)} /> : null}
    {position.entryPrice !== undefined ? <DataRow label="Entry price" value={String(position.entryPrice)} /> : null}
    {position.markPrice !== undefined ? <DataRow label="Mark price" value={String(position.markPrice)} /> : null}
    {position.unrealizedPnlUnits ? <DataRow label="Position PnL" value={`${signedUnits(position.unrealizedPnlUnits, run.collateral.decimals)} ${run.collateral.symbol}`} /> : null}
    {position.lockedUnits ? <DataRow label="Locked collateral" value={`${formatMonadUnits(position.lockedUnits, run.collateral.decimals)} ${run.collateral.symbol}`} /> : null}
    {position.leverage !== undefined ? <DataRow label="Leverage" value={`${position.leverage}×`} /> : null}
  </Card>;
}

function OrderCard({order, run}: {order: NonNullable<PerplRun['orders']>[number]; run: PerplRun}) {
  const action = parseOrderJson(order.actionJson); const response = parseOrderJson(order.rawResponseJson);
  const market = run.markets?.find(item => item.id === Number(order.marketId ?? action.marketId));
  return <Card tint="#FFF8E9"><DataRow label="Order ID" value={String(order.orderId ?? 'Not returned')} />
    <DataRow label="Phase" value={humanize(String(order.phase ?? order.status ?? 'Unknown'))} />
    <DataRow label="Market" value={market?.symbol ?? order.symbol ?? String(order.marketId ?? action.marketId ?? 'Not returned')} />
    {order.side ?? action.side ? <DataRow label="Side" value={humanize(String(order.side ?? action.side))} /> : null}
    {(order.size ?? action.size) !== undefined ? <DataRow label="Size" value={String(order.size ?? action.size)} /> : null}
    {order.price !== undefined ? <DataRow label="Price" value={String(order.price)} /> : null}
    {order.txHash ? <Text selectable style={s.meta}>Transaction · {String(order.txHash)}</Text> : null}
    {response.feeUnits !== undefined ? <DataRow label="Perpl fees" value={`${formatMonadUnits(String(response.feeUnits), 6)} AUSD`} /> : null}
    {response.operatorGasWei !== undefined ? <DataRow label="Operator gas" value={`${formatMonadUnits(String(response.operatorGasWei), 18)} MON`} /> : null}
  </Card>;
}
function parseOrderJson(value: unknown): Record<string, unknown> { try { const parsed = JSON.parse(String(value ?? '{}')); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }

function MarketSnapshots({markets}: {markets: NonNullable<PerplRun['markets']>}) {
  return <Card><Text style={s.strong}>Market snapshots</Text>{markets.map(market => <Card key={market.id} tint="#F4F0E8">
    <Text style={s.strong}>{market.symbol} · {market.isOpen ? 'Open' : 'Closed'}</Text>
    {market.price ? <><DataRow label="Mark" value={String(market.price.mark)} /><DataRow label="Bid / ask" value={`${market.price.bid} / ${market.price.ask}`} /><DataRow label="Block" value={String(market.price.blockNumber)} /></> : <Text style={s.body}>Price snapshot unavailable.</Text>}
  </Card>)}</Card>;
}

function EventCard({event}: {event: NonNullable<PerplRun['events']>[number]}) {
  const timestamp = event.occurredAt ?? event.timestamp;
  const hash = event.transactionHash ?? event.txHash;
  return <Card tint="#FFF8E9"><DataRow label={humanize(String(event.kind ?? event.type ?? 'Event'))} value={humanize(String(event.phase ?? event.status ?? 'Recorded'))} />
    {event.summary || event.title ? <Text style={s.body}>{String(event.summary ?? event.title)}</Text> : null}
    {timestamp ? <DataRow label="Recorded" value={formatMonadTimestamp(timestamp)} /> : null}
    {event.blockNumber ? <DataRow label="Block" value={String(event.blockNumber)} /> : null}
    {event.amountUnits ? <DataRow label="Amount" value={`${formatMonadUnits(event.amountUnits, 6)} AUSD`} /> : null}
    {hash ? <Text selectable style={s.meta}>Transaction · {String(hash)}</Text> : null}
    {event.details ? <RecordRows record={event.details} /> : null}
  </Card>;
}

function RunSummary({run, navigation}: {run: PerplRun; navigation: NativeStackNavigationProp<any>}) {
  return <Card tint="#EEF7FF"><DataRow label="Run" value={run.runId} /><DataRow label="Status" value={humanize(run.status)} />
    {run.startingAmountUnits ? <DataRow label="Starting AUSD" value={formatMonadUnits(run.startingAmountUnits, run.collateral.decimals)} /> : null}
    {run.realizedPnlUnits !== undefined ? <DataRow label="Realized PnL" value={`${signedUnits(run.realizedPnlUnits, run.collateral.decimals)} AUSD`} /> : null}
    {run.returnedUnits !== null && run.returnedUnits !== undefined ? <DataRow label="Returned to Mera wallet" value={`${formatMonadUnits(run.returnedUnits, run.collateral.decimals)} AUSD`} /> : null}
    <Button label="Open run events" variant="secondary" onPress={() => navigation.navigate('PerplHistory', {runId: run.runId})} />
  </Card>;
}

function RecordCard({title, record}: {title: string; record: Record<string, unknown>}) {
  return <Card><Text style={s.strong}>{title}</Text><RecordRows record={record} /></Card>;
}
function RecordRows({record}: {record: Record<string, unknown>}) {
  return <>{Object.entries(record).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object').slice(0, 12)
    .map(([key, value]) => <DataRow key={key} label={humanize(key)} value={String(value)} />)}</>;
}
function maximumCost(gasLimit: string, maxFeePerGas: string) { try { return (BigInt(gasLimit) * BigInt(maxFeePerGas)).toString(); } catch { return 'Unavailable'; } }
function hasUnresolvedRunAction(references: Awaited<ReturnType<typeof loadPendingOperationReferences>>, runId: string) {
  return references.some(reference => reference.id === runId && ['perpl-stop', 'perpl-recovery'].includes(reference.kind));
}
function signedUnits(units: string, decimals: number) { try { const value = BigInt(units); return `${value > 0n ? '+' : value < 0n ? '−' : ''}${formatMonadUnits((value < 0n ? -value : value).toString(), decimals)}`; } catch { return 'Unavailable'; } }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
