import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Text} from 'react-native';
import type {TypedDataDefinition} from 'viem';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, Field, LoadingBlock, Notice, PageHeader, Screen} from '../components/Ui';
import {perplApi, createPerplIdempotencyKey} from '../services/perplApi';
import {MobileApiError} from '../services/apiClient';
import {monadApi} from '../services/monadApi';
import {formatMonadTimestamp, formatMonadUnits, parseMonadAmount} from '../services/monadFormatting';
import {signAndSubmitWithMera} from '../services/meraSubmission';
import {effectivePerplMarketSlippageBps, findPerplVenue, isPerplDirectOptimizerDuration,
  PERPL_DIRECT_OPTIMIZER_DEFAULT_DURATION_SECONDS, PERPL_DIRECT_OPTIMIZER_MAX_DURATION_SECONDS,
  PERPL_DIRECT_OPTIMIZER_MIN_DURATION_SECONDS, validatePreparedPerpl, validatePerplRawTransaction,
  validatePerplRunOwner, validatePerplSignature} from '../services/perplValidation';
import type {PerplPreparedEnrollment, PerplRun, PerplVenue} from '../types/perpl';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';
import {usePreparedReviewGuard} from '../navigation/usePreparedReviewGuard';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {loadPendingOperationReferences} from '../services/pendingOperationJournal';
import {reconcilePendingOperation} from '../services/pendingOperationReconcile';
import {UserPerplSetupView, PendingPerplEnrollment} from './user-perpl/UserPerplSetupView';

