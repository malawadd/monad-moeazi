import React, {useState} from 'react';
import type {PendingOperationReference} from '../../services/pendingOperationJournal';
import type {ReconciliationResult} from '../../services/pendingOperationReconcile';
import type {VerifiedMonadContinuation} from '../../services/pendingMonadContinuation';
import type {UserThemeTokens} from '../../theme/userThemes';
import {formatMonadTimestamp, formatMonadUnits} from '../../services/monadFormatting';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../../components/user/UserPrimitives';

export function UserPendingOperationsView({theme, references, resolved, results, busyKey, error, focusMissing,
  onBack, onRetry, onCheck, onContinue}: {
  theme: UserThemeTokens; references: PendingOperationReference[] | null; resolved: ReconciliationResult[];
  results: Record<string, ReconciliationResult>; busyKey: string; error: string; focusMissing: boolean;
  onBack(): void; onRetry(): void; onCheck(reference: PendingOperationReference): void;
  onContinue(reference: PendingOperationReference, continuation: VerifiedMonadContinuation): void;
}) {
  return <UserPage theme={theme}>
    <UserButton label="Back" onPress={onBack} theme={theme} secondary />
    <UserHeading theme={theme} kicker="ACCOUNT · RECOVERY" title="Transaction status"
      copy="Check a saved action or continue an original verified transaction. Checking status does not create a new transaction." />
    {focusMissing ? <UserCard theme={theme}><UserText theme={theme}>That saved action is no longer on this device. Showing the other references for this signed-in wallet.</UserText></UserCard> : null}
    {error ? <UserCard theme={theme}><UserText theme={theme} kind="title">References unavailable</UserText><UserText theme={theme}>{error}</UserText>
      <UserButton label="Try again" onPress={onRetry} theme={theme} secondary /></UserCard> : null}
    {references === null && !error ? <UserCard theme={theme}><UserText theme={theme}>Loading saved transactions…</UserText></UserCard> : null}
    {references?.length === 0 && resolved.length === 0 ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">No saved transactions</UserText>
      <UserText theme={theme}>If an action was interrupted, its original status will appear here when this wallet has a saved reference.</UserText>
    </UserCard> : null}
    {references?.map(reference => {
      const key = `${reference.kind}:${reference.id}:${reference.action}`;
      const result = results[key];
      return <PendingCard key={key} theme={theme} reference={reference} result={result} busy={busyKey === key}
        onCheck={() => onCheck(reference)} onContinue={continuation => onContinue(reference, continuation)} />;
    })}
    {resolved.map(result => <UserCard key={`resolved:${result.reference.kind}:${result.reference.id}:${result.reference.action}`} theme={theme}>
      <UserText theme={theme} kind="title">{label(result.reference)} · checked</UserText>
      <UserValueRow theme={theme} label="Latest status" value={result.status} />
      <UserText theme={theme}>{result.note}</UserText>
      <UserValueRow theme={theme} label="Original ID" value={result.reference.id} />
    </UserCard>)}
  </UserPage>;
}

