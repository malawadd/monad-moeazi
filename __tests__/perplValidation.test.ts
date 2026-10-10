import {encodeFunctionData, toFunctionSelector} from 'viem';
import type {MonadEip1559Transaction, MonadTypedData} from '../src/types/monad';
import type {PerplPreparedEnrollment, PerplRecoveryReview, PerplRun, PerplStopReview, PerplVenue} from '../src/types/perpl';
import {effectivePerplMarketSlippageBps, PERPL_TESTNET_AUSD, validatePreparedPerpl, validatePerplRecovery, validatePerplStop} from '../src/services/perplValidation';

const owner = '0x1111111111111111111111111111111111111111';
const vault = '0x2222222222222222222222222222222222222222';
const operator = '0x3333333333333333333333333333333333333333';
const amountUnits = '100000000';
const directDurationSeconds = 7_200;
const tokenAbi = [{type: 'function', name: 'transfer', stateMutability: 'nonpayable',
  inputs: [{name: 'to', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}]}] as const;
const recoveryAbi = [{type: 'function', name: 'recoverWithdrawCollateral', stateMutability: 'nonpayable',
  inputs: [{name: 'amount', type: 'uint256'}], outputs: []}] as const;
const nowSeconds = Math.floor(Date.now() / 1000);

function transaction(overrides: Partial<MonadEip1559Transaction> = {}): MonadEip1559Transaction {
  return {chainId: 10143, type: 2, to: PERPL_TESTNET_AUSD, data: encodeFunctionData({abi: tokenAbi, functionName: 'transfer', args: [vault, BigInt(amountUnits)]}),
    value: '0', nonce: '4', gasLimit: '65000', maxFeePerGas: '1000000000', maxPriorityFeePerGas: '100000000', ...overrides};
}

function typedData(overrides: Partial<Record<string, unknown>> = {}): MonadTypedData {
  return {domain: {name: 'Moeazi Perpl Strategy Vault', version: '2', chainId: 10143, verifyingContract: vault},
    types: {PerplRunMandate: [
      {name: 'chainId', type: 'uint256'}, {name: 'owner', type: 'address'}, {name: 'vault', type: 'address'},
      {name: 'collateralToken', type: 'address'}, {name: 'operator', type: 'address'}, {name: 'transport', type: 'uint8'}, {name: 'fundingAmount', type: 'uint256'},
      {name: 'maxPositionExposure', type: 'uint256'}, {name: 'maxLeverage', type: 'uint8'}, {name: 'durationSeconds', type: 'uint64'},
      {name: 'setupDeadline', type: 'uint64'}, {name: 'policyVersion', type: 'uint8'}, {name: 'nonce', type: 'uint256'},
      {name: 'marketIds', type: 'uint256[]'},
    ]}, primaryType: 'PerplRunMandate', message: {
      chainId: 10143, owner, vault, collateralToken: PERPL_TESTNET_AUSD, operator, transport: 2, fundingAmount: amountUnits,
      maxPositionExposure: '50000000', maxLeverage: 3, durationSeconds: 3600,
      setupDeadline: nowSeconds + 300, policyVersion: 2, nonce: '9', marketIds: [2, 7], ...overrides,
    }};
}

function venue(): PerplVenue {
  return {venueId: 'perpl-testnet-v1', displayName: 'Perpl Testnet', chainId: 10143, executionModel: 'offchain_exchange', enabled: true,
    collateral: {symbol: 'AUSD', address: PERPL_TESTNET_AUSD, decimals: 6},
    limits: {minFundingUnits: '100000000', minDurationSeconds: 600, maxDurationSeconds: 86400, maxLeverage: 20, backendMaxMarketSlippageBps: 100},
    markets: [{id: 2, symbol: 'BTC-PERP', isOpen: true, maxMarketSlippageBps: 80}, {id: 7, symbol: 'ETH-PERP', isOpen: true, maxMarketSlippageBps: 120}]};
}

function prepared(overrides: Partial<PerplPreparedEnrollment> = {}): PerplPreparedEnrollment {
  return {runId: 'run-1', venueId: 'perpl-testnet-v1', chainId: 10143, ownerAddress: owner, vaultAddress: vault,
    amountUnits, collateral: {symbol: 'AUSD', address: PERPL_TESTNET_AUSD, decimals: 6}, durationSeconds: 3600,
    maxPositionExposureUnits: '50000000', maxLeverage: 3,
    markets: [{id: 2, symbol: 'BTC-PERP', isOpen: true, maxMarketSlippageBps: 80}, {id: 7, symbol: 'ETH-PERP', isOpen: true, maxMarketSlippageBps: 120}],
    limits: {}, operatorPermission: {address: operator, scope: 'trade', withdrawals: false, perOrderCapsEnforcedBy: 'Moeazi backend'},
    fundingTransaction: transaction(), mandateTypedData: typedData(), maxSlippageBps: 100, preparedExpiresAt: (nowSeconds + 600) * 1000, ...overrides};
}

