import {monadApi} from './monadApi';
import {monadTimestampMillis} from './monadFormatting';
import type {MonadOperationKind, MonadOperationStatus, PreparedMonadOperation} from '../types/monad';
import type {PendingOperationReference} from './pendingOperationJournal';
import {MONAD_AUSD_ADDRESS} from '../config/monadAUsd';

export type VerifiedMonadContinuation = {
  operationId: string; ownerAddress: string; chainId: 10143; kind: MonadOperationKind;
  status: 'verified'; expiresAt: string | number; transactionType: 'eip1559';
  transaction: PreparedMonadOperation['transaction']; review: Record<string, unknown>; reviewDecimals?: number; reviewFingerprint: string;
};

const KNOWN_KINDS = new Set<MonadOperationKind>(['send_mon', 'send_usdc', 'claim_ausd_faucet', 'wrap', 'unwrap',
  'vault_deposit', 'vault_return', 'wallet_swap', 'approve_token', 'mandate_authorize', 'mandate_revoke',
  'vault_stop', 'vault_resume', 'autonomy_recovery']);
const KNOWN_STATUSES = new Set(['prepared', 'verified', 'submitted', 'executed', 'finalized', 'failed', 'expired', 'reverted']);
const ADDRESS = /^0x[a-f0-9]{40}$/i;
const HEX = /^0x(?:[a-f0-9]{2})*$/i;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const broadcastLocks = new Set<string>();

export async function readOwnerMonadOperation(ownerAddress: string, operationId: string): Promise<MonadOperationStatus> {
  const row: unknown = await monadApi.operation(operationId);
  return validateOwnerMonadOperation(row, ownerAddress, operationId);
}

export function validateOwnerMonadOperation(value: unknown, ownerAddress: string, operationId: string): MonadOperationStatus {
  const row = object(value);
  if (!row || row.operationId !== operationId || typeof row.ownerAddress !== 'string'
      || !ADDRESS.test(row.ownerAddress) || row.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()
      || row.chainId !== 10143 || typeof row.kind !== 'string' || !KNOWN_KINDS.has(row.kind as MonadOperationKind)
      || typeof row.status !== 'string' || !KNOWN_STATUSES.has(row.status)) {
    throw new Error('The saved operation status did not match this Mera owner and original Monad operation.');
  }
  return row as unknown as MonadOperationStatus;
}

export function verifiedContinuationFromStatus(value: MonadOperationStatus, ownerAddress: string, operationId: string): VerifiedMonadContinuation | null {
  if (value.status !== 'verified') return null;
  try { return validateVerifiedContinuation(value, ownerAddress, operationId); }
  catch { return null; }
}

export async function broadcastVerifiedMonadOperation(ownerAddress: string, reference: PendingOperationReference,
  reviewed: VerifiedMonadContinuation): Promise<MonadOperationStatus> {
  if (reference.kind !== 'monad-operation' || reference.action !== 'submit' || reference.id !== reviewed.operationId) {
    throw new Error('Only the reviewed original Monad operation can continue.');
  }
  const lockKey = `${ownerAddress.toLowerCase()}:${reference.id}`;
  if (broadcastLocks.has(lockKey)) throw new Error('This original operation is already being continued.');
  broadcastLocks.add(lockKey);
  try {
    const current = await readOwnerMonadOperation(ownerAddress, reference.id);
    const fresh = validateVerifiedContinuation(current, ownerAddress, reference.id);
    if (!sameReviewedOperation(reviewed, fresh)) {
      throw new Error('The saved operation review changed. Check its status and review the latest details before continuing.');
    }
    const response = await monadApi.broadcast(reference.id);
    return validateOwnerMonadOperation(response, ownerAddress, reference.id);
  } finally { broadcastLocks.delete(lockKey); }
}

function validateVerifiedContinuation(value: MonadOperationStatus, ownerAddress: string, operationId: string): VerifiedMonadContinuation {
  const row = validateOwnerMonadOperation(value, ownerAddress, operationId) as MonadOperationStatus & Record<string, unknown>;
  if (row.status !== 'verified' || (typeof row.expiresAt !== 'string' && typeof row.expiresAt !== 'number')
      || !Number.isFinite(monadTimestampMillis(row.expiresAt)) || monadTimestampMillis(row.expiresAt) <= Date.now()
      || row.transactionType !== 'eip1559') throw new Error('This operation is no longer eligible for explicit continuation.');
  const transaction = object(row.transaction);
  if (!transaction || transaction.chainId !== 10143 || transaction.type !== 2 || typeof transaction.to !== 'string'
      || !ADDRESS.test(transaction.to) || typeof transaction.data !== 'string' || !HEX.test(transaction.data)
      || !quantity(transaction.value) || !quantity(transaction.nonce) || !positiveQuantity(transaction.gasLimit)
      || !positiveQuantity(transaction.maxFeePerGas) || !quantity(transaction.maxPriorityFeePerGas)
      || BigInt(transaction.maxPriorityFeePerGas) > BigInt(transaction.maxFeePerGas)) {
    throw new Error('The original operation has no valid Monad EIP-1559 transaction to continue.');
  }
  const review = object(row.review);
  if (!review || review.kind !== row.kind || (review.ownerAddress !== undefined
      && (typeof review.ownerAddress !== 'string' || review.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()))
      || (review.accountScope !== undefined && review.accountScope !== 'wallet' && review.accountScope !== 'vault')) {
    throw new Error('The original operation review does not match its saved action and owner.');
  }
  const reviewDecimals = validateContinuationReview(row.kind!, review, ownerAddress);
  const safeTransaction = transaction as unknown as PreparedMonadOperation['transaction'];
  return {operationId, ownerAddress: row.ownerAddress!, chainId: 10143, kind: row.kind!, status: 'verified',
    expiresAt: row.expiresAt!, transactionType: 'eip1559', transaction: safeTransaction, reviewDecimals,
    review, reviewFingerprint: stableStringify(review)};
}

