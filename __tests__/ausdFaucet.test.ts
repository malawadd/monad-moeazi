import {describe, expect, it} from '@jest/globals';
import {encodeFunctionData} from 'viem';
import {MONAD_AUSD_ADDRESS, MONAD_AUSD_FAUCET_ABI, MONAD_AUSD_FAUCET_ADDRESS} from '../src/config/monadAUsd';
import {validatePreparedMonadOperation} from '../src/services/monadValidation';

const owner = '0xbb66e7bc26d8a81c36a2f900d141a1fa786a98d8';
const expected = {ownerAddress: owner, kind: 'claim_ausd_faucet' as const, asset: 'AUSD', recipient: owner,
  tokenAddress: MONAD_AUSD_ADDRESS, faucetAddress: MONAD_AUSD_FAUCET_ADDRESS, method: 'requestFunds(address)'};
const prepared: any = {
  operationId: 'ausd-faucet-test', chainId: 10143, ownerAddress: owner, kind: 'claim_ausd_faucet',
  expiresAt: Date.now() + 120_000, transactionType: 'eip1559',
  transaction: {chainId: 10143, type: 2, to: MONAD_AUSD_FAUCET_ADDRESS,
    data: encodeFunctionData({abi: MONAD_AUSD_FAUCET_ABI, functionName: 'requestFunds', args: [owner]}),
    value: '0', nonce: '4', gasLimit: '130471', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'},
  review: {...expected},
};

describe('Agora AUSD faucet review', () => {
  it('accepts only the exact faucet call for the signed-in Mera address', () => {
    expect(() => validatePreparedMonadOperation(prepared, expected)).not.toThrow();
  });

  it('rejects a different recipient or transaction target', () => {
    const other = '0x0000000000000000000000000000000000001234';
    const wrongRecipient = {...prepared, transaction: {...prepared.transaction,
      data: encodeFunctionData({abi: MONAD_AUSD_FAUCET_ABI, functionName: 'requestFunds', args: [other]})}};
    expect(() => validatePreparedMonadOperation(wrongRecipient, expected)).toThrow(/Agora.*faucet/);
    expect(() => validatePreparedMonadOperation({...prepared, transaction: {...prepared.transaction, to: other}}, expected))
      .toThrow(/Agora.*faucet/);
  });

  it('rejects a nonzero native value and wrong review contract', () => {
    expect(() => validatePreparedMonadOperation({...prepared,
      transaction: {...prepared.transaction, value: '1'}}, expected)).toThrow(/Agora.*faucet/);
    expect(() => validatePreparedMonadOperation({...prepared, review: {...prepared.review, faucetAddress: owner}}, expected))
      .toThrow(/reviewed faucetAddress/);
  });
});
