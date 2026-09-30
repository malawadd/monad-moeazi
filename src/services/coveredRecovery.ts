import AsyncStorage from '@react-native-async-storage/async-storage';
const key = (owner: string) => `moeazi.monad.mobile.covered.pending.v1.${owner.toLowerCase()}`;
export async function saveCoveredRecovery(owner: string, operationId: string, kind: 'activation' | 'withdrawal') {
  await AsyncStorage.setItem(key(owner), JSON.stringify({operationId, kind}));
}
export async function loadCoveredRecovery(owner: string) {
  const raw = await AsyncStorage.getItem(key(owner));
  if (!raw) return null;
  try {const parsed = JSON.parse(raw); return /^[a-zA-Z0-9_-]{16,100}$/.test(parsed.operationId) && ['activation', 'withdrawal'].includes(parsed.kind) ? parsed as {operationId: string; kind: 'activation' | 'withdrawal'} : null;} catch {return null;}
}
export async function clearCoveredRecovery(owner: string) {await AsyncStorage.removeItem(key(owner));}
