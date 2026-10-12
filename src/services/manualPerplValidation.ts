import {decodeFunctionData} from 'viem';
import type {MonadEip1559Transaction} from '../types/monad';
import type {ManualPerplAccountMode, ManualPerplOperationStatus, ManualPerplPreparedOperation, ManualPerplTransaction} from '../types/manualPerpl';
import {monadTimestampMillis} from './monadFormatting';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/i;
const UINT = /^(?:0|[1-9][0-9]*|0x[0-9a-f]+)$/i;
const APPROVE_ABI = [{type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{name: 'spender', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}]}] as const;
const CREATE_ACCOUNT_ABI = [{type: 'function', name: 'createAccount', stateMutability: 'nonpayable',
  inputs: [{name: 'amountCNS', type: 'uint256'}], outputs: [{type: 'uint256'}]}] as const;

export type ManualReviewExpectation = {
  action: string;
  ownerAddress: string;
  venueId?: string;
  accountMode?: ManualPerplAccountMode;
  accountAddress?: string | null;
  transactionTarget?: string;
  approvalSpender?: string;
  marketId?: string;
  orderId?: string;
  amountUnits?: string;
  collateralAmountUnits?: string;
  side?: string;
  sizeUnits?: string;
  limitPrice?: string;
  priceDecimals?: number;
  leverage?: number;
};

export function normalizeManualPerplTransaction(transaction: ManualPerplTransaction): MonadEip1559Transaction {
  if (transaction.chainId !== 10143 || !ADDRESS.test(transaction.to) || !HEX_DATA.test(transaction.data)
      || !UINT.test(transaction.value) || !UINT.test(transaction.nonce) || !UINT.test(transaction.gasLimit)
      || !UINT.test(transaction.maxFeePerGas) || !UINT.test(transaction.maxPriorityFeePerGas)
      || (transaction.type !== 2 && transaction.type !== 'eip1559')) {
    throw new Error('The prepared action is not a valid EIP-1559 transaction for Monad Testnet.');
  }
  if (BigInt(transaction.gasLimit) <= 0n || BigInt(transaction.maxPriorityFeePerGas) > BigInt(transaction.maxFeePerGas)) {
    throw new Error('The prepared action has an invalid gas limit or fee range.');
  }
  return {...transaction, type: 2};
}

