import type {MonadOperationKind, MonadTypedData, MonadVenueId, PreparedMonadMandate, PreparedMonadOperation} from '../types/monad';
import {toFunctionSelector} from 'viem';

const AUTONOMY_RECOVERY_SELECTOR = toFunctionSelector('emergencyRecover()');

export type MonadOperationExpectation = {
  ownerAddress: string;
  kind: MonadOperationKind;
  amount?: string;
  asset?: string;
  recipient?: string;
  vaultAddress?: string;
  venue?: MonadVenueId;
  pair?: string;
  accountScope?: 'wallet' | 'vault';
  tokenIn?: string;
  tokenOut?: string;
  tokenAddress?: string;
  spender?: string;
  amountUnits?: string;
  amountInUnits?: string;
  minAmountOutUnits?: string;
  inputDecimals?: number;
  outputDecimals?: number;
  quoteId?: string;
};

export function validatePreparedMonadOperation(value: PreparedMonadOperation, expected: MonadOperationExpectation) {
  if (value.chainId !== 10143 || value.transactionType !== 'eip1559') {
    throw new Error('The prepared request is not an EIP-1559 transaction for Monad Testnet.');
  }
  if (!sameAddress(value.ownerAddress, expected.ownerAddress)) {
    throw new Error('The prepared request belongs to a different Mera wallet.');
  }
  if (value.kind !== expected.kind) throw new Error('The prepared request does not match this action.');
  if (!value.operationId || !future(value.expiresAt)) throw new Error('The prepared request is missing or expired.');

  const tx = value.transaction;
  if (!tx || tx.chainId !== 10143 || tx.type !== 2 || !isAddress(tx.to) || !isHex(tx.data) || !validQuantity(tx.value)
      || !validQuantity(tx.nonce) || !validQuantity(tx.gasLimit, true)
      || !validQuantity(tx.maxFeePerGas) || !validQuantity(tx.maxPriorityFeePerGas)) {
    throw new Error('The prepared transaction contains invalid EIP-1559 fields.');
  }
  if (BigInt(tx.maxPriorityFeePerGas) > BigInt(tx.maxFeePerGas)) {
    throw new Error('The prepared priority fee exceeds the maximum fee.');
  }

  if (expected.kind === 'autonomy_recovery'
      && (!expected.vaultAddress || !isAddress(expected.vaultAddress)
        || tx.to.toLowerCase() !== expected.vaultAddress.toLowerCase()
        || tx.data.toLowerCase() !== AUTONOMY_RECOVERY_SELECTOR.toLowerCase()
        || BigInt(tx.value) !== 0n)) {
    throw new Error('The recovery request must call emergencyRecover() on this exact vault with no native value.');
  }

  const review = value.review as (typeof value.review & Record<string, unknown>) | undefined;
  compareReview(review, expected, 'amount');
  compareReview(review, expected, 'asset');
  compareReview(review, expected, 'recipient');
  compareReview(review, expected, 'vaultAddress');
  compareReview(review, expected, 'venue');
  compareReview(review, expected, 'pair');
  compareReview(review, expected, 'accountScope');
  compareReview(review, expected, 'tokenIn');
  compareReview(review, expected, 'tokenOut');
  compareReview(review, expected, 'tokenAddress');
  compareReview(review, expected, 'spender');
  compareReview(review, expected, 'amountUnits');
  compareReview(review, expected, 'amountInUnits');
  compareReview(review, expected, 'minAmountOutUnits');
  compareReview(review, expected, 'inputDecimals');
  compareReview(review, expected, 'outputDecimals');
  compareReview(review, expected, 'quoteId');
}

