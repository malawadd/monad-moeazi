import AsyncStorage from '@react-native-async-storage/async-storage';
import {idempotencyKeyForReview} from './managedAutopilot';

const STORE_KEY = 'moeazi.monad.mobile.managedScopedGrantReview.v1';
type StoredKey = {contextId: string; ownerAddress: string; idempotencyKey: string};

async function read(): Promise<StoredKey | null> {
  const raw = await AsyncStorage.getItem(STORE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredKey;
    return value && typeof value.contextId === 'string' && typeof value.ownerAddress === 'string'
      && typeof value.idempotencyKey === 'string' ? value : null;
  } catch { return null; }
}

export async function getOrCreateScopedGrantKey(contextId: string, ownerAddress: string) {
  const current = await read();
  if (current?.contextId === contextId && current.ownerAddress.toLowerCase() === ownerAddress.toLowerCase()) {
    return current.idempotencyKey;
  }
  const idempotencyKey = idempotencyKeyForReview();
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify({contextId, ownerAddress: ownerAddress.toLowerCase(), idempotencyKey}));
  return idempotencyKey;
}

export async function getCurrentScopedGrantKey(ownerAddress?: string) {
  const current = await read();
  if (ownerAddress && current?.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) return null;
  return current?.idempotencyKey ?? null;
}

export async function clearScopedGrantKey(contextId?: string, ownerAddress?: string) {
  const current = await read();
  if (!current || (contextId && current.contextId !== contextId)
      || (ownerAddress && current.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase())) return false;
  await AsyncStorage.removeItem(STORE_KEY);
  return true;
}
