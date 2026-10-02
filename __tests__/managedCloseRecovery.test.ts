jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {clearManagedCloseKey, getOrCreateManagedCloseKey} from '../src/services/managedCloseRecovery';

describe('managed close idempotency recovery', () => {
  beforeEach(async () => AsyncStorage.clear());

  it('reuses the exact assignment key across retries and removes only the completed key', async () => {
    const first = await getOrCreateManagedCloseKey('0xOWNER', 'assignment-1');
    const retry = await getOrCreateManagedCloseKey('0xowner', 'assignment-1');
    const other = await getOrCreateManagedCloseKey('0xowner', 'assignment-2');
    expect(retry).toBe(first);
    expect(other).not.toBe(first);
    await clearManagedCloseKey('0xowner', 'assignment-1', `${first}-wrong`);
    expect(await getOrCreateManagedCloseKey('0xowner', 'assignment-1')).toBe(first);
    await clearManagedCloseKey('0xowner', 'assignment-1', first);
    expect(await getOrCreateManagedCloseKey('0xowner', 'assignment-1')).not.toBe(first);
  });
});
