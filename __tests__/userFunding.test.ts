import {encodeFunctionData} from 'viem';
import {MONAD_AUSD_FAUCET_ABI, MONAD_AUSD_FAUCET_ADDRESS} from '../src/config/monadAUsd';
import {runSingleFlightAction} from '../src/services/singleFlightAction';
import {prepareUserAusdClaim} from '../src/services/userAusdFunding';
import {resolveForFundingOwner} from '../src/services/userFundingOwnerScope';
import {monadApi} from '../src/services/monadApi';
import {loadPendingOperationReferences, removePendingOperation, type PendingOperationReference} from '../src/services/pendingOperationJournal';
import type {PreparedMonadOperation} from '../src/types/monad';

jest.mock('../src/services/monadApi', () => ({
  monadApi: {prepareAusdFaucet: jest.fn(), operation: jest.fn()},
  createMonadIdempotencyKey: () => 'test-idempotency-key',
}));
jest.mock('../src/services/pendingOperationJournal', () => ({
  loadPendingOperationReferences: jest.fn(), removePendingOperation: jest.fn(),
}));

const owner = '0x1111111111111111111111111111111111111111';
const pendingReference: PendingOperationReference = {kind: 'monad-operation', id: 'operation-1', action: 'submit', createdAt: 100};
const data = encodeFunctionData({abi: MONAD_AUSD_FAUCET_ABI, functionName: 'requestFunds', args: [owner]});

function prepared(): PreparedMonadOperation {
  return {operationId: 'operation-1', chainId: 10143, ownerAddress: owner, kind: 'claim_ausd_faucet',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), transactionType: 'eip1559' as const,
    transaction: {chainId: 10143, type: 2 as const, to: MONAD_AUSD_FAUCET_ADDRESS, data, value: '0', nonce: '1',
      gasLimit: '21000', maxFeePerGas: '2', maxPriorityFeePerGas: '1'},
    review: {asset: 'AUSD', recipient: owner, tokenAddress: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC',
      faucetAddress: MONAD_AUSD_FAUCET_ADDRESS, method: 'requestFunds(address)'}};
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(loadPendingOperationReferences).mockResolvedValue([]);
  jest.mocked(removePendingOperation).mockResolvedValue(undefined);
  jest.mocked(monadApi.operation).mockResolvedValue({operationId: 'operation-1', ownerAddress: owner,
    chainId: 10143, kind: 'claim_ausd_faucet', status: 'verified'});
  jest.mocked(monadApi.prepareAusdFaucet).mockResolvedValue(prepared());
});

test('AUSD preparation keeps the existing exact faucet validation and owner binding', async () => {
  const result = await prepareUserAusdClaim(owner);
  expect(result.prepared.kind).toBe('claim_ausd_faucet');
  expect(result.expected).toMatchObject({ownerAddress: owner, asset: 'AUSD', recipient: owner,
    faucetAddress: MONAD_AUSD_FAUCET_ADDRESS, method: 'requestFunds(address)'});
  expect(monadApi.prepareAusdFaucet).toHaveBeenCalledWith('test-idempotency-key');
});

test('an uncertain same-owner AUSD operation blocks a second prepare', async () => {
  jest.mocked(loadPendingOperationReferences).mockResolvedValue([pendingReference]);
  jest.mocked(monadApi.operation).mockResolvedValue({operationId: pendingReference.id, ownerAddress: owner,
    chainId: 10143, kind: 'claim_ausd_faucet', status: 'verified'});
  await expect(prepareUserAusdClaim(owner)).rejects.toThrow('earlier AUSD request is still being checked');
  expect(monadApi.prepareAusdFaucet).not.toHaveBeenCalled();
});

test('only an authoritative terminal status releases a saved AUSD reference', async () => {
  jest.mocked(loadPendingOperationReferences).mockResolvedValue([pendingReference]);
  jest.mocked(monadApi.operation).mockResolvedValue({operationId: pendingReference.id, ownerAddress: owner,
    chainId: 10143, kind: 'claim_ausd_faucet', status: 'finalized'});
  await prepareUserAusdClaim(owner);
  expect(removePendingOperation).toHaveBeenCalledWith(owner, pendingReference);
  expect(monadApi.prepareAusdFaucet).toHaveBeenCalledTimes(1);
});

test('unavailable or mismatched references fail closed without a new prepare', async () => {
  jest.mocked(loadPendingOperationReferences).mockResolvedValue([pendingReference]);
  jest.mocked(monadApi.operation).mockRejectedValueOnce(new Error('offline'));
  await expect(prepareUserAusdClaim(owner)).rejects.toThrow('status could not be checked');
  jest.mocked(monadApi.operation).mockResolvedValueOnce({operationId: pendingReference.id, ownerAddress: '0x2222222222222222222222222222222222222222',
    chainId: 10143, kind: 'claim_ausd_faucet', status: 'failed'});
  await expect(prepareUserAusdClaim(owner)).rejects.toThrow('could not be matched');
  expect(monadApi.prepareAusdFaucet).not.toHaveBeenCalled();
});

test('duplicate funding taps share one synchronous owner lock', async () => {
  let finish: (() => void) | undefined;
  const action = jest.fn(async () => { await new Promise<void>(resolve => { finish = resolve; }); return 'prepared'; });
  const first = runSingleFlightAction(`ausd:${owner}`, action);
  const second = await runSingleFlightAction(`ausd:${owner}`, action);
  expect(second).toEqual({started: false});
  expect(action).toHaveBeenCalledTimes(1);
  finish?.();
  await expect(first).resolves.toEqual({started: true, value: 'prepared'});
  await expect(runSingleFlightAction(`ausd:${owner}`, async () => 'again')).resolves.toEqual({started: true, value: 'again'});
});

test('a deferred funding result is discarded after the active Mera owner changes', async () => {
  let currentOwner: string | null = owner;
  let complete: ((value: string) => void) | undefined;
  const pending = resolveForFundingOwner(owner, () => currentOwner,
    () => new Promise<string>(resolve => { complete = resolve; }));
  currentOwner = '0x2222222222222222222222222222222222222222';
  complete?.('prepared-for-original-owner');
  await expect(pending).resolves.toBeNull();
});