function PendingCard({theme, reference, result, busy, onCheck, onContinue}: {
  theme: UserThemeTokens; reference: PendingOperationReference; result?: ReconciliationResult; busy: boolean;
  onCheck(): void; onContinue(continuation: VerifiedMonadContinuation): void;
}) {
  const [details, setDetails] = useState(false);
  const [referenceDetails, setReferenceDetails] = useState(false);
  const continuation = result?.continuation;
  const reviewedAmount = continuation ? amountLine(continuation) : null;
  const actionName = continuation ? continuation.kind.replaceAll('_', ' ') : '';
  return <UserCard theme={theme} texture>
    <UserText theme={theme} kind="title">{label(reference)}</UserText>
    <UserValueRow theme={theme} label="Status" value={result?.status ?? 'Needs a status check'} />
    {result ? <UserText theme={theme}>{result.note}</UserText> : null}
    {continuation ? <>
      <UserText theme={theme}>The service still holds this verified signed transaction. Review the same action before continuing it.</UserText>
      <UserValueRow theme={theme} label="Action" value={actionName} />
      {reviewedAmount ? <UserValueRow theme={theme} label="Amount" value={reviewedAmount} /> : null}
      {continuation.kind === 'wallet_swap' ? <>
        <UserValueRow theme={theme} label="From" value={`${formatMonadUnits(String(continuation.review.amountInUnits), Number(continuation.review.inputDecimals))} ${assetSymbol(continuation.review.tokenIn)}`} />
        <UserValueRow theme={theme} label="To · minimum received" value={`${formatMonadUnits(String(continuation.review.minAmountOutUnits), Number(continuation.review.outputDecimals))} ${assetSymbol(continuation.review.tokenOut)}`} />
        {typeof continuation.review.venue === 'string' ? <UserValueRow theme={theme} label="Venue" value={continuation.review.venue} /> : null}
      </> : null}
      {continuation.kind === 'approve_token' ? <>
        <UserValueRow theme={theme} label="Exact allowance" value={`${formatMonadUnits(String(continuation.review.amountUnits), continuation.reviewDecimals!)} ${assetSymbol(continuation.review.tokenAddress)}`} />
        <UserValueRow theme={theme} label="Spender" value={String(continuation.review.spender)} />
      </> : null}
      {continuation.review.recipient ? <UserValueRow theme={theme} label="Recipient" value={String(continuation.review.recipient)} /> : null}
      {continuation.review.vaultAddress ? <UserValueRow theme={theme} label="Vault" value={String(continuation.review.vaultAddress)} /> : null}
      <UserValueRow theme={theme} label="Maximum network fee" value={maxFee(continuation.transaction.gasLimit, continuation.transaction.maxFeePerGas)} />
      <UserDisclosure theme={theme} label="Exact transaction details" value="Owner, network and ID" expanded={details}
        onPress={() => setDetails(value => !value)}>
        <UserValueRow theme={theme} label="Original ID" value={continuation.operationId} />
        <UserValueRow theme={theme} label="Mera wallet" value={continuation.ownerAddress} />
        <UserValueRow theme={theme} label="Network" value="Monad Testnet · 10143" />
        <UserValueRow theme={theme} label="Expires" value={formatMonadTimestamp(continuation.expiresAt)} />
        <UserValueRow theme={theme} label="Transaction recipient" value={continuation.transaction.to} />
        {continuation.kind === 'wallet_swap' ? <>
          <UserValueRow theme={theme} label="Input token address" value={String(continuation.review.tokenIn)} />
          <UserValueRow theme={theme} label="Output token address" value={String(continuation.review.tokenOut)} />
          <UserValueRow theme={theme} label="Minimum output · base units" value={String(continuation.review.minAmountOutUnits)} />
          {continuation.review.poolId ? <UserValueRow theme={theme} label="Pool ID" value={String(continuation.review.poolId)} /> : null}
        </> : null}
        {continuation.kind === 'approve_token' ? <UserValueRow theme={theme} label="Token address" value={String(continuation.review.tokenAddress)} /> : null}
        {continuation.kind === 'claim_ausd_faucet' ? <>
          <UserValueRow theme={theme} label="AUSD amount" value="Set by the Agora faucet; check the finalized receipt" />
          <UserValueRow theme={theme} label="Faucet method" value={String(continuation.review.method)} />
          <UserValueRow theme={theme} label="Faucet contract" value={String(continuation.review.faucetAddress)} />
        </> : null}
      </UserDisclosure>
      <UserButton label="Continue original transaction" theme={theme} loading={busy} onPress={() => onContinue(continuation)} />
      <UserText theme={theme} kind="meta">This rechecks the same operation ID and asks the service to broadcast its original verified transaction. No new request or signature is created.</UserText>
    </> : <UserButton label={busy ? 'Checking status…' : 'Check status'} theme={theme} secondary loading={busy} onPress={onCheck} />}
    <UserDisclosure theme={theme} label="Saved reference" value="Show original ID" expanded={referenceDetails} onPress={() => setReferenceDetails(value => !value)}>
      <UserValueRow theme={theme} label="Original ID" value={reference.id} />
      {reference.relatedId ? <UserValueRow theme={theme} label="Related ID" value={reference.relatedId} /> : null}
    </UserDisclosure>
  </UserCard>;
}

function label(reference: PendingOperationReference) {
  if (reference.kind === 'monad-operation') return 'Wallet transaction';
  if (reference.kind === 'manual-perpl-operation') return 'Perpl account action';
  if (reference.kind === 'perpl-run' || reference.kind === 'perpl-stop' || reference.kind === 'perpl-recovery') return 'Perpl run action';
  if (reference.kind === 'perp-run' || reference.kind === 'perp-stop') return 'Perp run action';
  if (reference.kind === 'managed-spot-mandate') return 'Managed Spot action';
  return 'Autonomy action';
}
function amountLine(continuation: VerifiedMonadContinuation) {
  const {review, reviewDecimals, kind} = continuation;
  if (kind === 'wallet_swap') return null;
  if (kind === 'claim_ausd_faucet') return 'Amount set by the faucet';
  if (reviewDecimals === undefined || typeof review.asset !== 'string' || typeof review.amountUnits !== 'string') return null;
  try { return `${formatMonadUnits(review.amountUnits, reviewDecimals)} ${review.asset}`; } catch { return null; }
}
function maxFee(gasLimit: string, maxFeePerGas: string) {
  try { return `${formatMonadUnits((BigInt(gasLimit) * BigInt(maxFeePerGas)).toString(), 18)} MON`; }
  catch { return 'Unavailable'; }
}
function assetSymbol(value: unknown) {
  if (typeof value !== 'string') return 'token';
  if (/^0x534b2f3a21130d7a60830c2df862319e593943a3$/i.test(value)) return 'USDC';
  if (/^0xfb8bf4c1cc7a94c73d209a149ea2abea852bc541$/i.test(value)) return 'WMON';
  if (/^0xa9012a055bd4e0edf8ce09f960291c09d5322dc$/i.test(value)) return 'AUSD';
  return value;
}
