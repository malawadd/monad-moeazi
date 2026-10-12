import React, {useState} from 'react';
import {Pressable, Text} from 'react-native';
import type {MonadOperationExpectation} from '../services/monadValidation';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import type {PreparedMonadOperation} from '../types/monad';
import type {UserThemeTokens} from '../theme/userThemes';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';

type Result = {message: string; transactionHash?: string | null; status?: string; faucetTransferVerified?: boolean; verifiedAmountUnits?: string};

export function UserOperationReviewView({theme, prepared, expected, amount, asset, inputSymbol, outputSymbol, approvalSymbol,
  approvalDecimals, result, error, busy, attempted, unverifiedPoolReviewed, terminal, onBack, onAcknowledge, onSign, onCheck,
  onOpenActivity, onReturn}: {
  theme: UserThemeTokens; prepared: PreparedMonadOperation; expected: MonadOperationExpectation; amount: string; asset: string;
  inputSymbol: string; outputSymbol: string; approvalSymbol: string; approvalDecimals?: number; result: Result | null;
  error: string; busy: boolean; attempted: boolean; unverifiedPoolReviewed: boolean; terminal: boolean;
  onBack(): void; onAcknowledge(): void; onSign(): void; onCheck(): void; onOpenActivity(): void; onReturn?: {label: string; press(): void};
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const tx = prepared.transaction;
  const maximumFee = feeLabel(tx.gasLimit, tx.maxFeePerGas);
  const kindTitle = expected.kind.replaceAll('_', ' ');
  const walletSwap = prepared.kind === 'wallet_swap';
  const inputAmount = expected.amountInUnits ?? prepared.review?.amountInUnits;
  const minimumOutput = expected.minAmountOutUnits ?? prepared.review?.minAmountOutUnits;
  const inputPrecision = validDecimals(expected.inputDecimals ?? prepared.review?.inputDecimals);
  const outputPrecision = validDecimals(expected.outputDecimals ?? prepared.review?.outputDecimals);
  const swapTermsReady = !walletSwap || Boolean(positiveUnits(inputAmount) && positiveUnits(minimumOutput)
    && inputPrecision !== null && outputPrecision !== null && inputSymbol && outputSymbol
    && validAddress(expected.tokenIn ?? prepared.review?.tokenIn) && validAddress(expected.tokenOut ?? prepared.review?.tokenOut));
  const approvalAmount = prepared.review?.amountUnits ?? expected.amountUnits;
  const venueId = expected.venue ?? prepared.review?.venue;
  const approvalTermsReady = prepared.kind !== 'approve_token' || Boolean(positiveUnits(approvalAmount)
    && approvalDecimals !== undefined && validDecimals(approvalDecimals) !== null
    && validAddress(prepared.review?.tokenAddress ?? expected.tokenAddress)
    && validAddress(prepared.review?.spender ?? expected.spender));
  const reviewReady = swapTermsReady && approvalTermsReady;
  const signLabel = attempted ? 'Signature already submitted' : actionLabel(prepared.kind);
  return <UserPage theme={theme}>
    <UserButton label="Back" onPress={onBack} theme={theme} secondary disabled={busy} />
    <UserHeading theme={theme} kicker="MONAD TESTNET · FINAL REVIEW" title={humanize(kindTitle)}
      copy="Check the exact action and maximum network fee before approving with Mera." />
    {error ? <UserCard theme={theme}><UserText theme={theme} kind="title">Action needs attention</UserText>
      <UserText theme={theme}>{error}</UserText>
      {attempted ? <UserButton label="Check this transaction" onPress={onCheck} theme={theme} secondary loading={busy} /> : null}
    </UserCard> : null}
    {result ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">{result.faucetTransferVerified === false ? 'AUSD not yet confirmed' : result.status ? `Status · ${result.status}` : 'Transaction update'}</UserText>
      <UserText theme={theme}>{result.message}</UserText>
      {result.transactionHash ? <UserValueRow theme={theme} label="Transaction" value={shortHash(result.transactionHash)} /> : null}
      {result.faucetTransferVerified && result.verifiedAmountUnits
        ? <UserValueRow theme={theme} label="AUSD received · finalized receipt" value={`${formatMonadUnits(result.verifiedAmountUnits, 6)} AUSD`} /> : null}
      {!terminal ? <UserButton label="Check confirmation status" onPress={onCheck} theme={theme} secondary loading={busy} /> : null}
    </UserCard> : null}
    {expected.unverifiedPoolWarning ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Pool not verified</UserText>
      <UserText theme={theme}>Check the pool and minimum received. This swap may lose value.</UserText>
      <Pressable accessibilityRole="checkbox" accessibilityState={{checked: unverifiedPoolReviewed}} onPress={onAcknowledge}
        style={{minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10}}>
        <Text style={{fontSize: 22, color: theme.ink}}>{unverifiedPoolReviewed ? '☑' : '□'}</Text>
        <UserText theme={theme} style={{flex: 1}}>I reviewed this pool and want to continue.</UserText>
      </Pressable>
    </UserCard> : null}
    <UserCard theme={theme} texture>
      <UserValueRow theme={theme} label="Action" value={kindTitle} />
      {walletSwap ? <>
        <UserValueRow theme={theme} label="From" value={swapTermsReady ? `${formatMonadUnits(String(inputAmount), inputPrecision!)} ${inputSymbol}` : 'Unavailable · request a fresh swap review'} />
        <UserValueRow theme={theme} label="To · minimum received" value={swapTermsReady ? `${formatMonadUnits(String(minimumOutput), outputPrecision!)} ${outputSymbol}` : 'Unavailable'} />
      </> : null}
      {!walletSwap && (expected.amount || prepared.review?.amount)
        ? <UserValueRow theme={theme} label="Amount" value={`${amount} ${asset}`} /> : null}
      {expected.recipient || prepared.review?.recipient
        ? <UserValueRow theme={theme} label="Recipient" value={String(expected.recipient ?? prepared.review?.recipient)} /> : null}
      {prepared.kind === 'approve_token' ? <>
        <UserValueRow theme={theme} label="Exact allowance" value={approvalTermsReady
          ? `${formatMonadUnits(String(approvalAmount), approvalDecimals!)} ${approvalSymbol}` : 'Unavailable · approval review is incomplete'} />
        <UserValueRow theme={theme} label="Spender permission" value="Exact spender address shown in operation details" />
      </> : null}
      {venueId ? <UserValueRow theme={theme} label="Venue" value={humanVenue(venueId)} /> : null}
      <UserValueRow theme={theme} label="Maximum network fee" value={maximumFee} />
      <UserValueRow theme={theme} label="Review expires" value={formatMonadTimestamp(prepared.expiresAt)} />
      {prepared.kind === 'claim_ausd_faucet' ? <UserText theme={theme}>Your wallet pays the displayed network fee in MON. The faucet sends AUSD to your Mera address.</UserText> : null}
      {walletSwap ? <UserText theme={theme}>A swap can lose value. Review the minimum received and fee before signing.</UserText> : null}
      <UserButton label={signLabel} onPress={onSign} theme={theme}
        loading={busy} disabled={attempted || !reviewReady || Boolean(expected.unverifiedPoolWarning && !unverifiedPoolReviewed)} />
    </UserCard>
    {onReturn ? <UserButton label={onReturn.label} onPress={onReturn.press} theme={theme} secondary /> : null}
    <UserButton label="Open Activity" onPress={onOpenActivity} theme={theme} secondary />
    <UserDisclosure theme={theme} label="Operation details" value="Network and original ID" expanded={detailsOpen}
      onPress={() => setDetailsOpen(value => !value)}>
      <UserValueRow theme={theme} label="Original operation ID" value={prepared.operationId} />
      <UserValueRow theme={theme} label="Mera wallet" value={prepared.ownerAddress} />
      <UserValueRow theme={theme} label="Network" value="Monad Testnet · 10143" />
      <UserValueRow theme={theme} label="Transaction recipient" value={tx.to} />
      <UserValueRow theme={theme} label="Native value" value={`${formatMonadUnits(tx.value, 18)} MON`} />
      <UserValueRow theme={theme} label="Gas limit" value={tx.gasLimit} />
      <UserValueRow theme={theme} label="Maximum fee per gas" value={`${formatMonadUnits(tx.maxFeePerGas, 9)} gwei`} />
      <UserValueRow theme={theme} label="Maximum priority fee" value={`${formatMonadUnits(tx.maxPriorityFeePerGas, 9)} gwei`} />
      {expected.poolId ? <UserValueRow theme={theme} label="Pool ID" value={expected.poolId} /> : null}
      {expected.poolKey ? <UserValueRow theme={theme} label="Pool tokens · fee · tick · hooks"
        value={`${expected.poolKey.currency0} / ${expected.poolKey.currency1} · ${expected.poolKey.fee} · ${expected.poolKey.tickSpacing} · ${expected.poolKey.hooks}`} /> : null}
      {venueId ? <UserValueRow theme={theme} label="Venue identifier" value={String(venueId)} /> : null}
      {walletSwap ? <>
        <UserValueRow theme={theme} label="Input token address" value={String(expected.tokenIn ?? prepared.review?.tokenIn ?? 'Unavailable')} />
        <UserValueRow theme={theme} label="Output token address" value={String(expected.tokenOut ?? prepared.review?.tokenOut ?? 'Unavailable')} />
      </> : null}
      {prepared.kind === 'approve_token' ? <>
        <UserValueRow theme={theme} label="Approval spender address" value={String(prepared.review?.spender ?? expected.spender ?? 'Unavailable')} />
        <UserValueRow theme={theme} label="Approval token address" value={String(prepared.review?.tokenAddress ?? expected.tokenAddress ?? 'Unavailable')} />
      </> : null}
      {prepared.review?.summary ? <UserText theme={theme}>{prepared.review.summary}</UserText> : null}
    </UserDisclosure>
    {tx.data !== '0x' ? <UserDisclosure theme={theme} label="Contract call data" value="Show encoded request" expanded={dataOpen}
      onPress={() => setDataOpen(value => !value)}><UserText theme={theme}>{tx.data}</UserText></UserDisclosure> : null}
  </UserPage>;
}

function feeLabel(gasLimit: string, fee: string) {
  try { return `${formatMonadUnits((BigInt(gasLimit) * BigInt(fee)).toString(), 18)} MON`; } catch { return 'Unavailable'; }
}
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function shortHash(value: string) { return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value; }
function validDecimals(value: unknown): number | null { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 36 ? Number(value) : null; }
function positiveUnits(value: unknown): value is string { return typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n; }
function validAddress(value: unknown): boolean { return typeof value === 'string' && /^0x[a-f0-9]{40}$/i.test(value); }
function humanVenue(value: string) {
  const labels: Record<string, string> = {
    uniswap_v4_testnet: 'Uniswap v4 · Testnet',
    moeazi_test_amm: 'Moeazi Test AMM',
    moeazi_mock_pools_testnet: 'Moeazi mock pools · Testnet',
  };
  return labels[value] ?? 'Selected test venue';
}
function actionLabel(kind: string) {
  const labels: Record<string, string> = {send_mon: 'Send MON with Mera', send_usdc: 'Send USDC with Mera', approve_token: 'Approve exact amount with Mera',
    wallet_swap: 'Review swap with Mera', claim_ausd_faucet: 'Request test AUSD with Mera', wrap: 'Wrap MON with Mera', unwrap: 'Unwrap WMON with Mera',
    vault_deposit: 'Deposit into vault with Mera', vault_return: 'Return from vault with Mera', mandate_authorize: 'Authorize mandate with Mera',
    mandate_revoke: 'Revoke mandate with Mera', vault_stop: 'Stop vault mandate with Mera', vault_resume: 'Resume vault mandate with Mera', autonomy_recovery: 'Recover AUSD with Mera'};
  return labels[kind] ?? 'Continue with Mera';
}
