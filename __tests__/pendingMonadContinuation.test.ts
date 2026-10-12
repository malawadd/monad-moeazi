jest.mock('../src/services/monadApi', () => ({monadApi: {
  operation: jest.fn(), broadcast: jest.fn(), prepare: jest.fn(), submit: jest.fn(),
}}));

import {monadApi} from '../src/services/monadApi';
import {broadcastVerifiedMonadOperation, validateOwnerMonadOperation, verifiedContinuationFromStatus} from '../src/services/pendingMonadContinuation';
import type {PendingOperationReference} from '../src/services/pendingOperationJournal';

const owner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const recipient = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const reference: PendingOperationReference = {kind: 'monad-operation', id: 'same-operation-1', action: 'submit', createdAt: 10};
function operation(overrides: Record<string, unknown> = {}) {
  return {operationId: reference.id, ownerAddress: owner, chainId: 10143, kind: 'send_mon', status: 'verified',
    expiresAt: Date.now() + 60_000, transactionType: 'eip1559',
    transaction: {chainId: 10143, type: 2, to: recipient, data: '0x1234', value: '100', nonce: '3', gasLimit: '21000',
      maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'},
    review: {kind: 'send_mon', ownerAddress: owner, amount: '0.1', amountUnits: '100000000000000000', asset: 'MON', recipient}, ...overrides};
}
const mocks = monadApi as jest.Mocked<typeof monadApi>;

beforeEach(() => { jest.clearAllMocks(); });

test('continues the same fresh verified operation only after explicit review and a second exact GET', async () => {
  const saved = operation();
  const continuation = verifiedContinuationFromStatus(saved as any, owner, reference.id);
  expect(continuation).not.toBeNull();
  mocks.operation.mockResolvedValueOnce(saved as any);
  mocks.broadcast.mockResolvedValueOnce({...saved, status: 'submitted'} as any);
  const result = await broadcastVerifiedMonadOperation(owner, reference, continuation!);
  expect(mocks.operation).toHaveBeenCalledWith(reference.id);
  expect(mocks.broadcast).toHaveBeenCalledWith(reference.id);
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(result.status).toBe('submitted');
});

test.each([
  ['different owner', {ownerAddress: '0xcccccccccccccccccccccccccccccccccccccccc'}],
  ['different ID', {operationId: 'other-operation'}],
  ['different chain', {chainId: 1}],
  ['unknown kind', {kind: 'unknown_kind'}],
  ['unknown status', {status: 'broadcasted'}],
])('rejects an operation GET with %s before broadcast', (label, fields) => {
  expect(() => validateOwnerMonadOperation(operation(fields), owner, reference.id)).toThrow();
});

test.each([
  ['different known kind', {kind: 'wallet_swap'}],
  ['no longer verified', {status: 'submitted'}],
])('does not continue an operation after %s', async (_label, fields) => {
  const continuation = verifiedContinuationFromStatus(operation() as any, owner, reference.id)!;
  mocks.operation.mockResolvedValueOnce(operation(fields) as any);
  await expect(broadcastVerifiedMonadOperation(owner, reference, continuation)).rejects.toThrow();
  expect(mocks.broadcast).not.toHaveBeenCalled();
});

test('does not broadcast if review or transaction terms change between display and confirmation', async () => {
  const continuation = verifiedContinuationFromStatus(operation() as any, owner, reference.id)!;
  mocks.operation.mockResolvedValueOnce(operation({review: {kind: 'send_mon', ownerAddress: owner, amount: '0.2', amountUnits: '200000000000000000', asset: 'MON', recipient}}) as any);
  await expect(broadcastVerifiedMonadOperation(owner, reference, continuation)).rejects.toThrow('review changed');
  expect(mocks.broadcast).not.toHaveBeenCalled();
});

test('does not offer continuation when amount and exact base units do not agree', () => {
  expect(verifiedContinuationFromStatus(operation({review: {kind: 'send_mon', ownerAddress: owner,
    amount: '0.1', amountUnits: '200000000000000000', asset: 'MON', recipient}}) as any, owner, reference.id)).toBeNull();
});

test('expired verified requests cannot be continued', async () => {
  const valid = operation();
  const continuation = verifiedContinuationFromStatus(valid as any, owner, reference.id)!;
  mocks.operation.mockResolvedValueOnce(operation({expiresAt: Date.now() - 1}) as any);
  await expect(broadcastVerifiedMonadOperation(owner, reference, continuation)).rejects.toThrow('no longer eligible');
  expect(mocks.broadcast).not.toHaveBeenCalled();
});

test('synchronous duplicate continuation taps cannot broadcast twice', async () => {
  const valid = operation();
  const continuation = verifiedContinuationFromStatus(valid as any, owner, reference.id)!;
  let release!: (value: any) => void;
  mocks.operation.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockResolvedValueOnce(valid as any);
  mocks.broadcast.mockResolvedValueOnce({...valid, status: 'submitted'} as any);
  const first = broadcastVerifiedMonadOperation(owner, reference, continuation);
  await Promise.resolve();
  await expect(broadcastVerifiedMonadOperation(owner, reference, continuation)).rejects.toThrow('already being continued');
  release(valid);
  await first;
  expect(mocks.broadcast).toHaveBeenCalledTimes(1);
});
