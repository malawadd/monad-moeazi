import React, {useEffect, useState} from 'react';
import {Pressable, Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, Notice, PageHeader} from '../components/Ui';
import {openMeraSigningSession} from '../services/wallet/meraAuth';
import {monadApi} from '../services/monadApi';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import {validatePreparedMonadOperation, type MonadOperationExpectation} from '../services/monadValidation';
import type {PreparedMonadOperation} from '../types/monad';
import {useApp} from '../state/AppContext';
import {invalidateAfterFinalizedOperation} from '../services/queryCache';
import {screenStyles as s} from '../theme/screenStyles';

type OperationResult = {message: string; transactionHash?: string | null; status?: string;
  faucetTransferVerified?: boolean; verifiedAmountUnits?: string};

export function OperationReviewScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const prepared = route.params?.prepared as PreparedMonadOperation | undefined;
  const expected = route.params?.expected as MonadOperationExpectation | undefined;
  const afterApproval = route.params?.afterApproval as {returnRoute?: string; returnParams?: unknown} | undefined;
  const approvalDecimals = Number(route.params?.approvalDecimals ?? 0);
  const approvalSymbol = String(route.params?.approvalSymbol ?? 'token');
  const inputSymbol = String(route.params?.inputSymbol ?? 'input token');
  const outputSymbol = String(route.params?.outputSymbol ?? 'output token');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<OperationResult | null>(null);
  const [unverifiedPoolReviewed, setUnverifiedPoolReviewed] = useState(false);

  useEffect(() => {
    if (ownerAddress && ['finalized', 'failed', 'reverted'].includes(result?.status ?? '')) {
      void invalidateAfterFinalizedOperation(ownerAddress);
    }
  }, [ownerAddress, result?.status]);
  useEffect(() => { setUnverifiedPoolReviewed(false); }, [expected?.poolId, expected?.quoteId]);

  async function signAndBroadcast() {
    if (!prepared || !expected || !ownerAddress) return;
    if (expected.unverifiedPoolWarning && !unverifiedPoolReviewed) {
      setError('Review and acknowledge the unverified pool warning before signing.');
      return;
    }
    setBusy(true); setAttempted(true); setError(''); setResult(null);
    let submitStarted = false;
    let session: Awaited<ReturnType<typeof openMeraSigningSession>> | undefined;
    try {
      validatePreparedMonadOperation(prepared, {...expected, ownerAddress});
      session = await openMeraSigningSession('signin');
      if (session.address.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error('The passkey opened a different Mera wallet. Nothing was signed.');
      const signedTransaction = await session.signEip1559Transaction(prepared.chainId, prepared.transaction);
      session.end(); session = undefined;
      submitStarted = true;
      const verified = await monadApi.submit(prepared.operationId, signedTransaction);
      if (['failed', 'expired'].includes(verified.status)) throw new Error(verified.message ?? `The signed transaction was ${verified.status}.`);
      const broadcast = await monadApi.broadcast(prepared.operationId);
      let latest = broadcast;
      const isApproval = prepared.kind === 'approve_token';
      const isAusdClaim = prepared.kind === 'claim_ausd_faucet';
      if ((isApproval || isAusdClaim) && !['finalized', 'failed', 'reverted', 'expired'].includes(latest.status)) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise<void>(resolve => setTimeout(resolve, 1500));
          try { latest = await monadApi.operation(prepared.operationId); } catch { break; }
          if (['finalized', 'failed', 'reverted', 'expired'].includes(latest.status)) break;
        }
      }
      const isFinalApproval = isApproval && latest.status === 'finalized';
      setResult({
        message: isFinalApproval
          ? 'The exact token approval is finalized. The server will recheck allowance before preparing the original action.'
          : latest.message ?? `The transaction is ${latest.status}. Check Activity for the recorded result.`,
        transactionHash: latest.transactionHash ?? broadcast.transactionHash ?? verified.transactionHash,
        status: latest.status,
        faucetTransferVerified: latest.faucetTransferVerified,
        verifiedAmountUnits: latest.verifiedAmountUnits,
      });
      if (['failed', 'reverted'].includes(latest.status)) setError(latest.message ?? 'The transaction failed on Monad Testnet.');
    } catch (reason) {
      if (!submitStarted) setAttempted(false);
      const message = reason instanceof Error ? reason.message : 'The transaction could not be signed or submitted.';
      setError(message);
      if (prepared?.operationId) {
        try {
          const latest = await monadApi.operation(prepared.operationId);
          if (latest.transactionHash || ['submitted', 'executed', 'finalized', 'failed'].includes(latest.status)) {
          setResult({message: latest.message ?? `Current operation status: ${latest.status}.`, transactionHash: latest.transactionHash,
            status: latest.status, faucetTransferVerified: latest.faucetTransferVerified, verifiedAmountUnits: latest.verifiedAmountUnits});
          }
        } catch { /* The original error remains visible when status cannot be reached. */ }
      }
    } finally {
      session?.end();
      setBusy(false);
    }
  }

  if (!prepared || !expected) return <FlowScreen><PageHeader kicker="Review" title="Request unavailable" copy="Return to the action and prepare a new server-reviewed request." /></FlowScreen>;
  const tx = prepared.transaction;
  const maxFeeWei = BigInt(tx.gasLimit) * BigInt(tx.maxFeePerGas);
  const feeInMon = formatMonadUnits(maxFeeWei.toString(), 18);
  const amount = expected.amount ?? prepared.review?.amount ?? 'Amount unavailable';
  const asset = String(route.params?.asset ?? expected.asset ?? prepared.review?.asset ?? 'Asset');
  const title = expected.kind.replaceAll('_', ' ');
  const terminal = ['finalized', 'failed', 'reverted', 'expired'].includes(result?.status ?? '');

  async function checkStatus() {
    if (!prepared) return;
    setBusy(true);
    try {
      const current = await monadApi.operation(prepared.operationId);
      setResult({message: current.message ?? `Current operation status: ${current.status}.`, transactionHash: current.transactionHash,
        status: current.status, faucetTransferVerified: current.faucetTransferVerified, verifiedAmountUnits: current.verifiedAmountUnits});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Operation status is unavailable.'); }
    finally { setBusy(false); }
  }

  return <FlowScreen>
    <PageHeader kicker="Final review" title="Check every detail" copy="Your passkey will sign this exact EIP-1559 transaction for Monad Testnet (10143)." />
    {error ? <Notice live tone="rose" title="Transaction needs attention" message={error} actionLabel="Check status" onAction={() => { void checkStatus(); }} /> : null}
    {result ? <Notice live tone={result.status === 'failed' || result.faucetTransferVerified === false ? 'rose' : 'mint'}
      title={result.faucetTransferVerified === false ? 'AUSD transfer not verified' : result.status ? `Status: ${result.status}` : 'Transaction update'}
      message={result.message} /> : null}
    {result?.faucetTransferVerified && result.verifiedAmountUnits ? <Card>
      <DataRow label="AUSD received · finalized receipt" value={`${formatMonadUnits(result.verifiedAmountUnits, 6)} AUSD`} />
    </Card> : null}
    {expected.unverifiedPoolWarning ? <Notice live tone="orange" title="Unverified pool warning"
      message="This pool is outside the operator verified list. Check the exact Pool ID, PoolKey, token contracts, fee, hooks, quote, and minimum output before signing." /> : null}
    <Card>
      <DataRow label="Action" value={title} />
      {expected.amount || prepared.review?.amount ? <DataRow label="Amount" value={`${amount} ${asset}`} /> : null}
      {expected.recipient || prepared.review?.recipient ? <DataRow label="Recipient" value={String(expected.recipient ?? prepared.review?.recipient)} /> : null}
      {expected.vaultAddress || prepared.review?.vaultAddress ? <DataRow label={prepared.kind === 'autonomy_recovery' ? 'Autonomy vault' : 'Managed vault'} value={String(expected.vaultAddress ?? prepared.review?.vaultAddress)} /> : null}
      {expected.venue || prepared.review?.venue ? <DataRow label="Venue" value={String(expected.venue ?? prepared.review?.venue)} /> : null}
      {expected.poolId ? <DataRow label="Exact v4 Pool ID" value={expected.poolId} /> : null}
      {expected.poolKey ? <DataRow label="Exact v4 PoolKey" value={`${expected.poolKey.currency0} / ${expected.poolKey.currency1} · fee ${expected.poolKey.fee} · tick ${expected.poolKey.tickSpacing} · hooks ${expected.poolKey.hooks}`} /> : null}
      {expected.poolId ? <DataRow label="Pool verification" value={expected.unverifiedPoolWarning ? 'Unverified · owner reviewed' : 'Operator verified'} /> : null}
      {prepared.kind === 'wallet_swap' ? <>
        <DataRow label="Exact input" value={`${formatMonadUnits(String(expected.amountInUnits ?? prepared.review?.amountInUnits ?? '0'), expected.inputDecimals ?? 18)} ${inputSymbol}`} />
        <DataRow label="Minimum output" value={`${formatMonadUnits(String(expected.minAmountOutUnits ?? prepared.review?.minAmountOutUnits ?? '0'), expected.outputDecimals ?? 18)} ${outputSymbol}`} />
        <DataRow label="Input token" value={String(expected.tokenIn ?? prepared.review?.tokenIn ?? 'Missing token')} />
        <DataRow label="Output token" value={String(expected.tokenOut ?? prepared.review?.tokenOut ?? 'Missing token')} />
      </> : null}
      <DataRow label="Mera wallet" value={prepared.ownerAddress} />
      <DataRow label="Network" value="Monad Testnet · 10143" />
      <DataRow label="Transaction recipient" value={tx.to} />
      <DataRow label="Native value" value={`${formatMonadUnits(tx.value, 18)} MON`} />
      <DataRow label="Gas limit" value={tx.gasLimit} />
      <DataRow label="Maximum priority fee" value={`${formatMonadUnits(tx.maxPriorityFeePerGas, 9)} gwei`} />
      <DataRow label="Maximum fee per gas" value={`${formatMonadUnits(tx.maxFeePerGas, 9)} gwei`} />
      <DataRow label="Maximum network fee" value={`${feeInMon} MON`} />
      <DataRow label="Expires" value={formatMonadTimestamp(prepared.expiresAt)} />
      {prepared.kind === 'approve_token' ? <>
        <DataRow label="Approval token" value={String(prepared.review?.tokenAddress ?? expected.tokenAddress ?? 'Missing token address')} />
        <DataRow label="Approval spender" value={String(prepared.review?.spender ?? expected.spender ?? 'Missing spender')} />
        <DataRow label="Exact allowance" value={`${formatMonadUnits(String(prepared.review?.amountUnits ?? expected.amountUnits ?? '0'), approvalDecimals)} ${approvalSymbol}`} />
        <DataRow label="Exact allowance · base units" value={String(prepared.review?.amountUnits ?? expected.amountUnits ?? 'Missing amount')} />
      </> : null}
      {prepared.kind === 'claim_ausd_faucet' ? <>
        <DataRow label="Faucet method" value={String(prepared.review?.method ?? 'Missing method')} />
        <DataRow label="AUSD recipient" value={String(expected.recipient ?? 'Missing Mera address')} />
        <DataRow label="Agora faucet contract" value={String(prepared.review?.faucetAddress ?? tx.to)} />
        <DataRow label="AUSD token contract" value={String(prepared.review?.tokenAddress ?? 'Missing token address')} />
        <Text style={s.body}>This request calls the Agora Monad Testnet faucet for your Mera address. It transfers no AUSD from your wallet; your wallet pays the displayed network fee in MON.</Text>
      </> : null}
    </Card>
    {expected.unverifiedPoolWarning ? <Pressable accessibilityRole="checkbox" accessibilityState={{checked: unverifiedPoolReviewed}}
      onPress={() => setUnverifiedPoolReviewed(value => !value)} style={styles.poolAcknowledgement}>
      <Text style={styles.poolCheckbox}>{unverifiedPoolReviewed ? '☑' : '□'}</Text>
      <Text style={s.body}>I reviewed this unverified pool and want to sign the exact transaction.</Text>
    </Pressable> : null}
    {tx.data !== '0x' ? <Card><Text style={s.strong}>Exact contract call data</Text><Text selectable style={s.body}>{tx.data}</Text></Card> : null}
    {prepared.review?.summary ? <Card><Text style={s.strong}>Server review</Text><Text style={s.body}>{prepared.review.summary}</Text></Card> : null}
    {result?.transactionHash ? <Card><DataRow label="Transaction hash" value={result.transactionHash} /></Card> : null}
    <Button label={attempted ? 'Signed request already sent' : 'Sign and broadcast'} onPress={() => { void signAndBroadcast(); }} loading={busy} disabled={attempted || Boolean(expected.unverifiedPoolWarning && !unverifiedPoolReviewed)} />
    {result && !terminal ? <Button label="Check confirmation status" variant="secondary" onPress={() => { void checkStatus(); }} loading={busy} /> : null}
    {prepared.kind === 'approve_token' && result?.status === 'finalized'
      && ['TradeReview', 'ManagedVault'].includes(afterApproval?.returnRoute ?? '')
      ? <Button label="Return to original action" variant="secondary" onPress={() => navigation.navigate(afterApproval?.returnRoute, afterApproval?.returnParams)} />
      : null}
    {prepared.kind === 'autonomy_recovery' && result ? <Button label="Return to run status" variant="secondary" onPress={() => navigation.navigate('AutonomyStatus')} /> : null}
    {prepared.kind === 'claim_ausd_faucet' && result?.status === 'finalized'
      ? <Button label="Return to AUSD balance" variant="secondary" onPress={() => navigation.navigate('Funding')} /> : null}
    <Button label="Open Activity" variant="secondary" onPress={() => navigation.navigate('Main', {screen: 'Activity'})} />
    <Text style={s.body}>Moeazi will verify your signature before it broadcasts. The Mera signing key stays in this short-lived passkey session and is cleared when signing ends.</Text>
  </FlowScreen>;
}

const styles = {poolAcknowledgement: {flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, minHeight: 52},
  poolCheckbox: {fontSize: 24, color: '#111111'}};
