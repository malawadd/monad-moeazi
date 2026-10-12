import React, {useState} from 'react';
import type {ManualReviewExpectation} from '../../services/manualPerplValidation';
import type {ManualPerplFill, ManualPerplOperationStatus, ManualPerplPreparedOperation} from '../../types/manualPerpl';
import type {MonadEip1559Transaction} from '../../types/monad';
import type {UserThemeTokens} from '../../theme/userThemes';
import {formatMonadTimestamp, formatMonadUnits} from '../../services/monadFormatting';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../../components/user/UserPrimitives';

export function UserManualPerplReviewView({theme, ownerAddress, prepared, expected, label, accountCreationSetup, error, result, detailsRefreshNeeded = false,
  busy, signed, normalized, maximumFee, approvalFinalized, creationReview, terminal, onSign, onCheckStatus, onReturn}: {
  theme: UserThemeTokens; ownerAddress: string | null; prepared: ManualPerplPreparedOperation | null; expected: ManualReviewExpectation | null;
  label: string; accountCreationSetup: boolean; error: string; result: ManualPerplOperationStatus | null; busy: boolean; signed: boolean;
  normalized: MonadEip1559Transaction | null; maximumFee: bigint | null; approvalFinalized: boolean; creationReview: boolean; terminal: boolean;
  detailsRefreshNeeded?: boolean;
  onSign(): void; onCheckStatus(): void; onReturn(): void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  if (!prepared || !expected) return <UserPage theme={theme}>
    <UserHeading theme={theme} kicker="Perpl · Mera review" title="Review unavailable" copy="Return to the account or market and request a fresh review." />
    <UserButton label="Return to Perpl" onPress={onReturn} theme={theme} secondary />
  </UserPage>;

  const sizeDecimals = precision(prepared.review.sizeDecimals);
  const priceDecimals = precision(prepared.review.priceDecimals);
  const symbol = String(prepared.review.symbol ?? 'Perpl market');
  const primaryLabel = actionButton(prepared.action, creationReview);
  const exactSize = expected.sizeUnits && sizeDecimals !== null
    ? `${formatMonadUnits(expected.sizeUnits, sizeDecimals)} ${symbol}` : null;
  const flow = transferFlow(prepared.action);
  const feeAvailable = maximumFee !== null && maximumFee > 0n;
  const canApprove = Boolean(normalized && feeAvailable && (!expected.sizeUnits || sizeDecimals !== null));
  const managementAction = ['close_position', 'reduce_size', 'add_margin', 'amend_limit', 'cancel_limit'].includes(prepared.action);
  const marketId = prepared.review.marketId === undefined ? null : String(prepared.review.marketId);
  const side = expected.side ?? (typeof prepared.review.side === 'string' ? prepared.review.side : null);
  const hasEntryEstimates = ['market_entry', 'limit_entry'].includes(prepared.action)
    && (validEstimate(prepared.review.estimatedEntryMarginUnits) || validEstimate(prepared.review.estimatedEntryFeeUnits));

  return <UserPage theme={theme}>
    <UserButton label="Back" onPress={onReturn} theme={theme} secondary disabled={busy} />
    <UserHeading theme={theme} kicker={accountCreationSetup ? (creationReview ? 'Perpl account · Step 2 of 2' : 'Perpl account · Step 1 of 2') : 'Perpl · Mera review'}
      title={creationReview ? 'Open Perpl account' : 'Review this action'} copy="Check what changes and the maximum network fee before approving with Mera." />
    {error ? <UserCard theme={theme}><UserText theme={theme} kind="title">{signed ? 'Action still being checked' : 'Review needs attention'}</UserText>
      <UserText theme={theme}>{error}</UserText>{signed ? <UserButton label="Check original action" onPress={onCheckStatus} theme={theme} secondary loading={busy} /> : null}</UserCard> : null}
    {result ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">{statusTitle(result.status)}</UserText>
      <UserText theme={theme}>{result.message ?? statusMessage(result.status)}</UserText>
      {result.transactionHash ? <UserValueRow theme={theme} label="Transaction" value={shortHash(result.transactionHash)} /> : null}
      {approvalFinalized ? <UserText theme={theme}>Approval is complete. Opening and funding the account is a separate action.</UserText> : null}
      {result.fill?.length ? <FillSummary theme={theme} fills={result.fill} result={result.result ?? null}
        sizeDecimals={sizeDecimals} priceDecimals={priceDecimals} /> : null}
      {result.result ? <ResultSummary theme={theme} result={result.result} sizeDecimals={sizeDecimals} priceDecimals={priceDecimals} /> : null}
      {result.receipt ? <UserDisclosure theme={theme} label="Receipt details" value="Network receipt" expanded={receiptOpen} onPress={() => setReceiptOpen(value => !value)}>
        {Object.entries(result.receipt).map(([key, value]) => <UserValueRow key={key} theme={theme} label={humanize(key)} value={receiptValue(value)} />)}
      </UserDisclosure> : null}
      {signed && (!terminal || detailsRefreshNeeded) ? <UserButton label={detailsRefreshNeeded ? 'Refresh finalized fills and receipt' : 'Refresh original status'}
        onPress={onCheckStatus} theme={theme} secondary loading={busy} /> : null}
    </UserCard> : null}

    <UserCard theme={theme} texture>
      <UserText theme={theme} kind="title">{label}</UserText>
      {managementAction ? <>
        <UserValueRow theme={theme} label="Perpl market" value={symbol} detail={marketId ? `Market ${marketId}` : undefined} />
        {side ? <UserValueRow theme={theme} label="Position direction" value={humanize(side)} /> : null}
        {expected.orderId ? <UserValueRow theme={theme} label="Order" value={String(expected.orderId)} /> : null}
      </> : null}
      {flow ? <UserValueRow theme={theme} label="From → to" value={`${flow.from} → ${flow.to}`} /> : null}
      {expected.amountUnits ? <UserValueRow theme={theme} label={prepared.action === 'approve' ? 'AUSD allowance' : 'AUSD amount'}
        value={`${formatMonadUnits(expected.amountUnits, 6)} AUSD`} /> : null}
      {expected.collateralAmountUnits ? <UserValueRow theme={theme} label="AUSD margin to add" value={`${formatMonadUnits(expected.collateralAmountUnits, 6)} AUSD`} /> : null}
      {expected.sizeUnits ? <UserValueRow theme={theme} label="Order" value={exactSize ?? 'Size precision unavailable'}
        detail={`${expected.side ? humanize(expected.side) : 'Direction unavailable'}${expected.leverage ? ` · ${expected.leverage}×` : ''}${expected.limitPrice ? ` · Limit ${expected.limitPrice} AUSD` : ''}`} /> : null}
      <UserValueRow theme={theme} label="Maximum network fee" value={feeAvailable ? `${formatMonadUnits(maximumFee.toString(), 18)} MON` : 'Unavailable'} />
      {['market_entry', 'limit_entry'].includes(prepared.action) ? <UserText theme={theme} kind="meta">Final fees and fills may differ from the estimate.</UserText> : null}
    </UserCard>
    <UserButton label={signed ? 'Signature already submitted' : primaryLabel} onPress={onSign} theme={theme} loading={busy} disabled={signed || !canApprove} />
    {!canApprove && !signed ? <UserText theme={theme} kind="meta">The exact transaction fee or order size cannot be shown safely, so this review is disabled.</UserText> : null}
    {signed && (!terminal || detailsRefreshNeeded) ? <UserButton label={detailsRefreshNeeded ? 'Refresh finalized fills and receipt' : 'Check original operation status'}
      onPress={onCheckStatus} theme={theme} secondary loading={busy} /> : null}
    {approvalFinalized ? <UserButton label="Return to account setup" onPress={onReturn} theme={theme} />
      : <UserButton label="Return to Perpl" onPress={onReturn} theme={theme} secondary />}
    {normalized ? <UserDisclosure theme={theme} label="Operation and network details" value="Reference and transaction" expanded={detailsOpen} onPress={() => setDetailsOpen(value => !value)}>
      {expected.orderId ? <UserValueRow theme={theme} label="Open order ID" value={String(expected.orderId)} /> : null}
      {expected.action === 'amend_limit' && prepared.review.existingOrder && typeof prepared.review.existingOrder === 'object'
        ? <UserValueRow theme={theme} label="Current limit price" value={existingPrice(prepared.review.existingOrder, priceDecimals)} detail="Size and direction stay unchanged" /> : null}
      {hasEntryEstimates
        ? <UserValueRow theme={theme} label="Server estimates" value={estimateSummary(prepared.review.estimatedEntryMarginUnits, prepared.review.estimatedEntryFeeUnits)} /> : null}
      <UserValueRow theme={theme} label="Original operation ID" value={prepared.operationId} />
      <UserValueRow theme={theme} label="Mera owner" value={ownerAddress ?? 'Unavailable'} />
      <UserValueRow theme={theme} label="Perpl account" value={String(prepared.review.accountAddress ?? 'Unavailable')} />
      <UserValueRow theme={theme} label="Network" value="Monad Testnet · 10143" />
      <UserValueRow theme={theme} label="Review expires" value={formatMonadTimestamp(prepared.expiresAt)} />
      <UserValueRow theme={theme} label="Destination" value={normalized.to} />
      <UserValueRow theme={theme} label="Native value" value={`${formatMonadUnits(normalized.value, 18)} MON`} />
      <UserValueRow theme={theme} label="Gas limit" value={normalized.gasLimit} />
      <UserValueRow theme={theme} label="Maximum fee per gas" value={`${formatMonadUnits(normalized.maxFeePerGas, 9)} gwei`} />
      <UserValueRow theme={theme} label="Maximum priority fee" value={`${formatMonadUnits(normalized.maxPriorityFeePerGas, 9)} gwei`} />
      <UserValueRow theme={theme} label="Nonce" value={normalized.nonce} />
      <UserText theme={theme} kind="meta">Transaction data · {normalized.data}</UserText>
    </UserDisclosure> : null}
  </UserPage>;
}

function FillSummary({theme, fills, result, sizeDecimals, priceDecimals}: {
  theme: UserThemeTokens; fills: ManualPerplFill[]; result: Record<string, unknown> | null; sizeDecimals: number | null; priceDecimals: number | null;
}) {
  const sizeScale = precision(result?.sizeDecimals) ?? sizeDecimals;
  const priceScale = precision(result?.priceDecimals) ?? priceDecimals;
  return <>
    {fills.map((fill, index) => <React.Fragment key={`${fill.kind ?? 'fill'}:${index}`}>
      {typeof fill.lotLNS === 'string' ? <UserValueRow theme={theme} label="Filled size" value={scaled(fill.lotLNS, sizeScale, 'base units unavailable')} /> : null}
      {typeof fill.pricePNS === 'string' ? <UserValueRow theme={theme} label="Fill price" value={scaled(fill.pricePNS, priceScale, 'price precision unavailable')} /> : null}
      {typeof fill.feeCNS === 'string' ? <UserValueRow theme={theme} label="Fill fee" value={`${formatMonadUnits(fill.feeCNS, 6)} AUSD`} /> : null}
      {typeof fill.amountCNS === 'string' ? <UserValueRow theme={theme} label="Fill amount" value={`${formatMonadUnits(fill.amountCNS, 6)} AUSD`} /> : null}
    </React.Fragment>)}
  </>;
}

function ResultSummary({theme, result, sizeDecimals, priceDecimals}: {
  theme: UserThemeTokens; result: Record<string, unknown>; sizeDecimals: number | null; priceDecimals: number | null;
}) {
  const sizeScale = precision(result.sizeDecimals) ?? sizeDecimals;
  const priceScale = precision(result.priceDecimals) ?? priceDecimals;
  return <>
    {typeof result.feeUnits === 'string' ? <UserValueRow theme={theme} label="Finalized fees" value={`${formatMonadUnits(result.feeUnits, 6)} AUSD`} /> : null}
    {typeof result.fundingUnits === 'string' ? <UserValueRow theme={theme} label="Funding" value={`${formatMonadUnits(result.fundingUnits, 6)} AUSD`} /> : null}
    {typeof result.afterPositionSize === 'string' ? <UserValueRow theme={theme} label="Position after action" value={scaled(result.afterPositionSize, sizeScale, 'size precision unavailable')} /> : null}
    {typeof result.afterPositionEntryPrice === 'string' ? <UserValueRow theme={theme} label="Entry price after action" value={scaled(result.afterPositionEntryPrice, priceScale, 'price precision unavailable')} /> : null}
  </>;
}

function transferFlow(action: string): {from: string; to: string} | null {
  if (action === 'approve') return {from: 'Mera wallet', to: 'Perpl allowance'};
  if (action === 'open' || action === 'deposit') return {from: 'Mera wallet', to: 'Perpl account'};
  if (action === 'withdraw' || action === 'legacy_withdraw') return {from: 'Perpl account', to: 'Mera wallet'};
  if (action === 'legacy_rescue') return {from: 'Recovery contract', to: 'Mera wallet'};
  return null;
}
function actionButton(action: string, creationReview: boolean) {
  if (creationReview) return 'Open Perpl account with Mera';
  if (action === 'market_entry') return 'Place market order with Mera';
  if (action === 'limit_entry') return 'Place limit order with Mera';
  if (action === 'approve') return 'Approve AUSD with Mera';
  if (action === 'open') return 'Open Perpl account with Mera';
  if (action === 'deposit') return 'Deposit AUSD with Mera';
  if (action === 'withdraw' || action === 'legacy_withdraw') return 'Withdraw AUSD with Mera';
  if (action === 'legacy_rescue') return 'Return legacy AUSD with Mera';
  if (action === 'close_position') return 'Close position with Mera';
  if (action === 'reduce_size') return 'Reduce position with Mera';
  if (action === 'cancel_limit') return 'Cancel order with Mera';
  if (action === 'amend_limit') return 'Change limit with Mera';
  if (action === 'add_margin') return 'Add margin with Mera';
  return 'Sign this action with Mera';
}
function estimateSummary(margin: unknown, fee: unknown) {
  const marginText = validEstimate(margin) ? `${formatMonadUnits(String(margin), 6)} AUSD margin` : null;
  const feeText = validEstimate(fee) ? `${formatMonadUnits(String(fee), 6)} AUSD fee` : null;
  return [marginText, feeText].filter(Boolean).join(' · ');
}
function validEstimate(value: unknown) { return typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value); }
function existingPrice(value: unknown, decimals: number | null) {
  if (!value || typeof value !== 'object' || decimals === null) return 'Unavailable';
  const record = value as Record<string, unknown>;
  if (typeof record.pricePNS !== 'string') return 'Unavailable';
  return formatMonadUnits(record.pricePNS, decimals);
}
function scaled(value: string, decimals: number | null, missing: string) { return decimals === null ? missing : formatMonadUnits(value, decimals); }
function precision(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 18 ? value : null; }
function receiptValue(value: unknown) { return value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? 'Unavailable'); }
function statusTitle(status: ManualPerplOperationStatus['status']) {
  if (status === 'finalized') return 'Action finalized';
  if (status === 'failed') return 'Action failed';
  if (status === 'no_fill') return 'Order finalized without a fill';
  return 'Action still being checked';
}
function statusMessage(status: ManualPerplOperationStatus['status']) {
  if (status === 'finalized') return 'The service reconciled the receipt and Perpl account state.';
  if (status === 'failed') return 'The service recorded a failed action. Check its receipt before starting another.';
  if (status === 'no_fill') return 'The order was finalized without a fill.';
  return 'Check this same operation before taking another action.';
}
function shortHash(value: string) { return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value; }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