function directOptimizerReview(overrides: Partial<NonNullable<PerplPreparedEnrollment['optimizerReview']>> = {}) {
  return {version: 'perpl-deterministic-v3-soak', profile: 'duration_soak', stopCondition: 'run_expiry_or_cycle_cap',
    maxCycles: 15, targetWinStreak: null, minimumPositivePnlUnits: '10000', minDurationSeconds: 600,
    defaultDurationSeconds: directDurationSeconds, maxDurationSeconds: 43_200, marketScanIntervalMs: 300_000,
    exitCheckIntervalMs: 60_000, scannerReviewAfterMisses: 3, cycleHoldMinMs: 600_000, cycleHoldMaxMs: 1_800_000,
    plannedLossUnits: '150000', maxNotionalUnits: '30000000', maxMarginUnits: '25000000', maxLeverage: 4,
    maxDepthConsumptionBps: 2_000, initialMomentumThresholdBps: 40, amountUnits,
    target: 'signed_duration_expiry_or_15_cycle_cap', ...overrides};
}

const expected = {ownerAddress: owner, venue: venue(), amountUnits, durationSeconds: 3600};

describe('Perpl enrollment review validation', () => {
  it('accepts the exact AUSD transfer and Perpl mandate', () => {
    expect(() => validatePreparedPerpl(prepared(), expected)).not.toThrow();
  });

  it('binds a direct review to the direct transport', () => {
    const directVenue = {...venue(), venueId: 'perpl-direct-testnet-v1' as const, executionModel: 'onchain_exchange' as const};
    const directReview = prepared({venueId: directVenue.venueId, durationSeconds: directDurationSeconds,
      mandateTypedData: typedData({transport: 1, durationSeconds: directDurationSeconds}), optimizerReview: directOptimizerReview()});
    const directExpected = {...expected, venue: directVenue, durationSeconds: directDurationSeconds};
    expect(() => validatePreparedPerpl(directReview, directExpected)).not.toThrow();
    expect(() => validatePreparedPerpl(prepared({venueId: directVenue.venueId}), {...expected, venue: directVenue})).toThrow();
    expect(() => validatePreparedPerpl({...directReview, durationSeconds: directDurationSeconds + 60}, directExpected)).toThrow('duration');
    expect(() => validatePreparedPerpl({...directReview,
      mandateTypedData: typedData({transport: 1, durationSeconds: directDurationSeconds + 60})}, directExpected)).toThrow('duration differs');
    expect(() => validatePreparedPerpl({...directReview, optimizerReview: directOptimizerReview({
      target: 'two_consecutive_cycles_at_least_0.01_AUSD'})}, directExpected)).toThrow('fixed deterministic optimizer policy');
    expect(() => validatePreparedPerpl({...directReview, optimizerReview: directOptimizerReview({
      version: 'perpl-deterministic-v2', profile: 'two_win_target', stopCondition: 'two_wins_or_cycle_cap',
      targetWinStreak: 2, target: 'two_consecutive_cycles_at_least_0.01_AUSD'})}, directExpected)).toThrow('fixed deterministic optimizer policy');
  });

  it('uses the lower per-market cap when it is below the backend cap', () => {
    expect(effectivePerplMarketSlippageBps(100, 80)).toBe(80);
    expect(() => validatePreparedPerpl(prepared(), expected)).not.toThrow();
  });

  it.each([
    ['zero', 0], ['fractional', 20.5], ['above the backend cap', 101],
  ])('rejects a %s market-order slippage cap', (_label, maxSlippageBps) => {
    expect(() => validatePreparedPerpl(prepared({maxSlippageBps}), expected)).toThrow('outside the live backend cap');
  });

  it('rejects a market cap that differs from live Perpl context', () => {
    const changedMarkets = [{...prepared().markets[0], maxMarketSlippageBps: 81}, prepared().markets[1]];
    expect(() => validatePreparedPerpl(prepared({markets: changedMarkets}), expected)).toThrow('differs from live Perpl context');
  });

  it('rejects a funding transfer to a tampered recipient', () => {
    const data = encodeFunctionData({abi: tokenAbi, functionName: 'transfer', args: [owner, BigInt(amountUnits)]});
    expect(() => validatePreparedPerpl(prepared({fundingTransaction: transaction({data})}), expected)).toThrow('recipient or amount');
  });

  it('rejects a funding transfer with a tampered AUSD amount', () => {
    const data = encodeFunctionData({abi: tokenAbi, functionName: 'transfer', args: [vault, BigInt(amountUnits) + 1n]});
    expect(() => validatePreparedPerpl(prepared({fundingTransaction: transaction({data})}), expected)).toThrow('recipient or amount');
  });

  it.each([
    ['market allowlist', {marketIds: [2, 8]}],
    ['operator', {operator: owner}],
    ['maximum exposure', {maxPositionExposure: '50000001'}],
  ])('rejects a mandate with a changed %s', (_label, changes) => {
    expect(() => validatePreparedPerpl(prepared({mandateTypedData: typedData(changes)}), expected)).toThrow();
  });
});

