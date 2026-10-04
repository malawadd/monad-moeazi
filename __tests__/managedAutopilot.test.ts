import {allowanceNeedsApproval, buildCappedApprovalData, formatTokenUnits, magicEnableTypedData,
  scopeActivationAllowanceReady,
  MANAGED_TOKENS, UNISWAP_V3_ROUTER, validateAllowanceCall, validateScopedGrantPreparation} from '../src/services/managedAutopilot';
import type {ManagedProgramGrantContext, ManagedScopedGrant, ScopedGrantPreparation} from '../src/types/mobile';

const owner = '0x1111111111111111111111111111111111111111';
const session = '0x2222222222222222222222222222222222222222';

function fixture() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const context: ManagedProgramGrantContext = {
    contextAvailable: true, strategyAccountId: 'strategy_1', assignmentId: 'assignment_1',
    programVersionId: 'version_1', contentHash: 'a'.repeat(64), policyHash: 'b'.repeat(64),
    ownerAddress: owner, venueAccountId: 'venue_1', executionGrantId: 'managed-context12345678',
    expiresAt, bounds: {maxUsdcUnits: '25000000', maxWethUnits: '10000000000000000',
      minWethOutUnits: '9000000000000000', minUsdcOutUnits: '22000000'},
    ownerSignaturesRequired: ['buy', 'exit'], broadcastEnabled: false,
  };
  const grant = (scope: 'buy' | 'exit'): ManagedScopedGrant => ({
    grantId: 'managed-review12345678', scope, owner, sessionAddress: session,
    state: 'awaiting-owner', policyHash: `0x${'c'.repeat(64)}`, expiresAt,
    ownerApproval: {domain: {chainId: 42161, verifyingContract: session},
      types: {EIP712Domain: [{name: 'chainId', type: 'uint256'}], Enable: [{name: 'calls', type: 'Call[]'}]},
      primaryType: 'Enable', message: {calls: []}},
    review: {chainId: 42161, router: UNISWAP_V3_ROUTER,
      tokenIn: scope === 'buy' ? MANAGED_TOKENS.usdc : MANAGED_TOKENS.weth,
      tokenOut: scope === 'buy' ? MANAGED_TOKENS.weth : MANAGED_TOKENS.usdc,
      feeTier: 3000, recipient: owner,
      maximumInputUnits: scope === 'buy' ? context.bounds.maxUsdcUnits : context.bounds.maxWethUnits,
      minimumOutputUnits: scope === 'buy' ? context.bounds.minWethOutUnits : context.bounds.minUsdcOutUnits,
      earliestDeadline: expiresAt - 300, latestDeadline: expiresAt, maxCalls: 1, callValueWei: '0'},
  });
  const call = (token: string, amount: string) => ({to: token, token, value: '0' as const,
    data: buildCappedApprovalData(token, amount), amount});
  const preparation: ScopedGrantPreparation = {
    grantId: 'managed-review12345678', grants: [grant('buy'), grant('exit')],
    ownerAllowanceCalls: [call(MANAGED_TOKENS.usdc, context.bounds.maxUsdcUnits), call(MANAGED_TOKENS.weth, context.bounds.maxWethUnits)],
    allowance: {blockNumber: '123', blockHash: `0x${'d'.repeat(64)}`, owner,
      usdcBalanceUnits: '100000000', usdcAllowanceUnits: '0', wethBalanceUnits: '100000000000000000',
      wethAllowanceUnits: '0', buyReady: false, exitAllowanceReady: false},
    ownerActionsRequired: true, activationReceiptReady: false, liveTradingEnabled: false,
  };
  return {context, preparation};
}

describe('managed mobile grant review', () => {
  it('formats exact token units without float conversion', () => {
    expect(formatTokenUnits('25000000', 6)).toBe('25');
    expect(formatTokenUnits('10000000000000000', 18)).toBe('0.01');
    expect(formatTokenUnits('1', 18)).toBe('0.000000000000000001');
  });

  it('builds only exact positive USDC or WETH router approvals', () => {
    const data = buildCappedApprovalData(MANAGED_TOKENS.usdc, '25000000');
    expect(data).toMatch(/^0x095ea7b3/);
    expect(validateAllowanceCall({to: MANAGED_TOKENS.usdc, token: MANAGED_TOKENS.usdc,
      value: '0', amount: '25000000', data}, MANAGED_TOKENS.usdc, '25000000')).toBe(true);
    expect(() => buildCappedApprovalData(MANAGED_TOKENS.usdc, '1e6')).toThrow();
    expect(() => buildCappedApprovalData(owner, '25000000')).toThrow();
    expect(validateAllowanceCall({to: owner, token: MANAGED_TOKENS.usdc, value: '0', amount: '25000000', data},
      MANAGED_TOKENS.usdc, '25000000')).toBe(false);
  });

  it('rejects prepared grants that do not match owner, venue bounds, or one-call policy', () => {
    const {context, preparation} = fixture();
    expect(validateScopedGrantPreparation(preparation, context)).toBe(true);
    expect(() => validateScopedGrantPreparation({...preparation,
      grants: preparation.grants.map(row => row.scope === 'buy'
        ? {...row, review: {...row.review, maximumInputUnits: '25000001'}} : row)}, context)).toThrow();
    expect(() => validateScopedGrantPreparation({...preparation,
      grants: preparation.grants.map(row => row.scope === 'exit' ? {...row, owner: session} : row)}, context)).toThrow();
    expect(allowanceNeedsApproval('25000000', '0', '25000000')).toBe(true);
    expect(allowanceNeedsApproval('24999999', '0', '25000000')).toBe(false);
    expect(allowanceNeedsApproval('0', '0', '10000000000000000', false)).toBe(true);
    expect(scopeActivationAllowanceReady('exit', '0', '10000000000000000', '10000000000000000')).toBe(true);
    expect(scopeActivationAllowanceReady('buy', '0', '25000000', '25000000')).toBe(false);
    expect(scopeActivationAllowanceReady('buy', '25000000', '25000000', '25000000')).toBe(true);
  });

  it('forwards the exact ZeroDev EIP-712 payload fields to Magic', () => {
    const {preparation} = fixture();
    const payload = magicEnableTypedData(preparation.grants[0]);
    expect(payload.primaryType).toBe('Enable');
    expect(payload.types).toHaveProperty('EIP712Domain');
    expect(payload.domain.chainId).toBe(42161);
  });
});
