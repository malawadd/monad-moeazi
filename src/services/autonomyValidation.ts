import {MONAD_TESTNET_USDC} from '../types/autonomyTrading';
import type {AutonomyTypedData, PreparedAutonomyEnrollment} from '../types/autonomyTrading';

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const HEX32 = /^0x[a-fA-F0-9]{64}$/;
const MAX_REVIEW_SECONDS = 5 * 60;

const CIRCLE_AUTHORIZATION_FIELDS = [
  ['from', 'address'], ['to', 'address'], ['value', 'uint256'],
  ['validAfter', 'uint256'], ['validBefore', 'uint256'], ['nonce', 'bytes32'],
] as const;

const MANDATE_FIELDS = [
  ['chainId', 'uint256'], ['owner', 'address'], ['vault', 'address'], ['usdc', 'address'],
  ['tokens', 'address[3]'], ['pools', 'address[3]'], ['fundingAmount', 'uint256'],
  ['durationSeconds', 'uint64'], ['startBy', 'uint64'], ['maxCycles', 'uint8'],
  ['buySlippageBps', 'uint16'], ['sellSlippageBps', 'uint16'], ['nonce', 'uint256'],
] as const;

export function validatePreparedAutonomyEnrollment(
  value: PreparedAutonomyEnrollment,
  expected: {ownerAddress: string; amountUnits: string; durationSeconds: number},
  now = Date.now(),
) {
  if (!value || value.chainId !== 10143 || !validIdentifier(value.enrollmentId)
      || !sameAddress(value.ownerAddress, expected.ownerAddress) || !isAddress(value.vaultAddress)) {
    throw new Error('The enrollment review is not bound to this Mera owner on Monad Testnet.');
  }
  if (!sameQuantity(value.amountUnits, expected.amountUnits) || !sameQuantity(value.maxBuyUnits, expected.amountUnits)
      || value.durationSeconds !== expected.durationSeconds || value.maxCycles !== 3
      || !validBps(value.buySlippageBps) || !validBps(value.sellSlippageBps)) {
    throw new Error('The prepared amount, duration, per-buy cap, or cycle limit changed.');
  }
  if (BigInt(expected.amountUnits) < 100_000n || BigInt(expected.amountUnits) > 10_000_000n
      || expected.durationSeconds < 600 || expected.durationSeconds > 7_200) {
    throw new Error('Choose 0.1–10 test USDC and a duration from 10 to 120 minutes.');
  }
  if (!validQuantity(value.nonce) || !addressList(value.tokens) || !addressList(value.pools)) {
    throw new Error('The review is missing its nonce or the three approved token and pool bindings.');
  }
  const startBy = unixSeconds(value.startBy);
  const preparedExpiresAt = unixSeconds(value.preparedExpiresAt);
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isFinite(startBy) || startBy <= nowSeconds || startBy > nowSeconds + MAX_REVIEW_SECONDS + 10
      || !Number.isFinite(preparedExpiresAt) || preparedExpiresAt <= nowSeconds
      || preparedExpiresAt > startBy) {
    throw new Error('The enrollment review is expired or its activation deadline is invalid.');
  }
  validateCircleAuthorization(value.usdcAuthorizationTypedData, value, nowSeconds);
  validateStrategyMandate(value.mandateTypedData, value, expected);
  return true;
}

function validateCircleAuthorization(data: AutonomyTypedData, prepared: PreparedAutonomyEnrollment, now: number) {
  if (!validTypedData(data) || data.primaryType !== 'ReceiveWithAuthorization'
      || !fieldListMatches(data.types.ReceiveWithAuthorization, CIRCLE_AUTHORIZATION_FIELDS)) {
    throw new Error('The USDC authorization is not Circle receiveWithAuthorization typed data.');
  }
  if (data.domain.name !== 'USDC' || data.domain.version !== '2'
      || !sameQuantity(data.domain.chainId, '10143')
      || !sameAddress(data.domain.verifyingContract, MONAD_TESTNET_USDC)) {
    throw new Error('The USDC authorization uses the wrong token or network.');
  }
  const message = data.message;
  const validAfter = quantity(message.validAfter), validBefore = quantity(message.validBefore);
  const nowPlusReview = now + MAX_REVIEW_SECONDS + 10;
  if (!sameAddress(message.from, prepared.ownerAddress) || !sameAddress(message.to, prepared.vaultAddress)
      || !sameQuantity(message.value, prepared.amountUnits) || !HEX32.test(String(message.nonce))
      || validAfter === null || validBefore === null || validAfter >= now
      || validAfter >= validBefore || validBefore <= now || validBefore > nowPlusReview
      || validBefore > unixSeconds(prepared.startBy)
      || validBefore > unixSeconds(prepared.preparedExpiresAt)) {
    throw new Error('The USDC authorization changed the owner, vault, amount, or short signing window.');
  }
}

