import AsyncStorage from '@react-native-async-storage/async-storage';
import {mobileApi} from './apiClient';

const address = /^0x[a-f0-9]{40}$/;
const key = (owner: string, vault: string) => {
  const normalizedOwner = owner.toLowerCase();
  const normalizedVault = vault.toLowerCase();
  if (!address.test(normalizedOwner) || !address.test(normalizedVault)) {
    throw new Error('Magic vault return identity is invalid.');
  }
  return `moeazi.monad.mobile.vault-return.v1.${normalizedOwner}.${normalizedVault}`;
};

/** A response can be lost after Magic broadcasts. Only finalized read clears this. */
export async function markVaultReturnAttempted(owner: string, vault: string) {
  await AsyncStorage.setItem(key(owner, vault), String(Date.now()));
}

export async function wasVaultReturnAttempted(owner: string, vault: string) {
  const stored = await AsyncStorage.getItem(key(owner, vault));
  if (!stored) return false;
  const attemptedAt = Number(stored);
  if (Number.isSafeInteger(attemptedAt) && attemptedAt > 0
      && Date.now() - attemptedAt < 10 * 60_000) return true;
  await AsyncStorage.removeItem(key(owner, vault));
  return false;
}

export async function clearVaultReturnAttempted(owner: string, vault: string) {
  await AsyncStorage.removeItem(key(owner, vault));
}

export async function readManagedVaultReturn() {
  const release = await mobileApi.managedVaultRelease();
  if (release.status === 'released' && release.ownerAddress && release.vaultAddress) {
    await clearVaultReturnAttempted(release.ownerAddress, release.vaultAddress);
    return {release, sent: false, funding: await mobileApi.refreshFunding()};
  }
  const sent = release.status === 'ready' && release.ownerAddress && release.vaultAddress
    ? await wasVaultReturnAttempted(release.ownerAddress, release.vaultAddress) : false;
  return {release, sent, funding: null};
}
