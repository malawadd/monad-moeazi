jest.mock('../src/services/monadApi', () => ({monadApi: {operation: jest.fn()}}));
jest.mock('../src/services/manualPerplApi', () => ({manualPerplApi: {operation: jest.fn()}}));
jest.mock('../src/services/autonomyApi', () => ({autonomyApi: {current: jest.fn(), history: jest.fn()}}));
jest.mock('../src/services/perplApi', () => ({perplApi: {runHistory: jest.fn()}}));
jest.mock('../src/services/perpAutonomyApi', () => ({perpAutonomyApi: {runHistory: jest.fn()}}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {monadApi} from '../src/services/monadApi';
import {manualPerplApi} from '../src/services/manualPerplApi';
import {perplApi} from '../src/services/perplApi';
import {loadPendingOperationReferences, pendingOperationStorageKey, recordPendingOperation} from '../src/services/pendingOperationJournal';
import {reconcilePendingOperation} from '../src/services/pendingOperationReconcile';

const OWNER = '0x1111111111111111111111111111111111111111';
const monadOperation = (operationId: string, overrides: Record<string, unknown> = {}) => ({operationId, ownerAddress: OWNER,
  chainId: 10143, kind: 'send_mon', status: 'verified', expiresAt: new Date(Date.now() + 60_000).toISOString(),
  transactionType: 'eip1559', transaction: {chainId: 10143, type: 2, to: '0x2222222222222222222222222222222222222222',
    data: '0x1234', value: '1', nonce: '2', gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'},
  review: {kind: 'send_mon', ownerAddress: OWNER, amount: '0.1', amountUnits: '100000000000000000', asset: 'MON', recipient: '0x3333333333333333333333333333333333333333'}, ...overrides});

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('verified Monad status stays tracked and is never treated as broadcast or final', async () => {
  const reference = {kind: 'monad-operation' as const, id: 'op_123', action: 'submit' as const};
  await recordPendingOperation(OWNER, reference);
  (monadApi.operation as jest.Mock).mockResolvedValue(monadOperation(reference.id));
  const result = await reconcilePendingOperation(OWNER, {...reference, createdAt: Date.now()});
  expect(result).toMatchObject({disposition: 'tracked', status: 'verified'});
  expect(result.continuation?.operationId).toBe(reference.id);
  expect(await loadPendingOperationReferences(OWNER)).toHaveLength(1);
  expect(monadApi.operation).toHaveBeenCalledWith(reference.id);
});

test('finding a prepared Perpl run does not clear the journal entry', async () => {
  const reference = {kind: 'perpl-run' as const, id: 'run_123', action: 'enroll' as const};
  await recordPendingOperation(OWNER, reference);
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: {runId: reference.id, ownerAddress: OWNER, status: 'prepared'}, events: []});
  const result = await reconcilePendingOperation(OWNER, {...reference, createdAt: Date.now()});
  expect(result).toMatchObject({disposition: 'tracked', status: 'prepared'});
  expect(await loadPendingOperationReferences(OWNER)).toHaveLength(1);
});

test('failed Perpl enrollment remains reachable while vault funding recovery is available', async () => {
  const reference = {kind: 'perpl-run' as const, id: 'run_recover_123', action: 'enroll' as const};
  await recordPendingOperation(OWNER, reference);
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: {
    runId: reference.id, ownerAddress: OWNER, status: 'failed', recoveryAvailable: true,
    recoveryActions: ['recover_vault_funding'],
  }, events: []});
  const result = await reconcilePendingOperation(OWNER, {...reference, createdAt: Date.now()});
  expect(result).toMatchObject({disposition: 'tracked', status: 'failed'});
  expect(result.note).toMatch(/recovery/i);
  expect(await loadPendingOperationReferences(OWNER)).toHaveLength(1);
});

const TX_HASH = `0x${'a'.repeat(64)}`;
const perplRun = (overrides: Record<string, unknown> = {}) => ({runId: 'run_recovery_123', ownerAddress: OWNER,
  venueId: 'perpl-direct-testnet-v1', chainId: 10143, vaultAddress: '0x3333333333333333333333333333333333333333',
  status: 'incomplete_settlement', phase: 'recovery_finality_pending', ...overrides});
