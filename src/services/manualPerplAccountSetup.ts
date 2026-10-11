import {formatMonadUnits} from './monadFormatting';
import type {ManualPerplAccount} from '../types/manualPerpl';

export function manualPerplOpenDisabledReason(input: {
  account: ManualPerplAccount; amountUnits: string | null; minimumUnits: string | null;
  contextLoading: boolean; contextError: string; allowanceMatches: boolean;
}) {
  const {account, amountUnits, minimumUnits, contextLoading, contextError, allowanceMatches} = input;
  if (account.status !== 'not_created') return null;
  if (!account.capabilities.open) return 'Manual Perpl account creation is disabled by the Testnet gate.';
  if (contextLoading) return 'Loading the live Perpl account minimum…';
  if (contextError) return contextError;
  if (!minimumUnits) return 'The live Perpl account minimum is unavailable. Refresh before continuing.';
  if (!amountUnits) return 'Enter a positive AUSD amount to review account creation.';
  if (BigInt(amountUnits) < BigInt(minimumUnits)) {
    return `Enter at least ${formatMonadUnits(minimumUnits, account.collateral.decimals)} AUSD.`;
  }
  if (BigInt(amountUnits) > BigInt(account.collateral.walletBalanceUnits)) return 'The selected amount exceeds AUSD in your Mera wallet.';
  if (!allowanceMatches && !account.capabilities.approve) return 'The AUSD allowance does not match, and exact approval is disabled by the Testnet gate.';
  if (!allowanceMatches && BigInt(account.collateral.allowanceUnits) < BigInt(amountUnits)) {
    return 'Review an exact AUSD approval first, then refresh this account.';
  }
  if (!allowanceMatches) return 'The current allowance is larger than this amount. Match the amount to the allowance or review a fresh exact approval.';
  return null;
}