function validateContinuationReview(kind: MonadOperationKind, review: Record<string, unknown>, owner: string): number | undefined {
  const amountMatches = (decimalsValue: number, units: unknown) => positiveQuantity(units)
    && decimalToUnits(review.amount, decimalsValue) === BigInt(units);
  if (kind === 'wallet_swap') {
    const inputDecimals = knownMonadDecimals(review.tokenIn);
    const outputDecimals = knownMonadDecimals(review.tokenOut);
    if (review.accountScope !== 'wallet' || !isAddress(review.tokenIn) || !isAddress(review.tokenOut)
        || !positiveQuantity(review.amountInUnits) || !positiveQuantity(review.minAmountOutUnits)
        || inputDecimals === null || outputDecimals === null
        || review.inputDecimals !== inputDecimals || review.outputDecimals !== outputDecimals) {
      throw new Error('The original swap review is incomplete or differs from the wallet operation.');
    }
    return undefined;
  }
  if (kind === 'approve_token') {
    const token = typeof review.tokenAddress === 'string' ? review.tokenAddress.toLowerCase() : '';
    const precision = token === MONAD_AUSD_ADDRESS.toLowerCase() ? 6
      : token === MONAD_USDC_ADDRESS.toLowerCase() ? 6 : token === MONAD_WMON_ADDRESS.toLowerCase() ? 18 : undefined;
    if (precision === undefined || !isAddress(review.tokenAddress) || !isAddress(review.spender) || !positiveQuantity(review.amountUnits)) {
      throw new Error('The original approval review does not contain a known Monad token, exact allowance, and spender.');
    }
    return precision;
  }
  if (kind === 'send_mon' || kind === 'send_usdc' || kind === 'wrap' || kind === 'unwrap') {
    const asset = kind === 'send_mon' ? 'MON' : kind === 'send_usdc' ? 'USDC' : 'WMON';
    const precision = asset === 'USDC' ? 6 : 18;
    if (review.asset !== asset || !amountMatches(precision, review.amountUnits)
        || (kind.startsWith('send_') && !isAddress(review.recipient))) {
      throw new Error('The original wallet action is missing its exact amount, asset, or recipient.');
    }
    return precision;
  }
  if (kind === 'vault_deposit' || kind === 'vault_return') {
    const precision = review.asset === 'USDC' ? 6 : review.asset === 'WMON' ? 18 : undefined;
    if (precision === undefined || !amountMatches(precision, review.amountUnits) || !isAddress(review.vaultAddress)) {
      throw new Error('The original vault action is missing its exact asset, amount, or vault.');
    }
    return precision;
  }
  if (kind === 'claim_ausd_faucet') {
    if (review.asset !== 'AUSD' || typeof review.recipient !== 'string' || !isAddress(review.recipient)
        || review.recipient.toLowerCase() !== owner.toLowerCase()
        || String(review.tokenAddress ?? '').toLowerCase() !== MONAD_AUSD_ADDRESS.toLowerCase()
        || !isAddress(review.faucetAddress) || review.method !== 'requestFunds(address)') {
      throw new Error('The original faucet request does not match this owner and Agora AUSD faucet.');
    }
    return 6;
  }
  throw new Error('This saved action does not contain enough verified terms for explicit continuation.');
}

function decimalToUnits(value: unknown, precision: number): bigint | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > precision) return null;
  try { return BigInt(whole) * 10n ** BigInt(precision) + BigInt((fraction + '0'.repeat(precision)).slice(0, precision) || '0'); }
  catch { return null; }
}

const MONAD_USDC_ADDRESS = '0x534b2f3a21130d7a60830c2df862319e593943a3';
const MONAD_WMON_ADDRESS = '0xfb8bf4c1cc7a94c73d209a149ea2abea852bc541';

function sameReviewedOperation(first: VerifiedMonadContinuation, second: VerifiedMonadContinuation) {
  return first.operationId === second.operationId && first.ownerAddress.toLowerCase() === second.ownerAddress.toLowerCase()
    && first.chainId === second.chainId && first.kind === second.kind && first.status === second.status
    && String(first.expiresAt) === String(second.expiresAt)
    && stableStringify(first.transaction) === stableStringify(second.transaction)
    && first.reviewFingerprint === second.reviewFingerprint;
}
function object(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}
function isAddress(value: unknown) { return typeof value === 'string' && ADDRESS.test(value); }
function quantity(value: unknown): value is string { return typeof value === 'string' && UINT.test(value); }
function positiveQuantity(value: unknown): value is string { return quantity(value) && BigInt(value) > 0n; }
function knownMonadDecimals(address: unknown): number | null {
  if (typeof address !== 'string') return null;
  const normalized = address.toLowerCase();
  if (normalized === MONAD_USDC_ADDRESS.toLowerCase()) return 6;
  if (normalized === MONAD_WMON_ADDRESS.toLowerCase()) return 18;
  return null;
}
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}
