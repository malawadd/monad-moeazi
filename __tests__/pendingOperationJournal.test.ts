import AsyncStorage from '@react-native-async-storage/async-storage';
import {loadPendingOperationReferences, pendingOperationStorageKey, recordPendingOperation} from '../src/services/pendingOperationJournal';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const OWNER_A = '0x1111111111111111111111111111111111111111';
const OWNER_B = '0x2222222222222222222222222222222222222222';

beforeEach(async () => { await AsyncStorage.clear(); });

test('pending references are owner-scoped and contain only allowlisted IDs and fields', async () => {
  await recordPendingOperation(OWNER_A, {kind: 'monad-operation', id: 'op_123', action: 'submit'});
  await recordPendingOperation(OWNER_B, {kind: 'perpl-run', id: 'run_456', action: 'enroll'});
  const [a] = await loadPendingOperationReferences(OWNER_A);
  expect(a).toMatchObject({kind: 'monad-operation', id: 'op_123', action: 'submit'});
  expect(await loadPendingOperationReferences(OWNER_B)).toHaveLength(1);
  expect(pendingOperationStorageKey(OWNER_A)).not.toBe(pendingOperationStorageKey(OWNER_B));

  const key = pendingOperationStorageKey(OWNER_A);
  await AsyncStorage.setItem(key, JSON.stringify([{...a, signedTransaction: '0xsecret', arbitrary: {payload: true}}]));
  expect(await loadPendingOperationReferences(OWNER_A)).toEqual([{
    kind: 'monad-operation', id: 'op_123', action: 'submit', createdAt: a.createdAt,
  }]);
});

test.each([
  {kind: 'monad-operation', id: 'op_123', action: 'stop'},
  {kind: 'unknown', id: 'op_123', action: 'submit'},
  {kind: 'perp-stop', id: 'key_1', action: 'stop'},
  {kind: 'perpl-recovery', id: 'run:unsafe', action: 'recover_available_ausd'},
  {kind: 'monad-operation', id: 'op_123', action: 'submit', txHash: `0x${'a'.repeat(64)}`},
  {kind: 'perpl-recovery', id: 'run_123', action: 'recover_available_ausd', txHash: 'not-a-hash'},
])('malformed references fail closed: %p', async reference => {
  await AsyncStorage.setItem(pendingOperationStorageKey(OWNER_A), JSON.stringify([{...reference, createdAt: 1}]));
  await expect(loadPendingOperationReferences(OWNER_A)).rejects.toThrow();
});

test('legacy Perpl references stay readable while signed Perpl hashes are allowlisted', async () => {
  const key = pendingOperationStorageKey(OWNER_A);
  await AsyncStorage.setItem(key, JSON.stringify([
    {kind: 'perpl-stop', id: 'run_123', action: 'stop', createdAt: 1},
    {kind: 'perpl-recovery', id: 'run_456', action: 'recover_vault_funding', txHash: `0x${'B'.repeat(64)}`, createdAt: 2, rawTransaction: '0xsecret'},
  ]));
  expect(await loadPendingOperationReferences(OWNER_A)).toEqual([
    {kind: 'perpl-stop', id: 'run_123', action: 'stop', createdAt: 1},
    {kind: 'perpl-recovery', id: 'run_456', action: 'recover_vault_funding', txHash: `0x${'b'.repeat(64)}`, createdAt: 2},
  ]);
});

test('runtime callers cannot smuggle extra properties into a persisted record', async () => {
  await expect(recordPendingOperation(OWNER_A, {
    kind: 'monad-operation', id: 'op_123', action: 'submit', signature: '0xprivate',
  } as never)).resolves.toBeUndefined();
  const raw = await AsyncStorage.getItem(pendingOperationStorageKey(OWNER_A));
  expect(raw).not.toContain('signature');
  expect(JSON.parse(raw!)[0]).toEqual(expect.objectContaining({kind: 'monad-operation', id: 'op_123', action: 'submit'}));
});