const signedRecovery = (createdAt: number, overrides: Record<string, unknown> = {}) => ({kind: 'perpl_recovery_signed',
  status: 'signed', txHash: TX_HASH, timestamp: createdAt + 10, details: {action: 'recover_vault_funding'}, ...overrides});

test('Perpl recovery resolves only with exact signed hash, action, and later terminal evidence', async () => {
  const reference = {kind: 'perpl-recovery' as const, id: 'run_recovery_123', action: 'recover_vault_funding' as const, txHash: TX_HASH};
  await recordPendingOperation(OWNER, reference);
  const [saved] = await loadPendingOperationReferences(OWNER);
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: perplRun({status: 'completed'}), events: [
    signedRecovery(saved.createdAt), {kind: 'perpl_recovery_finalized', status: 'completed', txHash: TX_HASH,
      timestamp: saved.createdAt + 20, details: {action: reference.action}},
  ]});
  const result = await reconcilePendingOperation(OWNER, saved);
  expect(result).toMatchObject({disposition: 'resolved', status: 'completed'});
  expect(await loadPendingOperationReferences(OWNER)).toEqual([]);
});

test.each([
  ['different signed hash', (createdAt: number) => [signedRecovery(createdAt, {txHash: `0x${'b'.repeat(64)}`}),
    {kind: 'perpl_recovery_finalized', status: 'completed', txHash: TX_HASH, timestamp: createdAt + 20, details: {action: 'recover_vault_funding'}}]],
  ['different signed action', (createdAt: number) => [signedRecovery(createdAt, {details: {action: 'recover_available_ausd'}}),
    {kind: 'perpl_recovery_finalized', status: 'completed', txHash: TX_HASH, timestamp: createdAt + 20, details: {action: 'recover_vault_funding'}}]],
  ['terminal event before saved reference', (createdAt: number) => [signedRecovery(createdAt),
    {kind: 'perpl_recovery_finalized', status: 'completed', txHash: TX_HASH, timestamp: createdAt - 1, details: {action: 'recover_vault_funding'}}]],
])('Perpl recovery remains tracked with %s', async (_label, makeEvents) => {
  const reference = {kind: 'perpl-recovery' as const, id: 'run_recovery_123', action: 'recover_vault_funding' as const, txHash: TX_HASH};
  await recordPendingOperation(OWNER, reference);
  const [saved] = await loadPendingOperationReferences(OWNER);
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: perplRun({status: 'completed'}), events: makeEvents(saved.createdAt)});
  const result = await reconcilePendingOperation(OWNER, saved);
  expect(result.disposition).toBe('tracked');
  expect(await loadPendingOperationReferences(OWNER)).toHaveLength(1);
});

test('recovery event from another run or owner stays unavailable', async () => {
  const reference = {kind: 'perpl-recovery' as const, id: 'run_recovery_123', action: 'recover_vault_funding' as const, txHash: TX_HASH};
  await recordPendingOperation(OWNER, reference);
  const [saved] = await loadPendingOperationReferences(OWNER);
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: perplRun({runId: 'run_other'}), events: []});
  await expect(reconcilePendingOperation(OWNER, saved)).resolves.toMatchObject({disposition: 'unavailable'});
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: perplRun({ownerAddress: '0x2222222222222222222222222222222222222222'}), events: []});
  await expect(reconcilePendingOperation(OWNER, saved)).resolves.toMatchObject({disposition: 'unavailable'});
  expect(await loadPendingOperationReferences(OWNER)).toHaveLength(1);
});