export function validatePreparedMonadMandate(value: PreparedMonadMandate, ownerAddress: string, expected?: {amount: string; amountUnits: string; asset: 'USDC' | 'WMON'; durationDays: number}) {
  if (!value.mandateId || value.chainId !== 10143 || !sameAddress(value.ownerAddress, ownerAddress)
      || !isAddress(value.vaultAddress)) {
    throw new Error('The prepared mandate does not match your Mera wallet on Monad Testnet.');
  }
  if (!future(value.expiresAt) || !validQuantity(value.nonce)) throw new Error('The prepared mandate is missing or expired.');
  validateTypedData(value.typedData, {vaultAddress: value.vaultAddress, nonce: value.nonce,
    validAfter: value.validAfter, expiresAt: value.expiresAt, review: value.review});
  if (expected) {
    const reviewUnits = value.review?.amountUnits;
  if (!value.review || !reviewUnits || !sameQuantity(reviewUnits, expected.amountUnits)
        || !value.review.amountPerTradeUnits || value.review.asset !== expected.asset
        || expected.durationDays < 1 || expected.durationDays > 7 || value.review.durationDays !== expected.durationDays
        || !timestampMatches(value.review.validAfter, value.validAfter)
        || !timestampMatches(value.review.expiresAt, value.expiresAt)
        || timestampDifferenceDays(value.validAfter, value.expiresAt) !== expected.durationDays) {
      throw new Error('The prepared mandate changed the reviewed amount or duration.');
    }
  }
}

export function validateTypedData(value: MonadTypedData, expected: {
  vaultAddress: string; nonce: string; validAfter?: string | number; expiresAt: string | number;
  review?: PreparedMonadMandate['review'];
}) {
  if (!value || !value.domain || !value.types || !value.message || !value.primaryType) {
    throw new Error('The mandate is missing its EIP-712 signing data.');
  }
  const mandateFields = [
    ['chainId', 'uint256'], ['vault', 'address'], ['allowedAdapters', 'address[]'],
    ['tokenIn', 'address'], ['tokenOut', 'address'], ['maxInputPerTrade', 'uint256'],
    ['maxTotalInput', 'uint256'], ['validAfter', 'uint64'], ['expiresAt', 'uint64'], ['nonce', 'uint256'],
  ];
  const declaredFields = value.types.Mandate;
  if (value.primaryType !== 'Mandate' || !Array.isArray(declaredFields)
      || declaredFields.length !== mandateFields.length
      || !mandateFields.every(([name, fieldType], index) => declaredFields[index]?.name === name && declaredFields[index]?.type === fieldType)) {
    throw new Error('The EIP-712 type does not match the Monad vault mandate contract.');
  }
  if (value.domain.name !== 'Moeazi Monad Testnet Vault' || value.domain.version !== '1') {
    throw new Error('The EIP-712 domain does not match the Monad vault contract.');
  }
  const domainChainId = value.domain.chainId;
  if (domainChainId !== 10143 && domainChainId !== '10143') {
    throw new Error('The mandate signing domain is not Monad Testnet (10143).');
  }
  if (!sameAddress(value.domain.verifyingContract, expected.vaultAddress)
      || !sameAddress(value.message.vault, expected.vaultAddress)) {
    throw new Error('The EIP-712 mandate is not bound to the prepared vault contract.');
  }
  if (!sameQuantity(value.message.chainId, '10143')) {
    throw new Error('The EIP-712 mandate message is not bound to Monad Testnet.');
  }
  if (!sameQuantity(value.message.nonce, expected.nonce)
      || !timestampMatches(value.message.validAfter, expected.validAfter)
      || !timestampMatches(value.message.expiresAt, expected.expiresAt)) {
    throw new Error('The EIP-712 mandate terms do not match the prepared nonce and validity window.');
  }
  const signedAssets = [value.message.tokenIn, value.message.tokenOut];
  const signedAdapters = value.message.allowedAdapters;
  const signedCaps = [value.message.maxInputPerTrade, value.message.maxTotalInput];
  const reviewedAdapters = expected.review?.adapters ?? expected.review?.allowedAdapters;
  if (!Array.isArray(expected.review?.assets) || !sameAddressArray(signedAssets, expected.review.assets)
      || (expected.review.tokenIn !== undefined && !sameAddress(value.message.tokenIn, expected.review.tokenIn))
      || (expected.review.tokenOut !== undefined && !sameAddress(value.message.tokenOut, expected.review.tokenOut))
      || !Array.isArray(signedAdapters) || !Array.isArray(reviewedAdapters) || !sameAddressArray(signedAdapters, reviewedAdapters)
      || (expected.review.allowedAdapters !== undefined && (!Array.isArray(expected.review.allowedAdapters)
        || !sameAddressArray(signedAdapters, expected.review.allowedAdapters)))
      || !Array.isArray(expected.review?.caps) || !sameQuantityArray(signedCaps, expected.review.caps)) {
    throw new Error('The EIP-712 mandate assets, adapters, or caps differ from the prepared review.');
  }
  if (!expected.review?.amountUnits || !expected.review.amountPerTradeUnits
      || !sameQuantity(value.message.maxTotalInput, expected.review.amountUnits)
      || !sameQuantity(value.message.maxInputPerTrade, expected.review.amountPerTradeUnits)) {
    throw new Error('The EIP-712 mandate caps differ from the reviewed input limits.');
  }
}

