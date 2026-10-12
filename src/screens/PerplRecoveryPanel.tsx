import React, {useEffect, useRef, useState} from 'react';
import {Text} from 'react-native';
import {Button, Card, DataRow, Notice} from '../components/Ui';
import {perplApi, createPerplIdempotencyKey} from '../services/perplApi';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import {signAndSubmitWithMera} from '../services/meraSubmission';
import {validatePerplRawTransaction, validatePerplRecovery} from '../services/perplValidation';
import {keccak256, type Hex} from 'viem';
import type {PerplRecoveryAction, PerplRecoveryReview, PerplRun} from '../types/perpl';
import {screenStyles as s} from '../theme/screenStyles';
import {usePreparedReviewGuard} from '../navigation/usePreparedReviewGuard';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {UserPerplRecoveryView} from './user-perpl/UserPerplRecoveryView';
import {loadPendingOperationReferences} from '../services/pendingOperationJournal';
import {canStartUserPerplRecovery} from '../services/userPerplPresentation';

const VAULT_RECOVERY_STATES = new Set(['activation_failed', 'funding_failed', 'funding_uncertain', 'activation_uncertain', 'failed', 'uncertain', 'recovery_available']);
const WITHDRAWAL_SETTLED_STATES = new Set(['stopped', 'settled', 'expired', 'complete', 'completed']);

export function canRecoverPerplAction(run: PerplRun, action: PerplRecoveryAction) {
  if (run.recoveryActions?.includes(action)) return true;
  if (action === 'recover_vault_funding') return Boolean(run.recoveryAvailable || VAULT_RECOVERY_STATES.has(run.status.toLowerCase()));
  return WITHDRAWAL_SETTLED_STATES.has(run.status.toLowerCase()) && !run.position && !hasLiveOrders(run);
}

