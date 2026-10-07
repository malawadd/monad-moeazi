import React, {useState} from 'react';
import {Text} from 'react-native';
import {Button, Card, DataRow, Notice} from '../components/Ui';
import {perplApi, createPerplIdempotencyKey} from '../services/perplApi';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import {openMeraSigningSession} from '../services/wallet/meraAuth';
import {validatePerplRawTransaction, validatePerplRecovery} from '../services/perplValidation';
import type {PerplRecoveryAction, PerplRecoveryReview, PerplRun} from '../types/perpl';
import {screenStyles as s} from '../theme/screenStyles';

const VAULT_RECOVERY_STATES = new Set(['activation_failed', 'funding_failed', 'funding_uncertain', 'activation_uncertain', 'failed', 'uncertain', 'recovery_available']);
const WITHDRAWAL_SETTLED_STATES = new Set(['stopped', 'settled', 'expired', 'complete', 'completed']);

export function canRecoverPerplAction(run: PerplRun, action: PerplRecoveryAction) {
  if (run.recoveryActions?.includes(action)) return true;
  if (action === 'recover_vault_funding') return Boolean(run.recoveryAvailable || VAULT_RECOVERY_STATES.has(run.status.toLowerCase()));
  return WITHDRAWAL_SETTLED_STATES.has(run.status.toLowerCase()) && !run.position && !hasLiveOrders(run);
}

export function PerplRecoveryPanel({run, ownerAddress, disabled = false, onRefresh}: {
  run: PerplRun; ownerAddress: string | null; disabled?: boolean; onRefresh: () => void;
}) {
  const [review, setReview] = useState<PerplRecoveryReview | null>(null);
  const [result, setResult] = useState<{action: PerplRecoveryAction; status: string; phase: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [requestedAction, setRequestedAction] = useState<PerplRecoveryAction | null>(null);

  async function prepare(action: PerplRecoveryAction) {
    setBusy(true); setError(''); setResult(null); setUncertain(false); setReview(null); setRequestedAction(action);
    try {
      const next = await perplApi.prepareRecovery({runId: run.runId, action, idempotencyKey: createPerplIdempotencyKey()});
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      validatePerplRecovery(next, ownerAddress, run); setReview(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'A fresh AUSD recovery review could not be prepared.'); }
    finally { setBusy(false); }
  }

  async function signAndSubmit() {
    if (!review || !ownerAddress) return;
    setBusy(true); setError(''); let session: Awaited<ReturnType<typeof openMeraSigningSession>> | undefined;
    let signedRequestSent = false;
    try {
      validatePerplRecovery(review, ownerAddress, run);
      session = await openMeraSigningSession('signin');
      if (session.address.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error('The passkey opened a different Mera wallet. Nothing was signed.');
      const signedTransaction = await session.signEip1559Transaction(10143, review.recoveryTransaction);
      session.end(); session = undefined;
      validatePerplRawTransaction(signedTransaction);
      signedRequestSent = true; setReview(null); setUncertain(true);
      const response = await perplApi.recovery({runId: review.runId, action: review.action, signedTransaction});
      if (response.runId !== review.runId || response.venueId !== review.venueId || response.action !== review.action) {
        throw new Error('The service returned a different Perpl recovery request.');
      }
      setResult({action: response.action, status: response.status, phase: response.phase}); setUncertain(false); onRefresh();
    } catch (reason) {
      if (signedRequestSent) setUncertain(true);
      setError(signedRequestSent
        ? `The signed recovery may still be processing. Check this run and Activity before retrying. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The AUSD recovery could not be signed.');
    } finally { session?.end(); setBusy(false); }
  }

  const canRecoverFunding = canRecoverPerplAction(run, 'recover_vault_funding');
  const canRecoverAvailable = canRecoverPerplAction(run, 'recover_available_ausd');
  if (!canRecoverFunding && !canRecoverAvailable && !result && !uncertain && !error) return null;

  return <>
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
function actionLabel(action: PerplRecoveryAction) { return action === 'recover_vault_funding' ? 'Stuck vault AUSD recovery' : 'Available AUSD return'; }
function methodLabel(action: PerplRecoveryAction) { return action === 'recover_vault_funding' ? 'recoverVaultFunding()' : 'recoverWithdrawCollateral(amount)'; }
function recoveryDisclosure(action: PerplRecoveryAction) {
  return action === 'recover_vault_funding'
    ? 'This contract call returns recoverable AUSD from the deterministic vault to its immutable owner. It may fail while a Perpl position or order locks collateral.'
    : 'This return is available only after stop or expiry, a fresh finalized Perpl account snapshot, and zero positions and orders; the backend and contract check those conditions.';
}
function maximumCost(gasLimit: string, maxFeePerGas: string) { try { return (BigInt(gasLimit) * BigInt(maxFeePerGas)).toString(); } catch { return '0'; } }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
