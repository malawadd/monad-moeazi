import {MONAD_TESTNET_USDC, type AutonomyTypedData, type PreparedAutonomyEnrollment} from '../src/types/autonomyTrading';
import {validateAutonomyOwnerChain, validatePreparedAutonomyEnrollment} from '../src/services/autonomyValidation';
import {toFunctionSelector} from 'viem';
import {validatePreparedMonadOperation} from '../src/services/monadValidation';
import type {PreparedMonadOperation} from '../src/types/monad';

const owner = `0x${'1'.repeat(40)}`;
const vault = `0x${'2'.repeat(40)}`;
const tokens = [`0x${'3'.repeat(40)}`, `0x${'4'.repeat(40)}`, `0x${'5'.repeat(40)}`];
const pools = [`0x${'6'.repeat(40)}`, `0x${'7'.repeat(40)}`, `0x${'8'.repeat(40)}`];
const now = 1_800_000_000_000;
const nowSeconds = Math.floor(now / 1000);
const authFields = [
  ['from', 'address'], ['to', 'address'], ['value', 'uint256'],
  ['validAfter', 'uint256'], ['validBefore', 'uint256'], ['nonce', 'bytes32'],
].map(([name, type]) => ({name, type}));
const mandateFields = [
  ['chainId', 'uint256'], ['owner', 'address'], ['vault', 'address'], ['usdc', 'address'],
  ['tokens', 'address[3]'], ['pools', 'address[3]'], ['fundingAmount', 'uint256'],
  ['durationSeconds', 'uint64'], ['startBy', 'uint64'], ['maxCycles', 'uint8'],
  ['buySlippageBps', 'uint16'], ['sellSlippageBps', 'uint16'], ['nonce', 'uint256'],
].map(([name, type]) => ({name, type}));

function fixture(): PreparedAutonomyEnrollment {
  const startBy = nowSeconds + 300;
  const usdcAuthorizationTypedData: AutonomyTypedData = {
    domain: {name: 'USDC', version: '2', chainId: 10143, verifyingContract: MONAD_TESTNET_USDC},
    types: {ReceiveWithAuthorization: authFields}, primaryType: 'ReceiveWithAuthorization',
    message: {from: owner, to: vault, value: '500000', validAfter: String(nowSeconds - 1),
      validBefore: String(startBy), nonce: `0x${'a'.repeat(64)}`},
  };
  const mandateTypedData: AutonomyTypedData = {
    domain: {name: 'Moeazi Monad Testnet Autonomy', version: '1', chainId: 10143, verifyingContract: vault},
    types: {StrategyMandate: mandateFields}, primaryType: 'StrategyMandate',
    message: {chainId: 10143, owner, vault, usdc: MONAD_TESTNET_USDC, tokens, pools,
      fundingAmount: '500000', durationSeconds: 1800, startBy, maxCycles: 3,
      buySlippageBps: 100, sellSlippageBps: 150, nonce: '9'},
  };
  return {enrollmentId: 'autonomy-enrollment-01', ownerAddress: owner, vaultAddress: vault,
    chainId: 10143, nonce: '9', startBy, preparedExpiresAt: startBy, amountUnits: '500000',
    durationSeconds: 1800, maxCycles: 3, maxBuyUnits: '500000', buySlippageBps: 100,
    sellSlippageBps: 150, tokens, pools, usdcAuthorizationTypedData, mandateTypedData};
}