export function PerplRecoveryPanel({run, ownerAddress, disabled = false, userActionsFresh = false, onRefresh, onReviewOpenChange}: {
  run: PerplRun; ownerAddress: string | null; disabled?: boolean; userActionsFresh?: boolean;
  onRefresh: () => void; onReviewOpenChange?: (open: boolean) => void;
}) {
  const {presentationMode, effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const ownerKey = ownerAddress?.toLowerCase() ?? '';
  const scopeRef = useRef({runId: run.runId, owner: ownerKey});
  scopeRef.current = {runId: run.runId, owner: ownerKey};
  const operationGeneration = useRef(0);
  const actionFlight = useRef(false);
  const [review, setReview] = useState<PerplRecoveryReview | null>(null);
  const [result, setResult] = useState<{action: PerplRecoveryAction; status: string; phase: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [requestedAction, setRequestedAction] = useState<PerplRecoveryAction | null>(null);
  const [blockedReason, setBlockedReason] = useState('');
  usePreparedReviewGuard(Boolean(review));
  useEffect(() => { onReviewOpenChange?.(Boolean(review)); }, [review, onReviewOpenChange]);
  useEffect(() => {
    operationGeneration.current += 1; actionFlight.current = false;
    setReview(null); setResult(null); setUncertain(false); setError(''); setRequestedAction(null); setBlockedReason(''); setBusy(false);
  }, [run.runId, ownerKey]);

  async function prepare(action: PerplRecoveryAction) {
    const scope = {runId: run.runId, owner: ownerAddress?.toLowerCase() ?? ''};
    if (!ownerAddress || actionFlight.current) return;
    const generation = ++operationGeneration.current;
    const isCurrent = () => generation === operationGeneration.current && scopeRef.current.runId === scope.runId && scopeRef.current.owner === scope.owner;
    actionFlight.current = true;
    setBusy(true); setError(''); setResult(null); setUncertain(false); setReview(null); setRequestedAction(action); setBlockedReason('');
    try {
      const saved = await loadPendingOperationReferences(ownerAddress);
      if (!isCurrent()) return;
      if (presentationMode === 'user' && !canStartUserPerplRecovery(run, action, userActionsFresh, saved)) {
        setBlockedReason('Refresh this run to confirm that this exact AUSD return is available and that no earlier return is pending.');
        return;
      }
      if (hasUnresolvedRecovery(saved, run.runId)
          || (presentationMode !== 'user' && hasPerplAction(saved, run.runId))) {
        setBlockedReason('A signed action for this run is still being checked. Refresh status before preparing another action.');
        return;
      }
      const next = await perplApi.prepareRecovery({runId: run.runId, action, idempotencyKey: createPerplIdempotencyKey()});
      if (!isCurrent()) return;
      validatePerplRecovery(next, ownerAddress, run); setReview(next);
    } catch (reason) {
      if (isCurrent()) {
        setError(reason instanceof Error ? reason.message : 'A fresh AUSD recovery review could not be prepared.');
      }
    } finally { if (generation === operationGeneration.current) { actionFlight.current = false; setBusy(false); } }
  }

  async function signAndSubmit() {
    if (!review || !ownerAddress || actionFlight.current) return;
    const selectedReview = review;
    const scope = {runId: run.runId, owner: ownerAddress.toLowerCase()};
    const generation = ++operationGeneration.current;
    const isCurrent = () => generation === operationGeneration.current && scopeRef.current.runId === scope.runId && scopeRef.current.owner === scope.owner;
    actionFlight.current = true;
    setBusy(true); setError('');
    let signedRequestSent = false;
    try {
      const saved = await loadPendingOperationReferences(ownerAddress);
      if (!isCurrent()) return;
      if ((presentationMode === 'user' && !canStartUserPerplRecovery(run, selectedReview.action, userActionsFresh, saved))
          || hasUnresolvedRecovery(saved, selectedReview.runId)
          || (presentationMode !== 'user' && hasPerplAction(saved, selectedReview.runId))) {
        setReview(null);
        setBlockedReason('A signed action for this run is still being checked, or its availability needs a fresh check. Refresh status before signing another action.');
        setError('');
        onRefresh();
        return;
      }
      validatePerplRecovery(selectedReview, ownerAddress, run);
      const response = await signAndSubmitWithMera({ownerAddress,
        reference: {kind: 'perpl-recovery', id: selectedReview.runId, action: selectedReview.action},
        sign: session => session.signEip1559Transaction(10143, selectedReview.recoveryTransaction),
        validateSigned: validatePerplRawTransaction,
        referenceTxHash: signedTransaction => keccak256(signedTransaction as Hex),
        onSubmissionStarting: () => {
          if (!isCurrent()) {
            throw new Error('The selected Perpl run or Mera owner changed. The signed recovery was not submitted.');
          }
          signedRequestSent = true; setReview(null); setUncertain(true);
        },
        submit: signedTransaction => perplApi.recovery({runId: selectedReview.runId, action: selectedReview.action, signedTransaction}),
      });
      if (!isCurrent()) return;
      if (response.runId !== selectedReview.runId || response.venueId !== selectedReview.venueId || response.action !== selectedReview.action) {
        throw new Error('The service returned a different Perpl recovery request.');
      }
      setResult({action: response.action, status: response.status, phase: response.phase}); setUncertain(false); onRefresh();
    } catch (reason) {
      if (!isCurrent()) return;
      if (signedRequestSent) setUncertain(true);
      setError(signedRequestSent
        ? `The signed recovery may still be processing. Check this run and Activity before retrying. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The AUSD recovery could not be signed.');
    } finally { if (generation === operationGeneration.current) { actionFlight.current = false; setBusy(false); } }
  }

  const canRecoverFunding = presentationMode === 'user'
    ? canStartUserPerplRecovery(run, 'recover_vault_funding', userActionsFresh, [])
    : canRecoverPerplAction(run, 'recover_vault_funding');
  const canRecoverAvailable = presentationMode === 'user'
    ? canStartUserPerplRecovery(run, 'recover_available_ausd', userActionsFresh, [])
    : canRecoverPerplAction(run, 'recover_available_ausd');
  if (!canRecoverFunding && !canRecoverAvailable && !result && !uncertain && !error && !blockedReason) return null;

  if (presentationMode === 'user') return <UserPerplRecoveryView theme={theme} ownerAddress={ownerAddress}
    canRecoverFunding={canRecoverFunding} canRecoverAvailable={canRecoverAvailable} review={review} result={result}
    busy={busy} uncertain={uncertain} error={error} disabled={disabled || Boolean(blockedReason)} blockedReason={blockedReason}
    onPrepare={action => { void prepare(action); }} onSign={() => { void signAndSubmit(); }}
    onCancel={() => setReview(null)} onRefresh={() => { setBlockedReason(''); onRefresh(); }} />;

  return <>
    {blockedReason ? <Notice live tone="orange" title="Another signed action is still being checked" message={blockedReason} actionLabel="Refresh Perpl status" onAction={onRefresh} /> : null}
    {error ? <Notice live tone="rose" title="AUSD recovery unavailable" message={error} actionLabel={requestedAction && !uncertain ? 'Try again' : undefined} onAction={() => { if (requestedAction) void prepare(requestedAction); }} /> : null}
    {run.recoveryReason && (canRecoverFunding || canRecoverAvailable) ? <Notice tone="orange" title="Recovery status" message={run.recoveryReason} /> : null}
    {result ? <Card tint="#DDF4E7"><Text style={s.strong}>{actionLabel(result.action)} request recorded</Text><DataRow label="Status" value={humanize(result.status)} /><DataRow label="Phase" value={humanize(result.phase)} /><Text style={s.body}>The service will reconcile this owner recovery with the Perpl vault and update run history.</Text></Card> : null}
    {uncertain ? <Card tint="#FFF1E5"><Text style={s.strong}>Recovery outcome is being reconciled</Text><Text style={s.body}>Refresh this screen and Activity before preparing another recovery.</Text><Button label="Refresh Perpl status" variant="secondary" onPress={onRefresh} /></Card> : null}
    {review ? <Card tint="#FFF1E5">
      <Text style={s.strong}>Review {actionLabel(review.action).toLowerCase()}</Text>
      <DataRow label="Vault call" value={`${methodLabel(review.action)} · no MON value sent`} />
      <DataRow label="Mera owner and recipient" value={review.ownerAddress} />
      <DataRow label="Perpl vault contract" value={review.recoveryTransaction.to} />
      <DataRow label="Reviewed AUSD amount" value={`${formatMonadUnits(review.amountUnits, 6)} AUSD`} />
      <DataRow label="Network" value="Monad Testnet · EIP-1559 · 10143" />
      <DataRow label="Maximum network fee" value={`${formatMonadUnits(maximumCost(review.recoveryTransaction.gasLimit, review.recoveryTransaction.maxFeePerGas), 18)} MON`} />
      <DataRow label="Review expires" value={formatMonadTimestamp(review.preparedExpiresAt)} />
      <Text style={s.body}>{recoveryDisclosure(review.action)} Mera signs the exact reviewed call in one short-lived session; the session closes before the signed transaction is sent to the service.</Text>
      <Button label="Sign recovery with Mera" onPress={() => { void signAndSubmit(); }} loading={busy} disabled={disabled} />
      <Button label="Cancel recovery review" variant="secondary" disabled={busy} onPress={() => setReview(null)} />
    </Card> : null}
    {!review && !uncertain && !result ? <>
      {canRecoverFunding ? <Button label="Prepare stuck AUSD recovery" variant="secondary" onPress={() => { void prepare('recover_vault_funding'); }} loading={busy} disabled={disabled} /> : null}
      {canRecoverAvailable ? <Button label="Prepare available AUSD return" variant="secondary" onPress={() => { void prepare('recover_available_ausd'); }} loading={busy} disabled={disabled} /> : null}
    </> : null}
  </>;
}

function hasLiveOrders(run: PerplRun) {
  const terminal = new Set(['filled', 'finalized', 'canceled', 'cancelled', 'failed', 'rejected', 'expired']);
  return (run.orders ?? []).some(order => !order.status && !order.phase
    || !terminal.has(String(order.phase ?? order.status).toLowerCase()));
}
function hasPerplAction(references: Awaited<ReturnType<typeof loadPendingOperationReferences>>, runId: string) {
  return references.some(reference => reference.id === runId && ['perpl-stop', 'perpl-recovery'].includes(reference.kind));
}
function hasUnresolvedRecovery(references: Awaited<ReturnType<typeof loadPendingOperationReferences>>, runId: string) {
  return references.some(reference => reference.id === runId && reference.kind === 'perpl-recovery');
}
function actionLabel(action: PerplRecoveryAction) { return action === 'recover_vault_funding' ? 'Stuck vault AUSD recovery' : 'Available AUSD return'; }
function methodLabel(action: PerplRecoveryAction) { return action === 'recover_vault_funding' ? 'recoverVaultFunding()' : 'recoverWithdrawCollateral(amount)'; }
function recoveryDisclosure(action: PerplRecoveryAction) {
  return action === 'recover_vault_funding'
    ? 'This contract call returns recoverable AUSD from the deterministic vault to its immutable owner. It may fail while a Perpl position or order locks collateral.'
    : 'This return is available only after stop or expiry, a fresh finalized Perpl account snapshot, and zero positions and orders; the backend and contract check those conditions.';
}
function maximumCost(gasLimit: string, maxFeePerGas: string) { try { return (BigInt(gasLimit) * BigInt(maxFeePerGas)).toString(); } catch { return '0'; } }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