export function validateManualPerplPreparation(prepared: ManualPerplPreparedOperation, expected: ManualReviewExpectation) {
  if (!prepared.operationId || prepared.status !== 'prepared' || prepared.chainId !== 10143
      || prepared.venueId !== (expected.venueId ?? 'perpl-direct-testnet-v1')) {
    throw new Error('The manual Perpl review is not bound to the expected Testnet venue and chain.');
  }
  const expiry = monadTimestampMillis(prepared.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('The manual Perpl review has expired. Prepare a fresh action.');
  if (prepared.review.expiresAt === undefined) throw new Error('The exact review expiry is missing.');
  const reviewedExpiry = monadTimestampMillis(prepared.review.expiresAt);
  if (!Number.isFinite(reviewedExpiry) || reviewedExpiry !== expiry) throw new Error('The review expiry differs from the prepared operation expiry.');
  if (prepared.review.chainId !== 10143 || typeof prepared.review.ownerAddress !== 'string'
      || prepared.review.ownerAddress.toLowerCase() !== expected.ownerAddress.toLowerCase()) {
    throw new Error('The prepared action does not match this Mera owner on Monad Testnet.');
  }
  const reviewAction = String(prepared.review.action ?? prepared.review.kind ?? '');
  if (prepared.action !== expected.action || reviewAction !== expected.action) {
    throw new Error('The prepared action differs from the requested manual Perpl action.');
  }
  compare(expected, prepared.review, 'venueId', 'venueId');
  compare(expected, prepared.review, 'accountMode', 'accountMode');
  compare(expected, prepared.review, 'accountAddress', 'accountAddress');
  compare(expected, prepared.review, 'marketId', 'marketId');
  compare(expected, prepared.review, 'orderId', 'orderId');
  compare(expected, prepared.review, 'amountUnits', 'amountUnits');
  compare(expected, prepared.review, 'side', 'side');
  compare(expected, prepared.review, 'sizeUnits', 'sizeUnits');
  if (expected.limitPrice !== undefined) compareLimitPrice(expected, prepared.review);
  compare(expected, prepared.review, 'leverage', 'leverage');
  if (expected.collateralAmountUnits !== undefined) {
    const orderDescription = prepared.review.orderDescription;
    const reviewedAmount = orderDescription && typeof orderDescription === 'object'
      ? (orderDescription as Record<string, unknown>).amountCNS : undefined;
    if (String(reviewedAmount ?? '') !== expected.collateralAmountUnits) {
      throw new Error('The prepared review does not match the selected collateralAmountUnits.');
    }
  }
  const transaction = normalizeManualPerplTransaction(prepared.transaction);
  if (expected.transactionTarget && transaction.to.toLowerCase() !== expected.transactionTarget.toLowerCase()) {
    throw new Error('The prepared transaction does not target the expected Perpl contract.');
  }
  if (String(prepared.review.transactionTarget ?? '').toLowerCase() !== transaction.to.toLowerCase()) {
    throw new Error('The transaction destination does not match the fresh manual Perpl review.');
  }
  if (typeof prepared.review.transactionData !== 'string' || prepared.review.transactionData.toLowerCase() !== transaction.data.toLowerCase()) {
    throw new Error('The transaction calldata does not match the fresh manual Perpl review.');
  }
  if (prepared.review.transactionNonce === undefined || !sameUint(prepared.review.transactionNonce, transaction.nonce)) {
    throw new Error('The transaction nonce does not match the fresh manual Perpl review.');
  }
  if (expected.action === 'approve') validateApprovalCalldata(transaction, expected);
  if (expected.action === 'open' && expected.amountUnits !== undefined) validateOpenCalldata(transaction, expected.amountUnits);
  const reviewedValue = prepared.review.transactionValue;
  if (reviewedValue === undefined || BigInt(String(reviewedValue)) !== BigInt(transaction.value)) {
    throw new Error('The native transaction value differs from the fresh manual Perpl review.');
  }
  const maxGas = prepared.review.maxGas;
  if (!maxGas || typeof maxGas !== 'object') throw new Error('The exact maximum gas review is missing.');
  const gas = maxGas as Record<string, unknown>;
  if (BigInt(String(gas.gasLimit)) !== BigInt(transaction.gasLimit)
      || BigInt(String(gas.maxFeePerGas)) !== BigInt(transaction.maxFeePerGas)
      || BigInt(String(gas.maxPriorityFeePerGas)) !== BigInt(transaction.maxPriorityFeePerGas)
      || BigInt(String(gas.maxCostWei)) !== BigInt(transaction.gasLimit) * BigInt(transaction.maxFeePerGas)) {
    throw new Error('The maximum gas review differs from the transaction Mera will sign.');
  }
}

export function validateManualPerplOperationStatus(status: ManualPerplOperationStatus, prepared: ManualPerplPreparedOperation,
  expected: ManualReviewExpectation, currentOwner: string) {
  const review = status.review;
  const expectedOwner = expected.ownerAddress.toLowerCase();
  const preparedOwner = String(prepared.review.ownerAddress ?? '').toLowerCase();
  const statusOwner = String(review?.ownerAddress ?? '').toLowerCase();
  const expiry = monadTimestampMillis(prepared.expiresAt);
  const statusExpiry = status.expiresAt === undefined ? Number.NaN : monadTimestampMillis(status.expiresAt);
  const reviewExpiry = review?.expiresAt === undefined ? Number.NaN : monadTimestampMillis(review.expiresAt as string | number);
  const action = String(expected.action);
  const reviewedAction = String(review?.action ?? review?.kind ?? '');
  const statusActionAliases: Record<string, string[]> = {
    approve: ['approve_collateral'], open: ['open_account'], deposit: ['deposit_collateral'],
    withdraw: ['withdraw_collateral'], legacy_withdraw: ['legacy_withdraw_collateral'], legacy_rescue: ['legacy_rescue_tokens'],
  };
  const statusActions = [prepared.action, ...(statusActionAliases[prepared.action] ?? [])];
  const statusName = String(status.status);
  const allowedStatuses = ['prepared', 'submitted', 'uncertain', 'finalized', 'failed', 'no_fill', 'expired'];
  const expectedAccount = expected.accountAddress !== undefined ? expected.accountAddress : prepared.review.accountAddress;
  const latestAccount = review?.accountAddress;
  const accountMatches = expectedAccount === undefined || (expectedAccount === null
    ? latestAccount === null || latestAccount === undefined
    : typeof latestAccount === 'string' && latestAccount.toLowerCase() === expectedAccount.toLowerCase());
  const expectedMarket = expected.marketId !== undefined ? expected.marketId : prepared.review.marketId;
  const marketMatches = expectedMarket === undefined || String(review?.marketId ?? '') === String(expectedMarket);
  if (status.operationId !== prepared.operationId || status.chainId !== 10143 || status.venueId !== prepared.venueId
      || !statusActions.includes(String(status.action)) || !allowedStatuses.includes(statusName)
      || !review || statusOwner !== expectedOwner || preparedOwner !== expectedOwner || currentOwner.toLowerCase() !== expectedOwner
      || prepared.action !== action || reviewedAction !== action || !accountMatches || !marketMatches
      || !Number.isFinite(expiry) || statusExpiry !== expiry || reviewExpiry !== expiry) {
    throw new Error('The manual Perpl status does not match this operation, action, account, owner, and market.');
  }
}

/** A first GET can return the exact sparse DTO produced while finality is being persisted. Re-read once by the same ID. */
export async function readValidatedManualPerplOperationStatus(read: (operationId: string) => Promise<ManualPerplOperationStatus>,
  prepared: ManualPerplPreparedOperation, expected: ManualReviewExpectation, currentOwner: string,
  isCurrent: () => boolean = () => true): Promise<ManualPerplOperationStatus | null> {
  let status = await read(prepared.operationId);
  if (!isCurrent()) return null;
  if (isSparseFinalizationDto(status, prepared)) {
    status = await read(prepared.operationId);
    if (!isCurrent()) return null;
  }
  validateManualPerplOperationStatus(status, prepared, expected, currentOwner);
  return status;
}

function isSparseFinalizationDto(status: ManualPerplOperationStatus, prepared: ManualPerplPreparedOperation) {
  const review = status.review;
  return status.operationId === prepared.operationId && status.chainId === 10143 && status.venueId === prepared.venueId
    && ['finalized', 'failed', 'no_fill'].includes(status.status) && status.action === undefined && status.expiresAt === undefined
    && /^0x[0-9a-f]{64}$/i.test(String(status.transactionHash ?? '')) && status.receipt === null
    && status.result === null && (status as ManualPerplOperationStatus & {errorCode?: unknown}).errorCode === null
    && sameKeys(status as unknown as Record<string, unknown>, ['chainId', 'errorCode', 'operationId', 'receipt', 'result', 'review', 'status', 'transactionHash', 'venueId'])
    && !!review && sameKeys(review, ['transactionData', 'transactionNonce', 'transactionTarget', 'transactionValue'])
    && review.transactionData === null && review.transactionNonce === null && review.transactionTarget === null
    && review.transactionValue === '0';
}

function sameKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort(); const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

/** The submit response only acknowledges the URL's operation ID. A same-ID GET is required before trusting status fields. */
export function validateManualPerplSubmissionAcknowledgement(response: unknown, operationId: string) {
  if (!response || typeof response !== 'object' || (response as Record<string, unknown>).operationId !== operationId) {
    throw new Error('The manual Perpl submission acknowledgement does not match the original operation ID.');
  }
}

function sameUint(left: unknown, right: string) {
  try { return BigInt(String(left)) === BigInt(right); } catch { return false; }
}

function validateApprovalCalldata(transaction: ManualPerplTransaction, expected: ManualReviewExpectation) {
  if (!expected.amountUnits || !expected.approvalSpender) throw new Error('The exact AUSD approval terms are missing from the manual review.');
  let decoded: {functionName: string; args: readonly unknown[]};
  try { decoded = decodeFunctionData({abi: APPROVE_ABI, data: transaction.data as `0x${string}`}); }
  catch { throw new Error('The reviewed AUSD transaction is not an ERC-20 approve call.'); }
  if (decoded.functionName !== 'approve' || String(decoded.args[0]).toLowerCase() !== expected.approvalSpender.toLowerCase()
      || !sameUint(decoded.args[1], expected.amountUnits)) {
    throw new Error('The AUSD approval spender or amount differs from the exact review.');
  }
}

function validateOpenCalldata(transaction: ManualPerplTransaction, amountUnits: string) {
  let decoded: {functionName: string; args: readonly unknown[]};
  try { decoded = decodeFunctionData({abi: CREATE_ACCOUNT_ABI, data: transaction.data as `0x${string}`}); }
  catch { throw new Error('The reviewed Perpl transaction is not an Exchange createAccount call.'); }
  if (decoded.functionName !== 'createAccount' || !sameUint(decoded.args[0], amountUnits)) {
    throw new Error('The Exchange createAccount deposit differs from the exact review.');
  }
}

function compare(expected: ManualReviewExpectation, review: Record<string, unknown>, expectedKey: keyof ManualReviewExpectation, reviewKey: string) {
  const value = expected[expectedKey];
  if (value === undefined) return;
  const actual = review[reviewKey];
  if (String(actual ?? '').toLowerCase() !== String(value).toLowerCase()) {
    throw new Error(`The prepared review does not match the selected ${reviewKey}.`);
  }
}

function compareLimitPrice(expected: ManualReviewExpectation, review: Record<string, unknown>) {
  const precision = expected.priceDecimals;
  const reviewedPrecision = review.priceDecimals;
  if (!Number.isSafeInteger(precision) || precision! < 0 || precision! > 36
      || reviewedPrecision !== precision
      || decimalUnits(expected.limitPrice, precision!) === null
      || decimalUnits(review.limitPrice, precision!) === null
      || decimalUnits(expected.limitPrice, precision!) !== decimalUnits(review.limitPrice, precision!)) {
    throw new Error('The prepared review does not match the selected limitPrice.');
  }
}

function decimalUnits(value: unknown, precision: number): bigint | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > precision) return null;
  try {
    const units = BigInt(whole) * 10n ** BigInt(precision) + BigInt((fraction + '0'.repeat(precision)).slice(0, precision) || '0');
    return units > 0n ? units : null;
  } catch { return null; }
}