describe('autonomous testnet enrollment review', () => {
  it('accepts two exact signatures for the same owner, vault, USDC cap, token set, and mandate', () => {
    expect(validatePreparedAutonomyEnrollment(fixture(), {ownerAddress: owner,
      amountUnits: '500000', durationSeconds: 1800}, now)).toBe(true);
  });

  it('rejects another chain, owner, vault, amount, or cycle limit', () => {
    expect(() => validatePreparedAutonomyEnrollment({...fixture(), chainId: 42161},
      {ownerAddress: owner, amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('Monad Testnet');
    expect(() => validatePreparedAutonomyEnrollment(fixture(), {ownerAddress: vault,
      amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('Mera owner');
    const wrongVault = fixture();
    wrongVault.usdcAuthorizationTypedData.message.to = owner;
    expect(() => validatePreparedAutonomyEnrollment(wrongVault, {ownerAddress: owner,
      amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('USDC authorization');
    const wrongFunding = fixture();
    wrongFunding.mandateTypedData.message.fundingAmount = '500001';
    expect(() => validatePreparedAutonomyEnrollment(wrongFunding, {ownerAddress: owner,
      amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('strategy authorization changed');
    expect(() => validatePreparedAutonomyEnrollment({...fixture(), maxCycles: 2},
      {ownerAddress: owner, amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('cycle limit');
  });

  it('rejects unapproved pools, altered slippage, malformed typed data, and expired reviews', () => {
    const wrongPools = fixture();
    wrongPools.mandateTypedData.message.pools = [...pools].reverse();
    expect(() => validatePreparedAutonomyEnrollment(wrongPools, {ownerAddress: owner,
      amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('approved venues');
    const tooMuchSlippage = fixture();
    tooMuchSlippage.mandateTypedData.message.sellSlippageBps = 501;
    expect(() => validatePreparedAutonomyEnrollment(tooMuchSlippage, {ownerAddress: owner,
      amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('strategy authorization changed');
    const wrongCircle = fixture();
    wrongCircle.usdcAuthorizationTypedData.domain.chainId = 42161;
    expect(() => validatePreparedAutonomyEnrollment(wrongCircle, {ownerAddress: owner,
      amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('wrong token or network');
    const extraMandateField = fixture();
    extraMandateField.mandateTypedData.types.StrategyMandate.push({name: 'operator', type: 'address'});
    expect(() => validatePreparedAutonomyEnrollment(extraMandateField, {ownerAddress: owner,
      amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('authorization type');
    expect(() => validatePreparedAutonomyEnrollment({...fixture(), startBy: nowSeconds - 1},
      {ownerAddress: owner, amountUnits: '500000', durationSeconds: 1800}, now)).toThrow('activation deadline');
  });

  it('requires status data to match the active Mera owner and chain', () => {
    expect(() => validateAutonomyOwnerChain(owner, {ownerAddress: owner, chainId: 10143})).not.toThrow();
    expect(() => validateAutonomyOwnerChain(owner, {ownerAddress: vault, chainId: 10143})).toThrow('does not match');
    expect(() => validateAutonomyOwnerChain(owner, {ownerAddress: owner, chainId: 42161})).toThrow('Monad Testnet');
  });

  it('allows owner recovery only through emergencyRecover on the exact enrollment vault', () => {
    const prepared: PreparedMonadOperation = {
      operationId: 'autonomy-recovery-01', chainId: 10143, ownerAddress: owner,
      kind: 'autonomy_recovery', expiresAt: now + 60_000, transactionType: 'eip1559',
      transaction: {chainId: 10143, type: 2, to: vault, data: toFunctionSelector('emergencyRecover()'),
        value: '0', nonce: '1', gasLimit: '80000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'},
      review: {vaultAddress: vault, enrollmentId: 'autonomy-enrollment-01', summary: 'Return owner assets'},
    };
    expect(() => validatePreparedMonadOperation(prepared, {ownerAddress: owner, kind: 'autonomy_recovery', vaultAddress: vault})).not.toThrow();
    expect(() => validatePreparedMonadOperation({...prepared, transaction: {...prepared.transaction, to: owner}},
      {ownerAddress: owner, kind: 'autonomy_recovery', vaultAddress: vault})).toThrow('emergencyRecover()');
    expect(() => validatePreparedMonadOperation({...prepared, transaction: {...prepared.transaction, data: '0xdeadbeef'}},
      {ownerAddress: owner, kind: 'autonomy_recovery', vaultAddress: vault})).toThrow('emergencyRecover()');
  });
});