function sameQuantity(actual: unknown, expected: string) {
  try { return typeof actual === 'string' || typeof actual === 'number' || typeof actual === 'bigint'
    ? BigInt(actual) === BigInt(expected) : false; }
  catch { return false; }
}

function timestampMatches(actual: unknown, expected: unknown) {
  if (expected === undefined) return actual === undefined;
  if (actual === undefined) return false;
  const asSeconds = (value: unknown) => {
    if (typeof value === 'number') return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number(value); return parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : parsed;
    }
    if (typeof value === 'string') return Math.floor(Date.parse(value) / 1000);
    return NaN;
  };
  return asSeconds(actual) === asSeconds(expected);
}

function timestampDifferenceDays(start: unknown, end: unknown) {
  const startSeconds = timestampSeconds(start);
  const endSeconds = timestampSeconds(end);
  const delta = endSeconds - startSeconds;
  return Number.isFinite(delta) && delta > 0 && delta % 86_400 === 0 ? delta / 86_400 : -1;
}

function timestampSeconds(value: unknown) {
  if (typeof value === 'number') return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value); return parsed > 10_000_000_000 ? Math.floor(parsed / 1000) : parsed;
  }
  if (typeof value === 'string') return Math.floor(Date.parse(value) / 1000);
  return NaN;
}

function sameAddressArray(actual: unknown[], expected: unknown[]) {
  return actual.length === expected.length && actual.every((value, index) => sameAddress(value, String(expected[index])));
}

function sameQuantityArray(actual: unknown[], expected: unknown[]) {
  return actual.length === expected.length && actual.every((value, index) => sameQuantity(value, String(expected[index])));
}

export function isAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
}

function sameAddress(actual: unknown, expected: string) {
  return typeof actual === 'string' && isAddress(expected) && actual.toLowerCase() === expected.toLowerCase();
}

function compareReview(review: Record<string, unknown> | undefined, expected: MonadOperationExpectation, key: keyof MonadOperationExpectation) {
  const wanted = expected[key];
  if (wanted === undefined) return;
  const actual = review?.[key];
  if (actual === undefined) throw new Error(`The server did not echo the reviewed ${key}.`);
  const match = key === 'recipient' || key === 'vaultAddress' || key === 'tokenIn' || key === 'tokenOut' || key === 'tokenAddress' || key === 'spender'
    ? sameAddress(actual, String(wanted))
    : key === 'amount' ? canonicalAmount(actual) === canonicalAmount(String(wanted))
      : key === 'amountUnits' || key === 'amountInUnits' || key === 'minAmountOutUnits' ? sameQuantity(actual, String(wanted))
      : String(actual).toLowerCase() === String(wanted).toLowerCase();
  if (!match) throw new Error(`The prepared request changed the reviewed ${key}.`);
}

function canonicalAmount(value: unknown) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`.replace(/\.$/, '');
}

function validQuantity(value: string, positive = false) {
  return /^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value)
    && (!positive || BigInt(value) > 0n);
}

function isHex(value: string) { return /^0x(?:[0-9a-f]{2})*$/i.test(value); }

function future(value: string | number) {
  const ms = typeof value === 'number' ? (value < 10_000_000_000 ? value * 1000 : value)
    : /^\d+$/.test(value) ? (Number(value) < 10_000_000_000 ? Number(value) * 1000 : Number(value)) : Date.parse(value);
  return Number.isFinite(ms) && ms > Date.now();
}
