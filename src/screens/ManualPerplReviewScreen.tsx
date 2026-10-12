import React, {useEffect, useRef, useState} from 'react';
import {Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, Notice, PageHeader} from '../components/Ui';
import {manualPerplApi} from '../services/manualPerplApi';
import {normalizeManualPerplTransaction, validateManualPerplPreparation,
  readValidatedManualPerplOperationStatus, validateManualPerplSubmissionAcknowledgement,
  type ManualReviewExpectation} from '../services/manualPerplValidation';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import {signAndSubmitWithMera} from '../services/meraSubmission';
import type {ManualPerplOperationStatus, ManualPerplPreparedOperation} from '../types/manualPerpl';
import {useApp} from '../state/AppContext';
import {invalidateAfterFinalizedOperation} from '../services/queryCache';
import {screenStyles as s} from '../theme/screenStyles';
import {usePreparedReviewGuard} from '../navigation/usePreparedReviewGuard';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {UserManualPerplReviewView} from './user-perpl/UserManualPerplReviewView';

export function ManualPerplReviewScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const {presentationMode, effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const prepared = route.params?.prepared as ManualPerplPreparedOperation | undefined;
  const expected = route.params?.expected as ManualReviewExpectation | undefined;
  const accountCreationSetup = route.params?.accountCreationSetup === true;
  const label = String(route.params?.label ?? prepared?.action ?? 'Manual Perpl action');
  const returnRoute = String(route.params?.returnRoute ?? 'PerplManualAccount');
  const [result, setResult] = useState<ManualPerplOperationStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);
  const ownerRef = useRef(ownerAddress);
  ownerRef.current = ownerAddress;
  const reviewGenerationRef = useRef(0);
  useEffect(() => {
    reviewGenerationRef.current += 1;
    setResult(null); setError(''); setBusy(false); setSigned(false);
  }, [ownerAddress, prepared?.operationId]);
  const reviewOwnerMatches = Boolean(ownerAddress && expected && prepared
    && ownerAddress.toLowerCase() === expected.ownerAddress.toLowerCase()
    && String(prepared.review.ownerAddress ?? '').toLowerCase() === ownerAddress.toLowerCase());
  usePreparedReviewGuard(Boolean(prepared) && reviewOwnerMatches && !signed);

  useEffect(() => {
    if (ownerAddress && reviewOwnerMatches && ['finalized', 'failed', 'no_fill'].includes(result?.status ?? '')) {
      void invalidateAfterFinalizedOperation(ownerAddress);
    }
  }, [ownerAddress, result?.status, reviewOwnerMatches]);
  async function signAndSubmit() {
    if (!prepared || !expected || !ownerAddress || !reviewOwnerMatches || signed) return;
    const snapshotOwner = ownerAddress.toLowerCase();
    const snapshotGeneration = reviewGenerationRef.current;
    const isCurrent = () => reviewGenerationRef.current === snapshotGeneration
      && ownerRef.current?.toLowerCase() === snapshotOwner;
    setBusy(true); setError('');
    let submitStarted = false;
    try {
      validateManualPerplPreparation(prepared, {...expected, ownerAddress});
      const transaction = normalizeManualPerplTransaction(prepared.transaction);
      const submitted = await signAndSubmitWithMera({ownerAddress,
        reference: {kind: 'manual-perpl-operation', id: prepared.operationId, action: 'submit'},
        sign: session => session.signEip1559Transaction(10143, transaction),
        validateSigned: signedTransaction => {
          if (!/^0x02[0-9a-f]+$/i.test(signedTransaction)) throw new Error('Mera did not return a valid signed Monad Testnet transaction.');
        },
        onSubmissionStarting: () => {
          if (!isCurrent()) throw new Error('The Mera owner changed while this review was open. Nothing was submitted.');
          submitStarted = true; setSigned(true);
        },
        submit: signedTransaction => manualPerplApi.submit(prepared.operationId, signedTransaction),
      });
      if (!isCurrent()) return;
      // Submit may return a sparse or transitional DTO. Trust it only as an
      // acknowledgement, then use the same-ID authenticated GET for state.
      validateManualPerplSubmissionAcknowledgement(submitted, prepared.operationId);
      let latest = await readValidatedManualPerplOperationStatus(manualPerplApi.operation, prepared, expected, snapshotOwner, isCurrent);
      if (!latest) return;
      if (['prepared', 'submitted', 'uncertain'].includes(latest.status)) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await delay(1_500);
          if (!isCurrent()) return;
          const polled = await readValidatedManualPerplOperationStatus(manualPerplApi.operation, prepared, expected, snapshotOwner, isCurrent);
          if (!polled) return;
          latest = polled;
          if (!['prepared', 'submitted', 'uncertain'].includes(latest.status)) break;
        }
      }
      const enriched = await enrichFinalizedDetails(latest, prepared, expected, snapshotOwner, isCurrent);
      if (isCurrent()) setResult(enriched);
    } catch (reason) {
      if (!isCurrent()) return;
      if (submitStarted) setSigned(true);
      setError(submitStarted
        ? `The signed action may still be processing. Check its status before taking another action. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The exact manual Perpl action could not be signed.');
    } finally { if (isCurrent()) setBusy(false); }
  }

  async function checkStatus() {
    if (!prepared || !expected || !ownerAddress || !reviewOwnerMatches) return;
    const snapshotOwner = ownerAddress.toLowerCase();
    const snapshotGeneration = reviewGenerationRef.current;
    const isCurrent = () => reviewGenerationRef.current === snapshotGeneration
      && ownerRef.current?.toLowerCase() === snapshotOwner;
    setBusy(true); setError('');
    try {
      const latest = await readValidatedManualPerplOperationStatus(manualPerplApi.operation, prepared, expected, snapshotOwner, isCurrent);
      if (!latest) return;
      const enriched = await enrichFinalizedDetails(latest, prepared, expected, snapshotOwner, isCurrent);
      if (isCurrent()) setResult(enriched);
    } catch (reason) { if (isCurrent()) setError(reason instanceof Error ? reason.message : 'The original operation status is unavailable.'); }
    finally { if (isCurrent()) setBusy(false); }
  }

  async function enrichFinalizedDetails(status: ManualPerplOperationStatus, operation: ManualPerplPreparedOperation,
    expectation: ManualReviewExpectation, snapshotOwner: string, isCurrent: () => boolean): Promise<ManualPerplOperationStatus> {
    if (presentationMode !== 'user' || status.status !== 'finalized' || !isCurrent()) return status;
    try {
      const latest = await readValidatedManualPerplOperationStatus(manualPerplApi.operation, operation, expectation, snapshotOwner, isCurrent);
      if (!latest) return status;
      if (latest.status !== 'finalized') return status;
      return {...status, ...latest, fill: latest.fill ?? status.fill, result: latest.result ?? status.result,
        receipt: latest.receipt ?? status.receipt, transactionHash: latest.transactionHash ?? status.transactionHash};
    } catch { return status; }
  }

  if (!prepared || !expected || !reviewOwnerMatches) return presentationMode === 'user'
    ? <UserManualPerplReviewView theme={theme} ownerAddress={ownerAddress} prepared={null} expected={null} label={label}
      accountCreationSetup={false} error={error || (prepared && expected ? 'This review belongs to another Mera wallet. Switch back to its owner to continue.' : '')}
      result={null} busy={busy} signed={false} normalized={null} maximumFee={null}
      approvalFinalized={false} creationReview={false} terminal={false} onSign={() => { void signAndSubmit(); }}
      onCheckStatus={() => { void checkStatus(); }} onReturn={() => navigation.goBack()} />
    : <FlowScreen><PageHeader kicker="Manual Perpl review" title="Review unavailable" copy={prepared && expected
      ? 'This review belongs to another Mera wallet. Switch back to its owner to continue.'
      : 'Return to the account or market and request a fresh server review.'} /></FlowScreen>;
  let normalized;
  try { normalized = normalizeManualPerplTransaction(prepared.transaction); } catch { normalized = null; }
  const fee = normalized ? BigInt(normalized.gasLimit) * BigInt(normalized.maxFeePerGas) : null;
  const terminal = result && ['finalized', 'failed', 'no_fill'].includes(result.status);
  const orderAction = ['market_entry', 'limit_entry', 'close_position', 'reduce_size', 'add_margin', 'amend_limit', 'cancel_limit'].includes(prepared.action);
  const hasFinalizedEvidence = Boolean(result?.fill?.length || result?.result || result?.receipt);
  const detailsRefreshNeeded = Boolean(signed && result?.status === 'finalized' && orderAction && !hasFinalizedEvidence);
  const approvalFinalized = accountCreationSetup && prepared.action === 'approve' && result?.status === 'finalized';
  const creationReview = accountCreationSetup && prepared.action === 'open';
  const estimatedEntryMarginUnits = prepared.review.estimatedEntryMarginUnits;
  const estimatedEntryFeeUnits = prepared.review.estimatedEntryFeeUnits;
  const hasEntryEstimates = ['market_entry', 'limit_entry'].includes(prepared.action)
    && (estimatedEntryMarginUnits !== undefined || estimatedEntryFeeUnits !== undefined);
  const tint = result?.status === 'failed' || result?.status === 'no_fill' ? 'rose' : result?.status === 'finalized' ? 'mint' : 'orange';

  if (presentationMode === 'user') return <UserManualPerplReviewView theme={theme} ownerAddress={ownerAddress} prepared={prepared}
    expected={expected} label={label} accountCreationSetup={accountCreationSetup} error={error} result={result} busy={busy} signed={signed}
    normalized={normalized} maximumFee={fee} approvalFinalized={Boolean(approvalFinalized)} creationReview={creationReview}
    terminal={Boolean(terminal)} detailsRefreshNeeded={detailsRefreshNeeded} onSign={() => { void signAndSubmit(); }} onCheckStatus={() => { void checkStatus(); }}
    onReturn={() => navigation.goBack()} />;

  return <FlowScreen>
    <PageHeader kicker={accountCreationSetup ? (creationReview ? 'Account setup · Step 2 of 2' : 'Account setup · Step 1 of 2') : 'Final review · Mera signing'}
      title={creationReview ? 'Review account creation' : 'Check every transaction detail'}
      copy={creationReview ? 'The finalized AUSD allowance is ready. This fresh createAccount transaction is separate and still needs your review and Mera signature.'
        : 'This exact action will be signed by your Mera owner on Monad Testnet. Each manual account or order action needs a fresh review and signature.'} />
    {error ? <Notice live tone="rose" title={signed ? 'Action may still be processing' : 'Review needs attention'} message={error} actionLabel={signed ? 'Check original operation' : undefined} onAction={signed ? () => { void checkStatus(); } : undefined} /> : null}
    {result ? <Notice live tone={tint} title={`Status · ${humanize(result.status)}`} message={result.message ?? statusMessage(result)} /> : null}
    {approvalFinalized ? <Notice live tone="mint" title="Step 1 of 2 complete · AUSD approval finalized"
      message="Your Perpl account is still not created. Return to the manual account screen to explicitly review account creation; that separate transaction needs its own fresh Mera signature." /> : null}
    {result?.transactionHash ? <Card><DataRow label="Transaction hash" value={result.transactionHash} /></Card> : null}
    <Card>
      <DataRow label="Action" value={label} />
      <DataRow label="Operation ID" value={prepared.operationId} />
      <DataRow label="Mera owner" value={ownerAddress ?? 'Unavailable'} />
      <DataRow label="Perpl account" value={String(prepared.review.accountAddress ?? 'See exact transaction')} />
      <DataRow label="Venue" value={String(prepared.venueId ?? prepared.review.venueId ?? 'Perpl Testnet')} />
      <DataRow label="Network" value="Monad Testnet · 10143" />
      <DataRow label="Prepared expiry" value={formatMonadTimestamp(prepared.expiresAt)} />
      {Object.entries(prepared.review).filter(([key, value]) => !['ownerAddress', 'chainId', 'accountAddress', 'venueId', 'marketId',
        'transactionTarget', 'transactionData', 'transactionNonce', 'transactionValue', 'expiresAt',
        'estimatedEntryMarginUnits', 'estimatedEntryFeeUnits'].includes(key)
          && value !== null && value !== undefined && typeof value !== 'object').map(([key, value]) => <DataRow key={key} label={humanize(key)} value={String(value)} />)}
      {expected?.collateralAmountUnits ? <DataRow label="AUSD margin to add" value={`${formatMonadUnits(expected.collateralAmountUnits, 6)} AUSD`} /> : null}
    </Card>
    {hasEntryEstimates ? <Card tint="#FFF6CE"><Text style={s.strong}>Server quote-time margin estimates</Text>
      {estimatedEntryMarginUnits !== undefined ? <DataRow label="Estimated entry margin" value={`${formatMonadUnits(String(estimatedEntryMarginUnits), 6)} AUSD`} /> : null}
      {estimatedEntryFeeUnits !== undefined ? <DataRow label="Estimated entry fee · taker reserve" value={`${formatMonadUnits(String(estimatedEntryFeeUnits), 6)} AUSD`} /> : null}
      <Text style={s.body}>These estimates use the fresh quote used to prepare this exact transaction. Final fees and margin can differ; finalized Perpl state is authoritative.</Text>
    </Card> : null}
    {prepared.action === 'amend_limit' && prepared.review.existingOrder && typeof prepared.review.existingOrder === 'object' ? <Card>
      <Text style={s.strong}>Existing limit order terms</Text>
      <ExistingOrderTerms record={prepared.review.existingOrder as Record<string, unknown>} priceDecimals={Number(prepared.review.priceDecimals ?? 0)}
        sizeDecimals={Number(prepared.review.sizeDecimals ?? 0)} side={String(prepared.review.side ?? 'Unavailable')}
        symbol={String(prepared.review.symbol ?? 'Perpl')} />
    </Card> : null}
    {normalized && fee !== null ? <Card>
      <Text style={s.strong}>Exact EIP-1559 transaction</Text>
      <DataRow label="Destination" value={normalized.to} />
      <DataRow label="Native value" value={`${formatMonadUnits(normalized.value, 18)} MON`} />
      <DataRow label="Gas limit" value={normalized.gasLimit} />
      <DataRow label="Maximum fee per gas" value={`${formatMonadUnits(normalized.maxFeePerGas, 9)} gwei`} />
      <DataRow label="Maximum priority fee" value={`${formatMonadUnits(normalized.maxPriorityFeePerGas, 9)} gwei`} />
      <DataRow label="Maximum network fee" value={`${formatMonadUnits(fee.toString(), 18)} MON`} />
      <DataRow label="Nonce" value={normalized.nonce} />
      <Text style={s.meta}>Transaction data</Text><Text selectable style={s.body}>{normalized.data}</Text>
    </Card> : null}
    {result?.fill ? <Card><Text style={s.strong}>Finalized fill</Text><ScalarDetails record={result.fill as unknown as Record<string, unknown>} /></Card> : null}
    {result?.result ? <Card><Text style={s.strong}>Finalized exchange result</Text><ScalarDetails record={result.result} /></Card> : null}
    {result?.receipt ? <Card><Text style={s.strong}>Receipt and state evidence</Text><ScalarDetails record={result.receipt} /></Card> : null}
    <Button label={signed ? 'Signature already submitted' : creationReview ? 'Review and sign account creation with Mera' : 'Sign exact action with Mera'} onPress={() => { void signAndSubmit(); }} loading={busy} disabled={signed || !normalized} />
    {signed && !terminal ? <Button label="Check original operation status" variant="secondary" onPress={() => { void checkStatus(); }} loading={busy} /> : null}
    {approvalFinalized ? <Button label="Return to account setup · review creation" onPress={() => navigation.navigate(returnRoute)} />
      : <Button label="Return to manual account" variant="secondary" onPress={() => navigation.navigate(returnRoute)} />}
    <Text style={s.body}>A submitted or uncertain action remains locked to this operation ID. Moeazi records a fill only after the receipt and Perpl account state agree at finality.</Text>
  </FlowScreen>;
}

function ScalarDetails({record}: {record: Record<string, unknown>}) {
  return <>{Object.entries(record).filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object').map(([key, value]) =>
    <DataRow key={key} label={humanize(key)} value={String(value)} />)}</>;
}
function ExistingOrderTerms({record, priceDecimals, sizeDecimals, side, symbol}: {record: Record<string, unknown>; priceDecimals: number; sizeDecimals: number; side: string; symbol: string}) {
  return <>
    <DataRow label="Direction" value={side} />
    <DataRow label="Size" value={`${formatMonadUnits(String(record.size ?? ''), sizeDecimals)} ${symbol}`} />
    <DataRow label="Current limit price · AUSD" value={formatMonadUnits(String(record.price ?? ''), priceDecimals)} />
    <DataRow label="Expiry block" value={String(record.expiryBlock ?? 'Not returned')} />
  </>;
}
function humanize(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function statusMessage(result: ManualPerplOperationStatus) {
  if (result.status === 'finalized') return 'The receipt and finalized Perpl account state were reconciled.';
  if (result.status === 'no_fill') return 'The order was finalized without a fill.';
  if (result.status === 'failed') return 'The manual Perpl action failed; review its recorded receipt before starting another action.';
  return 'The service is still reconciling the original signed action.';
}
function delay(milliseconds: number) { return new Promise<void>(resolve => setTimeout(resolve, milliseconds)); }