function validateStrategyMandate(data: AutonomyTypedData, prepared: PreparedAutonomyEnrollment,
  expected: {ownerAddress: string; amountUnits: string; durationSeconds: number}) {
  if (!validTypedData(data) || data.primaryType !== 'StrategyMandate'
      || !fieldListMatches(data.types.StrategyMandate, MANDATE_FIELDS)) {
    throw new Error('The strategy authorization type does not match the test vault contract.');
  }
  if (data.domain.name !== 'Moeazi Monad Testnet Autonomy' || data.domain.version !== '1'
      || !sameQuantity(data.domain.chainId, '10143') || !sameAddress(data.domain.verifyingContract, prepared.vaultAddress)) {
    throw new Error('The strategy authorization is for a different vault or network.');
  }
  const message = data.message;
  const buySlippage = quantity(message.buySlippageBps), sellSlippage = quantity(message.sellSlippageBps);
  if (!sameQuantity(message.chainId, '10143') || !sameAddress(message.owner, expected.ownerAddress)
      || !sameAddress(message.vault, prepared.vaultAddress) || !sameAddress(message.usdc, MONAD_TESTNET_USDC)
      || !sameAddressList(message.tokens, prepared.tokens) || !sameAddressList(message.pools, prepared.pools)
      || !sameQuantity(message.fundingAmount, expected.amountUnits)
      || !sameQuantity(message.durationSeconds, String(expected.durationSeconds))
      || !sameQuantity(message.startBy, String(unixSeconds(prepared.startBy)))
      || !sameQuantity(message.maxCycles, '3') || !sameQuantity(message.nonce, prepared.nonce)
      || buySlippage === null || sellSlippage === null
      || buySlippage !== BigInt(prepared.buySlippageBps) || sellSlippage !== BigInt(prepared.sellSlippageBps)
      || buySlippage > 500 || sellSlippage > 500) {
    throw new Error('The strategy authorization changed the owner, vault, approved venues, limits, or expiry.');
  }
}

export function validateAutonomyOwnerChain(ownerAddress: string | undefined, value: {ownerAddress: string; chainId: number}) {
  if (value.chainId !== 10143 || !ownerAddress || !sameAddress(value.ownerAddress, ownerAddress)) {
    throw new Error('Autonomous trading data does not match this Mera owner on Monad Testnet.');
  }
}

export function createAutonomyIdempotencyKey() {
  return `autonomy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function validTypedData(value: unknown): value is AutonomyTypedData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Boolean(row.domain && typeof row.domain === 'object' && !Array.isArray(row.domain)
    && row.types && typeof row.types === 'object' && !Array.isArray(row.types)
    && row.message && typeof row.message === 'object' && !Array.isArray(row.message)
    && typeof row.primaryType === 'string');
}

function fieldListMatches(actual: unknown, expected: readonly (readonly [string, string])[]) {
  return Array.isArray(actual) && actual.length === expected.length
    && expected.every(([name, type], index) => {
      const field = actual[index];
      return Boolean(field && typeof field === 'object' && (field as {name?: unknown}).name === name
        && (field as {type?: unknown}).type === type);
    });
}

function addressList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length === 3 && value.every(isAddress)
    && new Set(value.map(row => row.toLowerCase())).size === 3;
}

function sameAddressList(actual: unknown, expected: string[]) {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((value, index) => sameAddress(value, expected[index]));
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[-_a-zA-Z0-9]{8,128}$/.test(value);
}

function isAddress(value: unknown): value is string {
  return typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value);
}

function sameAddress(actual: unknown, expected: string) {
  return typeof actual === 'string' && isAddress(expected) && isAddress(actual)
    && actual.toLowerCase() === expected.toLowerCase();
}

function validQuantity(value: unknown) {
  return (typeof value === 'string' || typeof value === 'number') && UINT.test(String(value));
}

function validBps(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 500;
}

function quantity(value: unknown): bigint | null {
  return validQuantity(value) ? BigInt(String(value)) : null;
}

function sameQuantity(actual: unknown, expected: string) {
  const parsed = quantity(actual);
  return parsed !== null && parsed === BigInt(expected);
}

function unixSeconds(value: string | number) {
  if (typeof value === 'number') return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  return /^\d+$/.test(value) ? Number(value) : Math.floor(Date.parse(value) / 1000);
}