test('a stop pointer resolves only when its exact signed hash reaches stop_finalized', async () => {
  const reference = {kind: 'perpl-stop' as const, id: 'run_recovery_123', action: 'stop' as const, txHash: TX_HASH};
  await recordPendingOperation(OWNER, reference);
  const [saved] = await loadPendingOperationReferences(OWNER);
  const event = {kind: 'perpl_stop_requested', status: 'signed', txHash: TX_HASH, timestamp: saved.createdAt + 2};
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: perplRun({status: 'stopping', phase: 'stop_finalized'}), events: [event]});
  expect(await reconcilePendingOperation(OWNER, saved)).toMatchObject({disposition: 'resolved', status: 'stop_finalized'});
  await recordPendingOperation(OWNER, reference);
  const [settlementSaved] = await loadPendingOperationReferences(OWNER);
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: perplRun({status: 'settling', phase: 'settlement_ready_prepared'}), events: [event]});
  expect(await reconcilePendingOperation(OWNER, settlementSaved)).toMatchObject({disposition: 'tracked'});
  expect(await loadPendingOperationReferences(OWNER)).toHaveLength(1);
});

test('legacy Perpl stop pointer without a hash is retained with a clear status', async () => {
  const reference = {kind: 'perpl-stop' as const, id: 'run_recovery_123', action: 'stop' as const, createdAt: Date.now()};
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: perplRun(), events: []});
  const result = await reconcilePendingOperation(OWNER, reference);
  expect(result).toMatchObject({disposition: 'tracked', note: expect.stringContaining('no signed-transaction hash')});
});

test('same owner GET terminal status removes only the pending pointer', async () => {
  const reference = {kind: 'manual-perpl-operation' as const, id: 'manual_123', action: 'submit' as const};
  await recordPendingOperation(OWNER, reference);
  const expiresAt = Date.now() + 60_000;
  (manualPerplApi.operation as jest.Mock).mockResolvedValue({operationId: reference.id, status: 'finalized', chainId: 10143,
    venueId: 'perpl-direct-testnet-v1', action: 'approve_collateral', expiresAt,
    review: {action: 'approve', ownerAddress: OWNER, chainId: 10143, venueId: 'perpl-direct-testnet-v1', expiresAt}});
  const result = await reconcilePendingOperation(OWNER, {...reference, createdAt: Date.now()});
  expect(result.disposition).toBe('resolved');
  expect(await loadPendingOperationReferences(OWNER)).toEqual([]);
  expect(await AsyncStorage.getItem(pendingOperationStorageKey(OWNER))).toBe('[]');
});

test('manual Perpl reconciliation accepts only explicit account action aliases and complete owner DTOs', async () => {
  const reference = {kind: 'manual-perpl-operation' as const, id: 'manual_approve_123', action: 'submit' as const};
  await recordPendingOperation(OWNER, reference);
  const expiresAt = Date.now() + 60_000;
  const dto = {operationId: reference.id, status: 'finalized', chainId: 10143, venueId: 'perpl-direct-testnet-v1',
    action: 'approve_collateral', expiresAt,
    review: {action: 'approve', ownerAddress: OWNER, chainId: 10143, venueId: 'perpl-direct-testnet-v1', expiresAt}};
  (manualPerplApi.operation as jest.Mock).mockResolvedValueOnce(dto);
  await expect(reconcilePendingOperation(OWNER, {...reference, createdAt: Date.now()})).resolves.toMatchObject({disposition: 'resolved'});
  await recordPendingOperation(OWNER, reference);
  (manualPerplApi.operation as jest.Mock).mockResolvedValueOnce({...dto, action: 'open_account'});
  await expect(reconcilePendingOperation(OWNER, {...reference, createdAt: Date.now()})).resolves.toMatchObject({disposition: 'unavailable'});
  expect(await loadPendingOperationReferences(OWNER)).toHaveLength(1);
});

test('identity mismatch is unavailable and retains the original ID', async () => {
  const reference = {kind: 'perpl-run' as const, id: 'run_123', action: 'enroll' as const};
  await recordPendingOperation(OWNER, reference);
  (perplApi.runHistory as jest.Mock).mockResolvedValue({run: {
    runId: 'run_other', ownerAddress: '0x2222222222222222222222222222222222222222', status: 'completed',
  }, events: []});
  const result = await reconcilePendingOperation(OWNER, {...reference, createdAt: Date.now()});
  expect(result.disposition).toBe('unavailable');
  expect(await loadPendingOperationReferences(OWNER)).toHaveLength(1);
});
