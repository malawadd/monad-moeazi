jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {loadPendingOperationReferences, pendingOperationStorageKey, recordPendingOperation} from '../src/services/pendingOperationJournal';
import {dismissPendingOperationReminder, loadPendingOperationReminderReferences} from '../src/services/pendingOperationReminder';

const OWNER_A = '0x1111111111111111111111111111111111111111';
const OWNER_B = '0x2222222222222222222222222222222222222222';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

test('dismissal is owner-scoped and leaves the signed operation journal intact', async () => {
  await recordPendingOperation(OWNER_A, {kind: 'perpl-run', id: 'run_active', action: 'enroll'});
  await recordPendingOperation(OWNER_A, {kind: 'monad-operation', id: 'op_pending', action: 'submit'});
  await recordPendingOperation(OWNER_B, {kind: 'perpl-run', id: 'run_active', action: 'enroll'});
  const rowsA = await loadPendingOperationReferences(OWNER_A);
  const rowsB = await loadPendingOperationReferences(OWNER_B);

  await dismissPendingOperationReminder(OWNER_A, rowsA[0]);

  await expect(loadPendingOperationReminderReferences(OWNER_A, rowsA)).resolves.toEqual([rowsA[1]]);
  await expect(loadPendingOperationReminderReferences(OWNER_B, rowsB)).resolves.toEqual(rowsB);
  await expect(loadPendingOperationReferences(OWNER_A)).resolves.toEqual(rowsA);
});

test('a new save with the same kind, ID, and action gets a fresh reminder', async () => {
  jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
  const input = {kind: 'perpl-run' as const, id: 'run_123', action: 'enroll' as const};
  await recordPendingOperation(OWNER_A, input);
  const [first] = await loadPendingOperationReferences(OWNER_A);
  await dismissPendingOperationReminder(OWNER_A, first);

  await recordPendingOperation(OWNER_A, input);
  const [replacement] = await loadPendingOperationReferences(OWNER_A);

  expect(replacement.createdAt).toBe(2000);
  await expect(loadPendingOperationReminderReferences(OWNER_A, [replacement])).resolves.toEqual([replacement]);
});

test('corrupt dismissal data fails open so references remain visible', async () => {
  await recordPendingOperation(OWNER_A, {kind: 'monad-operation', id: 'op_123', action: 'submit'});
  const [reference] = await loadPendingOperationReferences(OWNER_A);
  await AsyncStorage.setItem(`${pendingOperationStorageKey(OWNER_A)}.reminder-dismissals.v1`, '{bad json');

  await expect(loadPendingOperationReminderReferences(OWNER_A, [reference])).resolves.toEqual([reference]);
});
