import React, {useState} from 'react';
import {Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, Notice, PageHeader} from '../components/Ui';
import {manualPerplApi} from '../services/manualPerplApi';
import {normalizeManualPerplTransaction, validateManualPerplPreparation, type ManualReviewExpectation} from '../services/manualPerplValidation';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import {openMeraSigningSession} from '../services/wallet/meraAuth';
import type {ManualPerplOperationStatus, ManualPerplPreparedOperation} from '../types/manualPerpl';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';

export function ManualPerplReviewScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const prepared = route.params?.prepared as ManualPerplPreparedOperation | undefined;
  const expected = route.params?.expected as ManualReviewExpectation | undefined;
  const label = String(route.params?.label ?? prepared?.action ?? 'Manual Perpl action');
  const returnRoute = String(route.params?.returnRoute ?? 'PerplManualAccount');
  const [result, setResult] = useState<ManualPerplOperationStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);

  async function signAndSubmit() {
    if (!prepared || !expected || !ownerAddress || signed) return;
    setBusy(true); setError('');
    let session: Awaited<ReturnType<typeof openMeraSigningSession>> | undefined;
    let submitStarted = false;
    try {
      validateManualPerplPreparation(prepared, {...expected, ownerAddress});
      session = await openMeraSigningSession('signin');
      if (session.address.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error('The passkey opened a different Mera wallet. Nothing was signed.');
      const transaction = normalizeManualPerplTransaction(prepared.transaction);
      const signedTransaction = await session.signEip1559Transaction(10143, transaction);
      session.end(); session = undefined;
      if (!/^0x02[0-9a-f]+$/i.test(signedTransaction)) throw new Error('Mera did not return a valid signed Monad Testnet transaction.');
      submitStarted = true; setSigned(true);
      const submitted = await manualPerplApi.submit(prepared.operationId, signedTransaction);
      if (submitted.operationId !== prepared.operationId) throw new Error('The manual Perpl service returned a different operation. Check its original status before continuing.');
      let latest = submitted;
      if (['submitted', 'uncertain'].includes(latest.status)) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await delay(1_500);
          try { latest = await manualPerplApi.operation(prepared.operationId); } catch { break; }
          if (!['prepared', 'submitted', 'uncertain'].includes(latest.status)) break;
        }
      }
      setResult(latest);
    } catch (reason) {
      if (submitStarted) setSigned(true);
      setError(submitStarted
        ? `The signed action may still be processing. Check its status before taking another action. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The exact manual Perpl action could not be signed.');
    } finally { session?.end(); setBusy(false); }
  }

  async function checkStatus() {
    if (!prepared) return;
    setBusy(true); setError('');
    try {
      const latest = await manualPerplApi.operation(prepared.operationId);
      if (latest.operationId !== prepared.operationId) throw new Error('The service returned a different operation status.');
      setResult(latest);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The original operation status is unavailable.'); }
    finally { setBusy(false); }
  }

  if (!prepared || !expected) return <FlowScreen><PageHeader kicker="Manual Perpl review" title="Review unavailable" copy="Return to the account or market and request a fresh server review." /></FlowScreen>;
  let normalized;
  try { normalized = normalizeManualPerplTransaction(prepared.transaction); } catch { normalized = null; }
  const fee = normalized ? BigInt(normalized.gasLimit) * BigInt(normalized.maxFeePerGas) : null;
  const terminal = result && ['finalized', 'failed', 'no_fill'].includes(result.status);
  const tint = result?.status === 'failed' || result?.status === 'no_fill' ? 'rose' : result?.status === 'finalized' ? 'mint' : 'orange';

  return <FlowScreen>
    <PageHeader kicker="Final review · Mera signing" title="Check every transaction detail" copy="This exact action will be signed by your Mera owner on Monad Testnet. Each manual account or order action needs a fresh review and signature." />
    {error ? <Notice live tone="rose" title={signed ? 'Action may still be processing' : 'Review needs attention'} message={error} actionLabel={signed ? 'Check original operation' : undefined} onAction={signed ? () => { void checkStatus(); } : undefined} /> : null}
    {result ? <Notice live tone={tint} title={`Status · ${humanize(result.status)}`} message={result.message ?? statusMessage(result)} /> : null}
    <Card>
      <DataRow label="Action" value={label} />
      <DataRow label="Operation ID" value={prepared.operationId} />
      <DataRow label="Mera owner" value={ownerAddress ?? 'Unavailable'} />
      <DataRow label="Perpl account" value={String(prepared.review.accountAddress ?? 'See exact transaction')} />
      <DataRow label="Venue" value={String(prepared.venueId ?? prepared.review.venueId ?? 'Perpl Testnet')} />
      <DataRow label="Network" value="Monad Testnet · 10143" />
      <DataRow label="Prepared expiry" value={formatMonadTimestamp(prepared.expiresAt)} />
      {Object.entries(prepared.review).filter(([key, value]) => !['ownerAddress', 'chainId', 'accountAddress', 'venueId', 'marketId'].includes(key)
          && value !== null && value !== undefined && typeof value !== 'object').map(([key, value]) => <DataRow key={key} label={humanize(key)} value={String(value)} />)}
      {expected?.collateralAmountUnits ? <DataRow label="AUSD margin to add" value={`${formatMonadUnits(expected.collateralAmountUnits, 6)} AUSD`} /> : null}
    </Card>
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
    {result?.fill ? <Card><Text style={s.strong}>Finalized fill</Text><ScalarDetails record={result.fill} /></Card> : null}
    {result?.receipt ? <Card><Text style={s.strong}>Receipt and state evidence</Text><ScalarDetails record={result.receipt} /></Card> : null}
    <Button label={signed ? 'Signature already submitted' : 'Sign exact action with Mera'} onPress={() => { void signAndSubmit(); }} loading={busy} disabled={signed || !normalized} />
    {signed && !terminal ? <Button label="Check original operation status" variant="secondary" onPress={() => { void checkStatus(); }} loading={busy} /> : null}
    <Button label="Return to manual account" variant="secondary" onPress={() => navigation.navigate(returnRoute)} />
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