export function PerplSetupScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const {presentationMode, effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const ownerKey = ownerAddress?.toLowerCase() ?? '';
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;
  const activeCheckGeneration = useRef(0);
  const writeGeneration = useRef(0);
  const writeFlight = useRef(false);
  const [venue, setVenue] = useState<PerplVenue | null>(null);
  const [amount, setAmount] = useState('100');
  const [durationMinutes, setDurationMinutes] = useState('120');
  const [prepared, setPrepared] = useState<PerplPreparedEnrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [uncertainRunId, setUncertainRunId] = useState('');
  const [pendingEnrollments, setPendingEnrollments] = useState<PendingPerplEnrollment[]>([]);
  const [error, setError] = useState('');
  const [runConflict, setRunConflict] = useState(false);
  const [walletAusd, setWalletAusd] = useState('Checking Mera balance…');
  const [activeRun, setActiveRun] = useState<PerplRun | null>(null);
  const [checkingActiveRun, setCheckingActiveRun] = useState(true);
  const [activeRunError, setActiveRunError] = useState('');
  usePreparedReviewGuard(Boolean(prepared));

  useEffect(() => {
    activeCheckGeneration.current += 1;
    writeGeneration.current += 1; writeFlight.current = false;
    setPrepared(null); setActiveRun(null); setPendingEnrollments([]); setUncertain(false); setUncertainRunId('');
    setActiveRunError(''); setError(''); setRunConflict(false); setCheckingActiveRun(true); setBusy(false);
    setWalletAusd(ownerKey ? 'Checking Mera balance…' : 'Unavailable');
  }, [ownerKey]);

  const loadVenue = useCallback(async () => {
    setError('');
    try {
      const next = findPerplVenue((await perplApi.venues()).venues);
      setVenue(next);
      if (next.venueId === 'perpl-direct-testnet-v1') {
        setAmount('100'); setDurationMinutes(String(PERPL_DIRECT_OPTIMIZER_DEFAULT_DURATION_SECONDS / 60));
      } else {
        if (next.limits?.minDurationSeconds) setDurationMinutes(String(Math.ceil(next.limits.minDurationSeconds / 60)));
        if (next.limits?.minFundingUnits) setAmount(formatMonadUnits(next.limits.minFundingUnits, 6));
        else if (next.limits?.minAccountOpenUnits) setAmount(formatMonadUnits(next.limits.minAccountOpenUnits, 6));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Perpl setup limits could not be loaded.'); }
  }, []);
  const loadWalletAusd = useCallback(async () => {
    const requestOwner = ownerAddress;
    if (!requestOwner) { setWalletAusd('Unavailable'); return; }
    try {
      const snapshot = await monadApi.wallet();
      if (ownerRef.current?.toLowerCase() !== requestOwner.toLowerCase()) return;
      if (snapshot.chainId !== 10143 || snapshot.ownerAddress.toLowerCase() !== requestOwner.toLowerCase()) {
        throw new Error('Wallet does not match the Mera session.');
      }
      const balance = snapshot.balances.find(item => item.asset === 'AUSD');
      setWalletAusd(balance ? `${formatMonadUnits(balance.amountUnits, balance.decimals)} AUSD` : 'Not returned');
    } catch { if (ownerRef.current?.toLowerCase() === requestOwner.toLowerCase()) setWalletAusd('Unavailable'); }
  }, [ownerAddress]);
  const loadActiveRun = useCallback(async () => {
    const requestOwner = ownerAddress;
    const generation = ++activeCheckGeneration.current;
    const isCurrent = () => generation === activeCheckGeneration.current
      && ownerRef.current?.toLowerCase() === requestOwner?.toLowerCase();
    setCheckingActiveRun(true); setActiveRunError('');
    try {
      if (!requestOwner) throw new Error('Your Mera wallet is not available.');
      const [currentRun, references] = await Promise.all([
        fetchActivePerplRun(requestOwner), loadPendingOperationReferences(requestOwner),
      ]);
      if (!isCurrent()) return;
      const enrollmentReferences = references.filter(reference => reference.kind === 'perpl-run' && reference.action === 'enroll');
      const checked = await Promise.all(enrollmentReferences.map(reference => reconcilePendingOperation(requestOwner, reference)));
      const remaining = await loadPendingOperationReferences(requestOwner);
      if (!isCurrent()) return;
      const stillPending = remaining.filter(reference => reference.kind === 'perpl-run' && reference.action === 'enroll');
      const displayedPending = stillPending.filter(reference => reference.id !== currentRun?.runId);
      setPendingEnrollments(displayedPending.map(reference => {
        const status = checked.find(result => result.reference.id === reference.id);
        return {id: reference.id, status: status?.status ?? 'saved', note: status?.note ?? 'The original run is still saved.'};
      }));
      setActiveRun(currentRun);
      setUncertain(false);
      if (currentRun || stillPending.length) { setPrepared(null); setUncertainRunId(displayedPending[0]?.id ?? currentRun?.runId ?? ''); }
    } catch (reason) {
      if (!isCurrent()) return;
      setActiveRun(null);
      setActiveRunError(reason instanceof Error ? reason.message : 'An active Perpl run could not be checked.');
    } finally { if (isCurrent()) setCheckingActiveRun(false); }
  }, [ownerAddress]);
  useFocusEffect(useCallback(() => { void loadVenue(); void loadWalletAusd(); void loadActiveRun(); }, [loadVenue, loadWalletAusd, loadActiveRun]));

  function terms() {
    if (!venue?.enabled || !venue.collateral || !venue.limits) throw new Error(venue?.reasonMessage || venue?.reason || 'Perpl enrollment is currently unavailable.');
    const minimum = venue.limits.minFundingUnits ?? venue.limits.minAccountOpenUnits;
    if (!minimum || !venue.limits.minDurationSeconds || !venue.limits.maxDurationSeconds) {
      throw new Error('The service did not return live Perpl funding and duration limits.');
    }
    const amountUnits = parseMonadAmount(amount, venue.collateral.decimals);
    const directOptimizer = venue.venueId === 'perpl-direct-testnet-v1';
    if (directOptimizer && amountUnits !== '100000000') throw new Error('The direct optimizer review is fixed at 100 AUSD.');
    if (BigInt(amountUnits) < BigInt(minimum)) throw new Error(`Perpl requires at least ${formatMonadUnits(minimum, venue.collateral.decimals)} AUSD.`);
    if (venue.limits.maxFundingUnits && BigInt(amountUnits) > BigInt(venue.limits.maxFundingUnits)) {
      throw new Error(`Perpl allows at most ${formatMonadUnits(venue.limits.maxFundingUnits, venue.collateral.decimals)} AUSD for this setup.`);
    }
    const minutes = Number(durationMinutes.trim());
    if (!Number.isSafeInteger(minutes) || minutes < 1) throw new Error('Enter a whole number of minutes for the run duration.');
    const durationSeconds = minutes * 60;
    if (directOptimizer && !isPerplDirectOptimizerDuration(durationSeconds)) {
      throw new Error('Choose a direct optimizer duration from 10 to 720 minutes.');
    }
    if (durationSeconds < venue.limits.minDurationSeconds || durationSeconds > venue.limits.maxDurationSeconds) {
      throw new Error(`Choose a duration from ${Math.ceil(venue.limits.minDurationSeconds / 60)} to ${Math.floor(venue.limits.maxDurationSeconds / 60)} minutes.`);
    }
    return {amountUnits, durationSeconds};
  }

  async function prepare() {
    if (writeFlight.current) return;
    if (checkingActiveRun || activeRun || activeRunError) {
      setError(activeRunError || 'Check the existing Perpl run before preparing another enrollment.');
      return;
    }
    if (presentationMode === 'user' && runConflict) return;
    const requestOwner = ownerAddress;
    if (!requestOwner) { setError('Your Mera wallet is not available.'); return; }
    const generation = ++writeGeneration.current;
    const isCurrent = () => generation === writeGeneration.current && ownerRef.current === requestOwner.toLowerCase();
    writeFlight.current = true;
    setBusy(true); setError(''); setPrepared(null); setUncertain(false);
    try {
      const saved = await loadPendingOperationReferences(requestOwner);
      if (!isCurrent()) return;
      const pending = saved.filter(reference => reference.kind === 'perpl-run' && reference.action === 'enroll');
      if (pending.length) {
        await loadActiveRun();
        throw new Error('A signed Perpl setup still needs a status check. Open its original run before preparing another one.');
      }
      let latestRun: PerplRun | null;
      try { latestRun = await fetchActivePerplRun(requestOwner); }
      catch (reason) {
        const message = reason instanceof Error ? reason.message : 'The active Perpl run could not be checked.';
        setActiveRunError(message);
        throw new Error(`The active Perpl run could not be checked. ${message}`);
      }
      if (!isCurrent()) return;
      setActiveRun(latestRun);
      if (latestRun) throw new Error('A Perpl run is already active. Review its status before starting another enrollment.');
      const requested = terms();
      const review = await perplApi.prepare({...requested, venueId: venue!.venueId as 'perpl-direct-testnet-v1' | 'perpl-testnet-v1', chainId: 10143, idempotencyKey: createPerplIdempotencyKey()});
      if (!isCurrent()) return;
      validatePreparedPerpl(review, {ownerAddress: requestOwner, venue: venue!, ...requested});
      setPrepared(review);
    } catch (reason) {
      if (isCurrent()) {
        if (reason instanceof MobileApiError && reason.code === 'perpl_run_active') setRunConflict(true);
        setError(reason instanceof Error ? reason.message : 'The Perpl enrollment review could not be prepared.');
      }
    }
    finally { if (generation === writeGeneration.current) { writeFlight.current = false; setBusy(false); } }
  }

  async function signAndEnroll() {
    const requestOwner = ownerAddress;
    if (!prepared || !requestOwner || !venue || writeFlight.current) return;
    const generation = ++writeGeneration.current;
    const isCurrent = () => generation === writeGeneration.current && ownerRef.current === requestOwner.toLowerCase();
    writeFlight.current = true;
    setBusy(true); setError('');
    let latestRun: PerplRun | null;
    try {
      const saved = await loadPendingOperationReferences(requestOwner);
      if (!isCurrent()) return;
      if (saved.some(reference => reference.kind === 'perpl-run' && reference.action === 'enroll')) {
        setPrepared(null); setError('A signed Perpl setup still needs a status check. Open its original run before signing another one.');
        void loadActiveRun(); writeFlight.current = false; setBusy(false); return;
      }
      latestRun = await fetchActivePerplRun(requestOwner);
    } catch (reason) {
      if (!isCurrent()) return;
      const message = reason instanceof Error ? reason.message : 'The active Perpl run could not be checked.';
      setPrepared(null); setActiveRunError(message); setError(`The active Perpl run could not be checked. ${message}`);
      writeFlight.current = false; setBusy(false); return;
    }
    if (!isCurrent()) return;
    setActiveRun(latestRun);
    if (latestRun) {
      setPrepared(null); setError('A Perpl run is already active. Review its status before signing another enrollment.');
      writeFlight.current = false; setBusy(false); return;
    }
    let signaturesSent = false;
    try {
      const requested = terms();
      validatePreparedPerpl(prepared, {ownerAddress: requestOwner, venue, ...requested});
      const result = await signAndSubmitWithMera({ownerAddress: requestOwner,
        reference: {kind: 'perpl-run', id: prepared.runId, action: 'enroll'},
        sign: async session => ({fundingRawTransaction: await session.signEip1559Transaction(10143, prepared.fundingTransaction),
          mandateSignature: await session.signTypedData(10143, prepared.mandateTypedData as unknown as TypedDataDefinition)}),
        validateSigned: signatures => { validatePerplRawTransaction(signatures.fundingRawTransaction); validatePerplSignature(signatures.mandateSignature); },
        onSubmissionStarting: () => {
          if (!isCurrent()) throw new Error('The Mera owner changed. The signed setup was not submitted.');
          signaturesSent = true; setPrepared(null); setUncertainRunId(prepared.runId); setUncertain(true);
        },
        submit: signatures => perplApi.enroll({runId: prepared.runId,
          fundingRawTransaction: signatures.fundingRawTransaction, mandateSignature: signatures.mandateSignature}),
      });
      if (!isCurrent()) return;
      if (result.runId !== prepared.runId || result.venueId !== prepared.venueId) throw new Error('The service returned a different Perpl enrollment.');
      navigation.navigate('PerplStatus');
    } catch (reason) {
      if (!isCurrent()) return;
      setError(signaturesSent
        ? `The signed Perpl setup may still be processing. Check Perpl status and Activity before starting again. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The Perpl setup could not be completed.');
    } finally { if (generation === writeGeneration.current) { writeFlight.current = false; setBusy(false); } }
  }

  const lowerBound = venue?.limits?.minDurationSeconds;
  const upperBound = venue?.limits?.maxDurationSeconds;
  const directOptimizer = venue?.venueId === 'perpl-direct-testnet-v1';
  if (presentationMode === 'user') return <UserPerplSetupView theme={theme} venue={venue} prepared={prepared}
    walletAusd={walletAusd} activeRun={activeRun} pendingEnrollments={pendingEnrollments} checkingActiveRun={checkingActiveRun}
    busy={busy} uncertain={uncertain} uncertainRunId={uncertainRunId} error={error} activeRunError={activeRunError} runConflict={runConflict} durationMinutes={durationMinutes} amount={amount}
    onDurationChange={setDurationMinutes} onAmountChange={setAmount} onBack={() => navigation.goBack()} onPrepare={() => { void prepare(); }}
    onSign={() => { void signAndEnroll(); }} onCancel={() => { setPrepared(null); setError(''); }}
    onOpenRun={runId => navigation.navigate('PerplStatus', runId ? {runId} : undefined)}
    onOpenPending={() => navigation.navigate('PendingOperations')}
    onOpenStatus={() => navigation.navigate('PerplStatus')}
    onRetry={() => { void loadVenue(); void loadWalletAusd(); void loadActiveRun(); }} />;
  return <Screen onBack={() => navigation.goBack()}>
    <PageHeader kicker="Perpl · AUSD Testnet setup" title="Choose amount and duration" copy="One Mera unlock signs the exact AUSD funding transaction and Perpl mandate. Per-order limits and market selection come from the prepared review." />
    {error ? <Notice live tone="rose" title="Perpl setup could not continue" message={error} actionLabel={!prepared && !uncertain ? 'Retry context' : undefined} onAction={() => { void loadVenue(); }} /> : null}
    {activeRunError ? <Notice live tone="rose" title="Could not check Perpl run status" message={activeRunError} actionLabel="Check again" onAction={() => { void loadActiveRun(); }} /> : null}
    {checkingActiveRun && !activeRunError ? <LoadingBlock label="Checking for an active Perpl run" lines={2} /> : null}
    {activeRun ? <Card tint="#E9F5FF">
      <Text style={s.strong}>A Perpl run is already active</Text>
      <DataRow label="Run ID" value={activeRun.runId} />
      <DataRow label="Status" value={activeRun.status} />
      <DataRow label="Venue" value={activeRun.venueId === 'perpl-direct-testnet-v1' ? 'Direct onchain' : 'Perpl API'} />
      {activeRun.expiresAt ? <DataRow label="Run expires" value={formatMonadTimestamp(activeRun.expiresAt)} /> : null}
      <Text style={s.body}>Review this run before starting another enrollment.</Text>
      <Button label="Open Perpl run status" onPress={() => navigation.navigate('PerplStatus')} />
      <Button label="Refresh active run" variant="secondary" onPress={() => { void loadActiveRun(); }} loading={checkingActiveRun} />
    </Card> : null}
    {venue && !venue.enabled ? <Notice tone="orange" title="Perpl enrollment is paused" message={venue.reasonMessage ?? venue.reason ?? 'The venue service has not enabled Testnet enrollment.'} /> : null}
    {!venue && !error ? <LoadingBlock label="Loading live Perpl limits" lines={3} /> : null}
    {uncertain ? <Card><Text style={s.strong}>Check enrollment status</Text><Text style={s.body}>The service may still be reconciling your signed setup. Check the run and Activity before preparing another enrollment.</Text><Button label="Check Perpl status" onPress={() => navigation.navigate('PerplStatus')} /></Card> : null}
    {!activeRun && !activeRunError && !checkingActiveRun && !prepared && !uncertain && venue?.enabled ? <Card>
      <Text style={s.strong}>Live AUSD setup</Text>
      <Text style={s.body}>An earlier unsigned review can be refreshed or superseded. Funds move and the mandate becomes active only after you sign the exact review below.</Text>
      <DataRow label="Available in Mera wallet" value={walletAusd} />
      {directOptimizer ? <DataRow label="Funding amount" value="100 AUSD · fixed for this experiment" /> : null}
      <Field label="Duration in minutes" value={durationMinutes} onChangeText={setDurationMinutes} placeholder="120" keyboardType="number-pad" />
      {!directOptimizer ? <Field label="AUSD funding amount" value={amount} onChangeText={setAmount} placeholder="100" keyboardType="decimal-pad" /> : null}
      {venue.collateral ? <DataRow label="AUSD token" value={venue.collateral.address} /> : null}
      {venue.limits?.minFundingUnits || venue.limits?.minAccountOpenUnits ? <DataRow label="Minimum funding" value={`${formatMonadUnits(venue.limits.minFundingUnits ?? venue.limits.minAccountOpenUnits!, 6)} AUSD`} /> : null}
      {venue.limits?.backendMaxMarketSlippageBps ? <DataRow label="Backend market-order slippage cap" value={`${venue.limits.backendMaxMarketSlippageBps} bps`} /> : null}
      {directOptimizer ? <DataRow label="Allowed duration" value={`${PERPL_DIRECT_OPTIMIZER_MIN_DURATION_SECONDS / 60}–${PERPL_DIRECT_OPTIMIZER_MAX_DURATION_SECONDS / 60} minutes · default ${PERPL_DIRECT_OPTIMIZER_DEFAULT_DURATION_SECONDS / 60}`} />
        : lowerBound && upperBound ? <DataRow label="Allowed duration" value={`${Math.ceil(lowerBound / 60)}–${Math.floor(upperBound / 60)} minutes`} /> : null}
      <Button label="Prepare exact Perpl review" onPress={() => { void prepare(); }} loading={busy} disabled={checkingActiveRun || Boolean(activeRun) || Boolean(activeRunError)} />
    </Card> : null}
    {prepared && !activeRun && !activeRunError && !checkingActiveRun ? <>
      <Card tint="#E9F5FF">
        <Text style={s.strong}>Step 2 · Sign this exact setup with Mera</Text>
        <Text style={s.body}>A prior unsigned review can be refreshed or superseded. Nothing is funded or activated until you sign this review.</Text>
        <Button label="Unlock Mera and sign exact setup" onPress={() => { void signAndEnroll(); }} loading={busy} />
      </Card>
      <Card>
        <Text style={s.strong}>AUSD funding transaction</Text>
        <DataRow label="Mera owner" value={prepared.ownerAddress} />
        <DataRow label="Funding amount" value={`${formatMonadUnits(prepared.amountUnits, prepared.collateral.decimals)} ${prepared.collateral.symbol}`} />
        <DataRow label="Token contract" value={prepared.collateral.address} />
        <DataRow label="Transaction recipient" value={prepared.fundingTransaction.to} />
        <DataRow label="Perpl vault receiver" value={prepared.vaultAddress} />
        {prepared.delegatedAccountAddress ? <DataRow label="Perpl account" value={prepared.delegatedAccountAddress} /> : null}
        {prepared.accountId !== undefined ? <DataRow label="Perpl account ID" value={String(prepared.accountId)} /> : null}
        <DataRow label="Chain and transaction type" value="Monad Testnet · EIP-1559 · 10143" />
        <DataRow label="Maximum network fee" value={`${formatMonadUnits(maximumCost(prepared.fundingTransaction.gasLimit, prepared.fundingTransaction.maxFeePerGas), 18)} MON`} />
        <DataRow label="Review expires" value={formatMonadTimestamp(prepared.preparedExpiresAt)} />
      </Card>
      <Card>
        <Text style={s.strong}>Perpl mandate · {prepared.durationSeconds / 60} minutes</Text>
        <DataRow label="Mandate type" value={prepared.mandateTypedData.primaryType} />
        <DataRow label="Execution route" value={prepared.venueId === 'perpl-direct-testnet-v1' ? 'Direct onchain · operator pays MON gas' : 'Perpl API forwarding'} />
        <DataRow label="Signing domain" value={String(prepared.mandateTypedData.domain.name ?? 'Perpl')} />
        <DataRow label="Domain verifier" value={String(prepared.mandateTypedData.domain.verifyingContract ?? 'Not returned')} />
        <DataRow label="Policy version" value={String(prepared.mandateTypedData.message.policyVersion)} />
        <DataRow label="Mandate nonce" value={String(prepared.mandateTypedData.message.nonce)} />
        <DataRow label="Setup signature deadline" value={formatMonadTimestamp(String(prepared.mandateTypedData.message.setupDeadline))} />
        <DataRow label="Maximum position exposure" value={`${formatMonadUnits(prepared.maxPositionExposureUnits, prepared.collateral.decimals)} AUSD`} />
        <DataRow label="Maximum leverage" value={`${prepared.maxLeverage}×`} />
        <DataRow label="Market-order slippage cap" value={`${prepared.maxSlippageBps} bps (${(prepared.maxSlippageBps / 100).toFixed(2)}%)`} />
        <Text style={s.body}>This cap is enforced by the Moeazi backend before market orders are sent; the Perpl contract does not enforce slippage. A market can impose a lower cap.</Text>
        {prepared.optimizerReview ? <>
          <DataRow label="Automatic market detection" value={`Across all eligible markets even with a position open; every ${prepared.optimizerReview.marketScanIntervalMs / 60_000} minutes. Three scans without a proposal trigger a scanner review, not an automatic trade or rule change. A proposal during an open position is recorded and deferred.`} />
          <DataRow label="Optimizer profile" value={`Duration soak · keep scanning and trading through the signed ${prepared.durationSeconds / 60}-minute run; stop new entries after ${prepared.optimizerReview.maxCycles} completed cycles or run expiry`} />
          <DataRow label="Positive-cycle tracking" value={`A cycle netting at least ${formatMonadUnits(prepared.optimizerReview.minimumPositivePnlUnits, prepared.collateral.decimals)} AUSD counts as positive; wins do not stop new entries`} />
          <DataRow label="Normal hold and exit checks" value={`${prepared.optimizerReview.cycleHoldMinMs / 60_000}–${prepared.optimizerReview.cycleHoldMaxMs / 60_000} minutes; executable close checks every minute`} />
          <DataRow label="Backend-enforced sizing" value={`≤${formatMonadUnits(prepared.optimizerReview.maxNotionalUnits, prepared.collateral.decimals)} AUSD notional · ≤${formatMonadUnits(prepared.optimizerReview.maxMarginUnits, prepared.collateral.decimals)} AUSD margin · ≤${prepared.optimizerReview.maxDepthConsumptionBps / 100}% displayed depth`} />
          <DataRow label="Leverage and risk budget" value={`1×–${Math.min(prepared.maxLeverage, prepared.optimizerReview.maxLeverage)}×, subject to each live market and signed mandate · planned loss ≤${formatMonadUnits(prepared.optimizerReview.plannedLossUnits, prepared.collateral.decimals)} AUSD`} />
          <Text style={s.body}>The strategy skips markets that fail its movement, trend, book freshness, fee, or depth checks. After 10 minutes it may exit on net profit or a trailing giveback; it exits earlier on the risk limit, owner stop, or run expiry. Operator MON gas is recorded separately from AUSD PnL.</Text>
        </> : null}
        <DataRow label="Operator permissions" value={`${prepared.operatorPermission.scope}; withdrawals ${prepared.operatorPermission.withdrawals ? 'allowed' : 'disabled'}`} />
        <DataRow label="Operator address" value={prepared.operatorPermission.address} />
        <DataRow label="Per-order caps" value={`Enforced by ${prepared.operatorPermission.perOrderCapsEnforcedBy}`} />
        <Text style={s.body}>This authorization does not grant withdrawals. Direct orders use Perpl's contracts without an API key; the operator pays gas. Every order and fill remains visible in Activity. Review the exact markets and caps below before signing.</Text>
        {prepared.markets.map(market => {
          const marketCap = market.maxMarketSlippageBps!;
          const effectiveCap = effectivePerplMarketSlippageBps(prepared.maxSlippageBps, marketCap);
          return <DataRow key={market.id} label={`Market ${market.symbol}`} value={`${market.isOpen ? 'Open' : 'Closed'} · max ${market.maxLeverage ?? prepared.maxLeverage}× · slippage ≤${effectiveCap} bps (market max ${marketCap})`} />;
        })}
      </Card>
      <Card tint="#FFF1E5"><Text style={s.strong}>Funds and permissions</Text><Text style={s.body}>The signed transaction sends only the reviewed AUSD amount to the displayed Perpl vault. Mera signs the exact EIP-1559 transaction and mandate in one passkey session. The session closes before the signatures are sent to the service. The operator has no withdrawal permission; all AUSD collateral and trading losses remain at risk.</Text></Card>
      <Button label="Change amount or duration" variant="secondary" disabled={busy} onPress={() => { setPrepared(null); setError(''); }} />
    </> : null}
    <Button label="Perpl positions and history" variant="secondary" onPress={() => navigation.navigate('PerplStatus')} />
  </Screen>;
}

async function fetchActivePerplRun(ownerAddress: string): Promise<PerplRun | null> {
  const {current} = await perplApi.current();
  if (!current) return null;
  validatePerplRunOwner(current, ownerAddress);
  return isTerminalRun(current.status) || current.status.toLowerCase() === 'prepared' ? null : current;
}

function isTerminalRun(status: string) {
  return new Set(['stopped', 'settled', 'failed', 'expired', 'inactive', 'complete', 'completed']).has(status.toLowerCase());
}

function maximumCost(gasLimit: string, maxFee: string) {
  try { return (BigInt(gasLimit) * BigInt(maxFee)).toString(); } catch { return '0'; }
}
