import {encodeFunctionData} from 'viem';
import {validateManualPerplOperationStatus, validateManualPerplPreparation, validateManualPerplSubmissionAcknowledgement,
  readValidatedManualPerplOperationStatus,
  type ManualReviewExpectation} from '../src/services/manualPerplValidation';
import type {ManualPerplOperationStatus, ManualPerplPreparedOperation} from '../src/types/manualPerpl';

const ownerAddress = '0x1111111111111111111111111111111111111111';
const destination = '0x2222222222222222222222222222222222222222';

function prepared(overrides: Partial<ManualPerplPreparedOperation> = {}): ManualPerplPreparedOperation {
  const expiresAt = Date.now() + 60_000;
  const transaction = {chainId: 10143, type: 'eip1559' as const, to: destination, data: '0x1234', value: '0', nonce: '4',
    gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'};
  const base: ManualPerplPreparedOperation = {
    operationId: 'operation-1', venueId: 'perpl-direct-testnet-v1', chainId: 10143, status: 'prepared', action: 'market_entry',
    expiresAt, transaction,
    review: {action: 'market_entry', kind: 'market_entry', ownerAddress, chainId: 10143, venueId: 'perpl-direct-testnet-v1',
      marketId: '3', side: 'long', sizeUnits: '100', leverage: 2, transactionTarget: destination,
      transactionData: transaction.data, transactionNonce: transaction.nonce, transactionValue: '0', expiresAt,
      maxGas: {gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000', maxCostWei: '63000000000000'}},
    ...overrides,
  };
  return {...base, review: {...base.review, expiresAt: overrides.expiresAt ?? expiresAt}};
}

const expected: ManualReviewExpectation = {action: 'market_entry', ownerAddress, venueId: 'perpl-direct-testnet-v1', marketId: '3',
  side: 'long', sizeUnits: '100', leverage: 2, transactionTarget: destination};

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

  it('compares limit prices as exact decimals at the validated market precision', () => {
    const base = prepared();
    const priceExpected = {...expected, limitPrice: '3000', priceDecimals: 2};
    expect(() => validateManualPerplPreparation({...base, review: {...base.review, priceDecimals: 2, limitPrice: '3000.0'}}, priceExpected)).not.toThrow();
    expect(() => validateManualPerplPreparation({...base, review: {...base.review, priceDecimals: 2, limitPrice: '3000.01'}}, priceExpected)).toThrow(/limitPrice/);
    expect(() => validateManualPerplPreparation({...base, review: {...base.review, priceDecimals: 2, limitPrice: '3000.001'}}, priceExpected)).toThrow(/limitPrice/);
    expect(() => validateManualPerplPreparation({...base, review: {...base.review, priceDecimals: 4, limitPrice: '3000.0'}}, priceExpected)).toThrow(/limitPrice/);
    expect(() => validateManualPerplPreparation({...base, review: {...base.review, priceDecimals: 2, limitPrice: '3e3'}}, priceExpected)).toThrow(/limitPrice/);
  });

  it('rejects calldata and nonce that differ from the prepared transaction', () => {
    const base = prepared();
    expect(() => validateManualPerplPreparation(prepared({review: {...base.review, transactionData: '0xabcd'}}), expected)).toThrow(/calldata/);
    expect(() => validateManualPerplPreparation(prepared({review: {...base.review, transactionNonce: '5'}}), expected)).toThrow(/nonce/);
  });

  it('decodes exact AUSD approval spender and createAccount deposit', () => {
    const approveAbi = [{type: 'function', name: 'approve', stateMutability: 'nonpayable',
      inputs: [{name: 'spender', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}]}] as const;
    const createAbi = [{type: 'function', name: 'createAccount', stateMutability: 'nonpayable',
      inputs: [{name: 'amountCNS', type: 'uint256'}], outputs: [{type: 'uint256'}]}] as const;
    const amountUnits = '100000000';
    const approveData = encodeFunctionData({abi: approveAbi, functionName: 'approve', args: [destination, BigInt(amountUnits)]});
    const approveBase = prepared();
    const approval = prepared({action: 'approve', transaction: {...approveBase.transaction, to: ownerAddress, data: approveData},
      review: {...approveBase.review, action: 'approve', kind: 'approve', amountUnits, transactionTarget: ownerAddress,
        transactionData: approveData}});
    expect(() => validateManualPerplPreparation(approval, {action: 'approve', ownerAddress, venueId: 'perpl-direct-testnet-v1',
      amountUnits, transactionTarget: ownerAddress, approvalSpender: destination})).not.toThrow();
    const createData = encodeFunctionData({abi: createAbi, functionName: 'createAccount', args: [BigInt(amountUnits)]});
    const creation = prepared({action: 'open', transaction: {...approveBase.transaction, data: createData},
      review: {...approveBase.review, action: 'open', kind: 'open', amountUnits, transactionData: createData}});
    expect(() => validateManualPerplPreparation(creation, {action: 'open', ownerAddress, venueId: 'perpl-direct-testnet-v1',
      amountUnits, transactionTarget: destination})).not.toThrow();
  });

  it('rejects expired operations', () => {
    expect(() => validateManualPerplPreparation(prepared({expiresAt: Date.now() - 1}), expected)).toThrow(/expired/);
  });

  it('rejects operation GETs unless the original owner, ID, action, account, market, chain and expiry all match', () => {
    const original = prepared();
    const originalExpected = {...expected, accountAddress: destination};
    const operation: ManualPerplOperationStatus = {operationId: original.operationId, status: 'finalized', chainId: 10143,
      venueId: original.venueId, action: original.action, expiresAt: original.expiresAt,
      review: {...original.review, accountAddress: destination}};
    expect(() => validateManualPerplOperationStatus(operation, original, originalExpected, ownerAddress)).not.toThrow();
    const invalid = [
      {...operation, operationId: 'another'},
      {...operation, chainId: 1},
      {...operation, venueId: 'another'},
      {...operation, action: 'limit_entry'},
      {...operation, expiresAt: Date.now() + 999_000},
      {...operation, review: {...operation.review, ownerAddress: destination}},
      {...operation, review: {...operation.review, accountAddress: ownerAddress}},
      {...operation, review: {...operation.review, marketId: 'different'}},
    ];
    for (const response of invalid) {
      expect(() => validateManualPerplOperationStatus(response, original, originalExpected, ownerAddress)).toThrow(/does not match/);
    }
    expect(() => validateManualPerplOperationStatus(operation, original, originalExpected, destination)).toThrow(/does not match/);
  });

  it('accepts explicit account-operation DTO action aliases while matching review.action to the prepared intent', () => {
    const expiresAt = Date.now() + 60_000;
    const original = prepared({action: 'approve', expiresAt,
      review: {...prepared().review, action: 'approve', kind: 'approve', ownerAddress, accountMode: 'direct_wallet',
        accountAddress: ownerAddress, expiresAt}});
    const expectedApproval: ManualReviewExpectation = {action: 'approve', ownerAddress, accountAddress: ownerAddress};
    const status: ManualPerplOperationStatus = {operationId: original.operationId, status: 'finalized', chainId: 10143,
      venueId: original.venueId, action: 'approve_collateral', expiresAt,
      review: {...original.review, action: 'approve', ownerAddress, accountAddress: ownerAddress, expiresAt}};
    expect(() => validateManualPerplOperationStatus(status, original, expectedApproval, ownerAddress)).not.toThrow();
    expect(() => validateManualPerplOperationStatus({...status, action: 'open_account'}, original, expectedApproval, ownerAddress)).toThrow(/does not match/);
    expect(() => validateManualPerplOperationStatus({...status, review: {...status.review, action: 'deposit'}}, original,
      expectedApproval, ownerAddress)).toThrow(/does not match/);
  });
});

describe('manual Perpl submit acknowledgements', () => {
  it('accepts a sparse response only as an acknowledgement for the exact original ID', () => {
    expect(() => validateManualPerplSubmissionAcknowledgement({operationId: 'operation-1', status: 'submitted'}, 'operation-1')).not.toThrow();
    expect(() => validateManualPerplSubmissionAcknowledgement({operationId: 'other-operation', status: 'finalized'}, 'operation-1'))
      .toThrow(/original operation ID/);
    expect(() => validateManualPerplSubmissionAcknowledgement({status: 'submitted'}, 'operation-1')).toThrow(/original operation ID/);
    // Full owner/action/expiry/status identity remains the responsibility of validateManualPerplOperationStatus on the GET.
  });
});

describe('manual Perpl status reads during finality reconciliation', () => {
  it('rereads only the exact sparse finalization DTO by the original ID before applying strict GET validation', async () => {
    const original = prepared();
    const originalExpected = {...expected, accountAddress: destination};
    const complete: ManualPerplOperationStatus = {operationId: original.operationId, status: 'finalized', chainId: 10143,
      venueId: original.venueId, action: original.action, expiresAt: original.expiresAt,
      review: {...original.review, accountAddress: destination}};
    const sparse = {operationId: original.operationId, status: 'finalized', chainId: 10143, venueId: original.venueId,
      transactionHash: `0x${'a'.repeat(64)}`, receipt: null, result: null, errorCode: null,
      review: {transactionTarget: null, transactionData: null, transactionNonce: null, transactionValue: '0'}} as ManualPerplOperationStatus;
    const read = jest.fn().mockResolvedValueOnce(sparse).mockResolvedValueOnce(complete);
    await expect(readValidatedManualPerplOperationStatus(read, original, originalExpected, ownerAddress)).resolves.toEqual(complete);
    expect(read).toHaveBeenNthCalledWith(1, original.operationId);
    expect(read).toHaveBeenNthCalledWith(2, original.operationId);
  });

  it('does not retry a wrong-ID or wrong-owner GET as if it were the sparse finalization DTO', async () => {
    const original = prepared();
    const originalExpected = {...expected, accountAddress: destination};
    const wrongId = {operationId: 'other-operation', status: 'finalized', chainId: 10143, venueId: original.venueId,
      transactionHash: `0x${'a'.repeat(64)}`, receipt: null, result: null, errorCode: null,
      review: {transactionTarget: null, transactionData: null, transactionNonce: null, transactionValue: '0'}} as ManualPerplOperationStatus;
    const wrongOwner: ManualPerplOperationStatus = {operationId: original.operationId, status: 'finalized', chainId: 10143,
      venueId: original.venueId, action: original.action, expiresAt: original.expiresAt,
      review: {...original.review, ownerAddress: destination, accountAddress: destination}};
    for (const response of [wrongId, wrongOwner]) {
      const read = jest.fn().mockResolvedValue(response);
      await expect(readValidatedManualPerplOperationStatus(read, original, originalExpected, ownerAddress)).rejects.toThrow(/does not match/);
      expect(read).toHaveBeenCalledTimes(1);
    }
  });
});
