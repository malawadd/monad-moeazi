import {mobileApi} from './apiClient';
import {magicWallet} from './wallet/MagicWalletAdapter';
import {confirmSensitiveAction} from './biometrics';
import {formatUnits} from 'viem';

type VaultRelease = Awaited<ReturnType<typeof mobileApi.managedVaultRelease>>;

/** A failed wallet response may still mean broadcast; caller must inspect chain before retry. */
export async function sendManagedVaultReturn(fresh: VaultRelease, ownerAddress: string,
  onSending: () => Promise<void>) {
  if (fresh.status !== 'ready' || !fresh.transaction
      || fresh.ownerAddress?.toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new Error('The Magic-owned vault changed. Review its finalized balance again.');
  }
  const amount = formatUnits(BigInt(fresh.vaultUsdcUnits ?? '0'), 6);
  if (!await confirmSensitiveAction(`Return ${amount} USDC from your vault to Magic`)) return false;
  await onSending();
  await magicWallet.releaseManagedVault(fresh.transaction);
  return true;
}
