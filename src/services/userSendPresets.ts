import {formatMonadUnits} from './monadFormatting';
import type {MonadAsset, MonadWalletSnapshot} from '../types/monad';

export type UserSendPreset = {percent: 25 | 50 | 75; amount: string; amountUnits: string};
const PRESET_PERCENTAGES = [25, 50, 75] as const;

/** Percent choices are offered only from a fresh, matching Monad wallet snapshot. */
export function userSendAmountPresets(wallet: MonadWalletSnapshot | null, ownerAddress: string | null, asset: MonadAsset): UserSendPreset[] {
  if (!wallet || !ownerAddress || wallet.stale || wallet.chainId !== 10143
    || wallet.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) return [];
  const balance = wallet.balances.find(row => row.asset === asset);
  if (!balance || !Number.isSafeInteger(balance.decimals) || balance.decimals < 0 || balance.decimals > 36
    || !/^(?:0|[1-9][0-9]*)$/.test(balance.amountUnits)) return [];
  const units = BigInt(balance.amountUnits);
  const used = new Set<string>();
  return PRESET_PERCENTAGES.flatMap(percent => {
    const amountUnits = (units * BigInt(percent) / 100n).toString();
    if (BigInt(amountUnits) === 0n || used.has(amountUnits)) return [];
    used.add(amountUnits);
    return [{percent, amountUnits, amount: formatMonadUnits(amountUnits, balance.decimals)}];
  });
}
