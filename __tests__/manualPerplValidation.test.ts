import {validateManualPerplPreparation, type ManualReviewExpectation} from '../src/services/manualPerplValidation';
import type {ManualPerplPreparedOperation} from '../src/types/manualPerpl';

const ownerAddress = '0x1111111111111111111111111111111111111111';
const destination = '0x2222222222222222222222222222222222222222';

function prepared(overrides: Partial<ManualPerplPreparedOperation> = {}): ManualPerplPreparedOperation {
  const transaction = {chainId: 10143, type: 'eip1559' as const, to: destination, data: '0x1234', value: '0', nonce: '4',
    gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'};
  return {
    operationId: 'operation-1', venueId: 'perpl-direct-testnet-v1', chainId: 10143, status: 'prepared', action: 'market_entry',
    expiresAt: Date.now() + 60_000, transaction,
    review: {action: 'market_entry', kind: 'market_entry', ownerAddress, chainId: 10143, venueId: 'perpl-direct-testnet-v1',
      marketId: '3', side: 'long', sizeUnits: '100', leverage: 2, transactionTarget: destination, transactionValue: '0',
      maxGas: {gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000', maxCostWei: '63000000000000'}},
    ...overrides,
  };
}

const expected: ManualReviewExpectation = {action: 'market_entry', ownerAddress, venueId: 'perpl-direct-testnet-v1', marketId: '3',
  side: 'long', sizeUnits: '100', leverage: 2};

describe('validateManualPerplPreparation', () => {
  it('accepts only a fresh owner and market bound EIP-1559 review', () => {
    expect(() => validateManualPerplPreparation(prepared(), expected)).not.toThrow();
  });

  it('rejects a review for a different Mera owner or venue', () => {
    expect(() => validateManualPerplPreparation(prepared({review: {...prepared().review, ownerAddress: destination}}), expected)).toThrow(/owner/);
    expect(() => validateManualPerplPreparation(prepared({venueId: 'another-venue'}), expected)).toThrow(/venue and chain/);
  });

  it('rejects changed order terms and transaction destination', () => {
    const base = prepared();
    expect(() => validateManualPerplPreparation(prepared({review: {...base.review, sizeUnits: '101'}}), expected)).toThrow(/sizeUnits/);
    expect(() => validateManualPerplPreparation(prepared({review: {...base.review, transactionTarget: ownerAddress}}), expected)).toThrow(/destination/);
  });

  it('rejects gas review that differs from the signed transaction', () => {
    const base = prepared();
    expect(() => validateManualPerplPreparation(prepared({review: {...base.review,
      maxGas: {...(base.review.maxGas as Record<string, unknown>), maxCostWei: '1'}}}), expected)).toThrow(/maximum gas/);
  });

  it('rejects expired operations', () => {
    expect(() => validateManualPerplPreparation(prepared({expiresAt: Date.now() - 1}), expected)).toThrow(/expired/);
  });
});