function stopReview(data: string): PerplStopReview {
  return {runId: 'run-1', venueId: 'perpl-testnet-v1', preparedExpiresAt: (nowSeconds + 300) * 1000,
    stopTransaction: transaction({to: vault, data, value: '0'})};
}

describe('Perpl stop transaction validation', () => {
  it('accepts only the exact requestStop() call on the prepared vault', () => {
    expect(() => validatePerplStop(stopReview(toFunctionSelector('requestStop()')), owner, vault)).not.toThrow();
    expect(() => validatePerplStop(stopReview(toFunctionSelector('withdraw()')), owner, vault)).toThrow('exact zero-value requestStop()');
  });
});

const recoveryRun: PerplRun = {runId: 'run-1', venueId: 'perpl-testnet-v1', status: 'activation_failed', ownerAddress: owner,
  vaultAddress: vault, chainId: 10143, collateral: {symbol: 'AUSD', address: PERPL_TESTNET_AUSD, decimals: 6}};
function recoveryReview(overrides: Partial<PerplRecoveryReview> = {}): PerplRecoveryReview {
  return {runId: 'run-1', venueId: 'perpl-testnet-v1', action: 'recover_vault_funding', ownerAddress: owner, vaultAddress: vault,
    amountUnits: '100000000', recoveryTransaction: transaction({to: vault, data: toFunctionSelector('recoverVaultFunding()')}),
    preparedExpiresAt: (nowSeconds + 300) * 1000, ...overrides};
}

describe('Perpl owner AUSD recovery validation', () => {
  it('accepts the exact recovery call, vault, owner, and reviewed amount', () => {
    expect(() => validatePerplRecovery(recoveryReview(), owner, recoveryRun)).not.toThrow();
  });

  it('rejects a different transaction selector', () => {
    const review = recoveryReview({recoveryTransaction: transaction({to: vault, data: toFunctionSelector('requestStop()')})});
    expect(() => validatePerplRecovery(review, owner, recoveryRun)).toThrow('exact owner recovery method');
  });

  it('rejects a transaction sent to a different vault', () => {
    const otherVault = '0x4444444444444444444444444444444444444444';
    const review = recoveryReview({recoveryTransaction: transaction({to: otherVault, data: toFunctionSelector('recoverVaultFunding()')})});
    expect(() => validatePerplRecovery(review, owner, recoveryRun)).toThrow('exact owner recovery method');
  });

  it('rejects a recovery review that names a different owner recipient', () => {
    const review = recoveryReview({ownerAddress: operator});
    expect(() => validatePerplRecovery(review, owner, recoveryRun)).toThrow('this Mera owner');
  });

  it('accepts recoverWithdrawCollateral only when calldata amount matches the review', () => {
    const data = encodeFunctionData({abi: recoveryAbi, functionName: 'recoverWithdrawCollateral', args: [100000000n]});
    const review = recoveryReview({action: 'recover_available_ausd', recoveryTransaction: transaction({to: vault, data})});
    expect(() => validatePerplRecovery(review, owner, recoveryRun)).not.toThrow();
    const tamperedData = encodeFunctionData({abi: recoveryAbi, functionName: 'recoverWithdrawCollateral', args: [100000001n]});
    const tampered = {...review, recoveryTransaction: transaction({to: vault, data: tamperedData})};
    expect(() => validatePerplRecovery(tampered, owner, recoveryRun)).toThrow('exact owner recovery method');
  });
});
