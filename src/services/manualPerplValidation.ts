import type {MonadEip1559Transaction} from '../types/monad';
import type {ManualPerplPreparedOperation, ManualPerplTransaction} from '../types/manualPerpl';
import {monadTimestampMillis} from './monadFormatting';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/i;
const UINT = /^(?:0|[1-9][0-9]*|0x[0-9a-f]+)$/i;

export type ManualReviewExpectation = {
  action: string;
  ownerAddress: string;
  venueId?: string;
  accountAddress?: string | null;
  marketId?: string;
  orderId?: string;
  amountUnits?: string;
  collateralAmountUnits?: string;
  side?: string;
  sizeUnits?: string;
  limitPrice?: string;
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
  if (prepared.review.chainId !== 10143 || typeof prepared.review.ownerAddress !== 'string'
      || prepared.review.ownerAddress.toLowerCase() !== expected.ownerAddress.toLowerCase()) {
    throw new Error('The prepared action does not match this Mera owner on Monad Testnet.');
  }
  const reviewAction = String(prepared.review.action ?? prepared.review.kind ?? prepared.action);
  if (prepared.action !== expected.action && reviewAction !== expected.action) {
    throw new Error('The prepared action differs from the requested manual Perpl action.');
  }
  compare(expected, prepared.review, 'venueId', 'venueId');
  compare(expected, prepared.review, 'accountAddress', 'accountAddress');
  compare(expected, prepared.review, 'marketId', 'marketId');
  compare(expected, prepared.review, 'orderId', 'orderId');
  compare(expected, prepared.review, 'amountUnits', 'amountUnits');
  compare(expected, prepared.review, 'side', 'side');
  compare(expected, prepared.review, 'sizeUnits', 'sizeUnits');
  compare(expected, prepared.review, 'limitPrice', 'limitPrice');
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
  if (String(prepared.review.transactionTarget ?? '').toLowerCase() !== transaction.to.toLowerCase()) {
    throw new Error('The transaction destination does not match the fresh manual Perpl review.');
  }
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

function compare(expected: ManualReviewExpectation, review: Record<string, unknown>, expectedKey: keyof ManualReviewExpectation, reviewKey: string) {
  const value = expected[expectedKey];
  if (value === undefined) return;
  const actual = review[reviewKey];
  if (String(actual ?? '').toLowerCase() !== String(value).toLowerCase()) {
    throw new Error(`The prepared review does not match the selected ${reviewKey}.`);
  }
}
