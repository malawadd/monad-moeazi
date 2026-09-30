import AsyncStorage from '@react-native-async-storage/async-storage';

type CloseKeys = Record<string, string>;
const storageKey = (owner: string) => `moeazi.monad.mobile.managed-close.v1.${owner.toLowerCase()}`;
const validKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value);

function readKeys(raw: string | null): CloseKeys {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([assignmentId, key]) =>
      /^[A-Za-z0-9_-]{8,256}$/.test(assignmentId) && validKey(key)));
  } catch { return {}; }
}

/** Reuse the same idempotency key after timeout, pending, or app restart. */
export async function getOrCreateManagedCloseKey(owner: string, assignmentId: string) {
  const key = storageKey(owner);
  const keys = readKeys(await AsyncStorage.getItem(key));
  if (keys[assignmentId]) return keys[assignmentId];
  const idempotencyKey = `close-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  keys[assignmentId] = idempotencyKey;
  await AsyncStorage.setItem(key, JSON.stringify(keys));
  return idempotencyKey;
}

export async function clearManagedCloseKey(owner: string, assignmentId: string, expectedKey: string) {
  const key = storageKey(owner);
  const keys = readKeys(await AsyncStorage.getItem(key));
  if (keys[assignmentId] !== expectedKey) return;
  delete keys[assignmentId];
  if (Object.keys(keys).length) await AsyncStorage.setItem(key, JSON.stringify(keys));
  else await AsyncStorage.removeItem(key);
}
