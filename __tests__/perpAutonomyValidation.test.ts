import {MONAD_TESTNET_USDC} from '../src/types/autonomyTrading';
import type {PreparedPerpEnrollment} from '../src/types/perpAutonomy';
import {validatePerpSignature, validatePerpStop, validatePreparedPerp} from '../src/services/perpAutonomyValidation';

const owner = '0x1111111111111111111111111111111111111111';
const vault = '0x2222222222222222222222222222222222222222';
const factory = '0x3333333333333333333333333333333333333333';
const executor = '0x4444444444444444444444444444444444444444';
const clearinghouse = '0x5555555555555555555555555555555555555555';
const address = (value: number) => `0x${value.toString(16).padStart(40, '0')}`;
const markets = ['MZA', 'MZB', 'MZG'].map((symbol, index) => ({index, name: symbol, symbol,
  tokenAddress: address(index + 6), poolAddress: address(index + 9)}));

function prepared(): PreparedPerpEnrollment {
  const amountUnits = '1000000'; const durationSeconds = 600;
  const setupDeadline = Math.floor(Date.now() / 1000) + 240;
  return {
    runId: 'run-12345678', enrollmentId: 'run-12345678', ownerAddress: owner, vaultAddress: vault,
    chainId: 10143, nonce: '7', amountUnits, durationSeconds, setupDeadline,
    preparedExpiresAt: Date.now() + 240_000,
    policy: {version: 1, minLeverage: 1, maxLeverage: 10, maxMarginUnits: amountUnits,
      maxPayoutMultiple: 5, reserveMultiple: 4, maxConcurrentPositions: 1,
      allowedDirections: ['long', 'short'], markets: ['MZA', 'MZB', 'MZG']},
    markets,
    usdcAuthorizationTypedData: {domain: {chainId: 10143, verifyingContract: MONAD_TESTNET_USDC},
      types: {}, primaryType: 'ReceiveWithAuthorization', message: {from: owner, to: vault, value: amountUnits,
        validAfter: '0', validBefore: String(setupDeadline), nonce: `0x${'a'.repeat(64)}`}},
    mandateTypedData: {domain: {chainId: 10143, verifyingContract: factory}, types: {}, primaryType: 'PerpMandate',
      message: {chainId: 10143, owner, vault, usdc: MONAD_TESTNET_USDC, clearinghouse, executor,
        tokens: markets.map(item => item.tokenAddress), pools: markets.map(item => item.poolAddress),
        fundingAmount: amountUnits, durationSeconds, setupDeadline, policyVersion: 1, nonce: '7'}},
  };
}

describe('Perp enrollment review validation', () => {
  it('accepts exact owner, funding, policy, and market bindings', () => {
    expect(() => validatePreparedPerp(prepared(), {ownerAddress: owner, amountUnits: '1000000', durationSeconds: 600})).not.toThrow();
  });

  it('rejects an authorization that sends a different amount', () => {
    const review = prepared();
    review.usdcAuthorizationTypedData.message.value = '2000000';
    expect(() => validatePreparedPerp(review, {ownerAddress: owner, amountUnits: '1000000', durationSeconds: 600})).toThrow('Circle USDC authorization');
  });

  it('rejects a mandate with a changed market pool or margin cap', () => {
    const wrongPool = prepared();
    (wrongPool.mandateTypedData.message.pools as string[])[1] = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(() => validatePreparedPerp(wrongPool, {ownerAddress: owner, amountUnits: '1000000', durationSeconds: 600})).toThrow('perp mandate');
    const wrongPolicy = prepared(); wrongPolicy.policy.maxMarginUnits = '2000000';
    expect(() => validatePreparedPerp(wrongPolicy, {ownerAddress: owner, amountUnits: '1000000', durationSeconds: 600})).toThrow('test policy');
  });
});

describe('Perp owner stop review validation', () => {
  it('requires a fresh stop typed-data payload for this owner and vault', () => {
    const review = {runId: 'run-12345678', vaultAddress: vault, chainId: 10143, idempotencyKey: 'perp-stop-12345678',
      typedData: {domain: {chainId: 10143, verifyingContract: vault}, types: {}, primaryType: 'Stop',
        message: {vault, owner, nonce: '3', deadline: Math.floor(Date.now() / 1000) + 200}}};
    expect(() => validatePerpStop(review, owner, vault)).not.toThrow();
    expect(() => validatePerpStop(review, owner, factory)).toThrow('stop review');
  });

  it('accepts only a 65-byte signature', () => {
    expect(() => validatePerpSignature(`0x${'a'.repeat(130)}`)).not.toThrow();
    expect(() => validatePerpSignature('0x1234')).toThrow('invalid signature');
  });
});
