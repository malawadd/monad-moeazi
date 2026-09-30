import {ManagedProgramGrantContext, ManagedScopedGrant, ScopedGrantPreparation} from '../types/mobile';

export const UNISWAP_V3_ROUTER = '0xe592427a0aece92de3edee1f18e0157c05861564';
export const MANAGED_TOKENS = {
  usdc: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  weth: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
} as const;

const UINT = /^(?:0|[1-9][0-9]*)$/;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

function isAddress(value: unknown): value is string { return typeof value === 'string' && ADDRESS.test(value); }
function isUnits(value: unknown): value is string { return typeof value === 'string' && UINT.test(value); }

export function formatTokenUnits(value: unknown, decimals: number) {
  if (!isUnits(value) || !Number.isInteger(decimals) || decimals < 0) return 'Unavailable';
  const digits = (value as string).padStart(decimals + 1, '0');
  const whole = (decimals ? digits.slice(0, -decimals) : digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = decimals ? digits.slice(-decimals).replace(/0+$/, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

export function buildCappedApprovalData(token: string, amount: string) {
  const normalized = token.toLowerCase();
  if (![MANAGED_TOKENS.usdc, MANAGED_TOKENS.weth].includes(normalized as typeof MANAGED_TOKENS[keyof typeof MANAGED_TOKENS])
      || !isUnits(amount) || BigInt(amount) <= 0n) throw new Error('Only a positive exact USDC or WETH router cap can be approved.');
  const spender = UNISWAP_V3_ROUTER.slice(2).padStart(64, '0');
  return `0x095ea7b3${spender}${BigInt(amount).toString(16).padStart(64, '0')}`;
}

export function validateAllowanceCall(call: unknown, token: string, expectedAmount: string) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) return false;
  const row = call as Record<string, unknown>;
  if (String(row.to).toLowerCase() !== token.toLowerCase() || String(row.token).toLowerCase() !== token.toLowerCase()
      || !(row.value === '0' || row.value === 0) || row.amount !== expectedAmount
      || typeof row.data !== 'string' || !/^0x095ea7b3[0-9a-fA-F]{128}$/.test(row.data)) return false;
  const encoded = row.data.slice(10);
  return `0x${encoded.slice(24, 64)}`.toLowerCase() === UNISWAP_V3_ROUTER
    && BigInt(`0x${encoded.slice(64)}`).toString() === expectedAmount;
}

function expectedGrant(context: ManagedProgramGrantContext, scope: 'buy' | 'exit') {
  return scope === 'buy'
    ? {input: MANAGED_TOKENS.usdc, output: MANAGED_TOKENS.weth,
      max: context.bounds.maxUsdcUnits, min: context.bounds.minWethOutUnits}
    : {input: MANAGED_TOKENS.weth, output: MANAGED_TOKENS.usdc,
      max: context.bounds.maxWethUnits, min: context.bounds.minUsdcOutUnits};
}

export function validatePreparedGrant(grant: ManagedScopedGrant, prepared: ScopedGrantPreparation,
  context: ManagedProgramGrantContext, scope: 'buy' | 'exit', now = Date.now()) {
  const bounds = expectedGrant(context, scope), review = grant.review, approval = grant.ownerApproval;
  if (grant.grantId !== prepared.grantId || grant.scope !== scope || grant.owner.toLowerCase() !== context.ownerAddress.toLowerCase()
      || !['awaiting-owner', 'active'].includes(grant.state) || !isAddress(grant.sessionAddress)
      || !/^0x[0-9a-fA-F]{64}$/.test(grant.policyHash)
      || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt !== context.expiresAt || grant.expiresAt <= now / 1000
      || !approval || approval.primaryType !== 'Enable' || !approval.domain || !approval.types || !approval.message
      || ![42161, '42161'].includes(approval.domain.chainId as number | string)
      || review.chainId !== 42161 || review.router.toLowerCase() !== UNISWAP_V3_ROUTER
      || review.tokenIn.toLowerCase() !== bounds.input || review.tokenOut.toLowerCase() !== bounds.output
      || review.feeTier !== 3000 || review.recipient.toLowerCase() !== context.ownerAddress.toLowerCase()
      || review.maximumInputUnits !== bounds.max || review.minimumOutputUnits !== bounds.min
      || !Number.isSafeInteger(review.earliestDeadline) || review.earliestDeadline <= now / 1000
      || review.earliestDeadline > review.latestDeadline || review.latestDeadline !== context.expiresAt
      || review.maxCalls !== 1 || review.callValueWei !== '0') {
    throw new Error(`The ${scope} scope did not match the exact owner, route, bounds, or expiry supplied by the managed program.`);
  }
  return true;
}

export function validateScopedGrantPreparation(prepared: ScopedGrantPreparation, context: ManagedProgramGrantContext, now = Date.now()) {
  if (!prepared || !/^[-_a-zA-Z0-9]{8,128}$/.test(prepared.grantId) || !Array.isArray(prepared.grants)
      || prepared.grants.length !== 2 || !Array.isArray(prepared.ownerAllowanceCalls) || prepared.ownerAllowanceCalls.length !== 2
      || prepared.activationReceiptReady !== false || prepared.liveTradingEnabled !== false
      || !prepared.allowance || prepared.allowance.owner.toLowerCase() !== context.ownerAddress.toLowerCase()
      || !/^(?:0|[1-9][0-9]*)$/.test(prepared.allowance.blockNumber)
      || !/^0x[0-9a-fA-F]{64}$/.test(prepared.allowance.blockHash)
      || ![prepared.allowance.usdcBalanceUnits, prepared.allowance.usdcAllowanceUnits,
        prepared.allowance.wethBalanceUnits, prepared.allowance.wethAllowanceUnits].every(isUnits)) {
    throw new Error('Scoped grant preparation returned incomplete or unsafe owner review data.');
  }
  const buy = prepared.grants.find((grant) => grant.scope === 'buy');
  const exit = prepared.grants.find((grant) => grant.scope === 'exit');
  if (!buy || !exit || buy.policyHash !== exit.policyHash) throw new Error('Buy and exit scopes must share one managed policy hash.');
  validatePreparedGrant(buy, prepared, context, 'buy', now);
  validatePreparedGrant(exit, prepared, context, 'exit', now);
  if (!validateAllowanceCall(prepared.ownerAllowanceCalls.find((call) => call.token.toLowerCase() === MANAGED_TOKENS.usdc),
      MANAGED_TOKENS.usdc, context.bounds.maxUsdcUnits)
      || !validateAllowanceCall(prepared.ownerAllowanceCalls.find((call) => call.token.toLowerCase() === MANAGED_TOKENS.weth),
        MANAGED_TOKENS.weth, context.bounds.maxWethUnits)) {
    throw new Error('Token approval calls did not match the exact server-derived router caps.');
  }
  return true;
}

export function allowanceNeedsApproval(balance: string, allowance: string, required: string, requireBalance = true) {
  if (![balance, allowance, required].every(isUnits)) return false;
  return BigInt(allowance) < BigInt(required) && (!requireBalance || BigInt(balance) >= BigInt(required));
}

export function scopeActivationAllowanceReady(scope: 'buy' | 'exit', balance: string, allowance: string, required: string) {
  if (![balance, allowance, required].every(isUnits)) return false;
  const authorizationReady = BigInt(allowance) >= BigInt(required);
  return scope === 'buy' ? authorizationReady && BigInt(balance) >= BigInt(required) : authorizationReady;
}

export function idempotencyKeyForReview() {
  return `mobile:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 14)}`;
}

export function reviewScopes(grants: ManagedScopedGrant[]) {
  return ({buy: grants.find((item) => item.scope === 'buy'), exit: grants.find((item) => item.scope === 'exit')});
}

export function validMagicOwner(owner: unknown, expected: string) {
  return isAddress(owner) && owner.toLowerCase() === expected.toLowerCase();
}

export function magicEnableTypedData(grant: ManagedScopedGrant) {
  const {domain, types, primaryType, message} = grant.ownerApproval;
  // Magic signs the ZeroDev SDK's original EIP-712 payload; do not synthesize or
  // rewrite its domain/types/message on the client.
  const signingTypes = types;
  return {domain, types: signingTypes, primaryType, message};
}
