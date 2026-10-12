import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'moeazi.monad.mobile.user-funding-ready.v1.';
const OWNER = /^0x[a-fA-F0-9]{40}$/;

function keyFor(ownerAddress: string) {
  if (!OWNER.test(ownerAddress)) throw new Error('A valid Mera owner is required for onboarding progress.');
  return `${PREFIX}${ownerAddress.toLowerCase()}`;
}

export async function hasInitialAusdFunding(ownerAddress: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(keyFor(ownerAddress))) === 'true'; }
  catch { return false; }
}

export async function recordInitialAusdFunding(ownerAddress: string): Promise<boolean> {
  try { await AsyncStorage.setItem(keyFor(ownerAddress), 'true'); return true; }
  catch { return false; }
}
