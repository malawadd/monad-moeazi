import type {MonadWalletSnapshot} from '../types/monad';
import type {PerplRun, PerplVenue} from '../types/perpl';
import {monadTimestampMillis} from './monadFormatting';

export type ReadBalance = {units: bigint; decimals: number; freshness: 'fresh' | 'stale'} | null;

export function isUserHomeOffline(isConnected: boolean | null | undefined): boolean {
  return isConnected === false;
}

export function readUserWalletAsset(snapshot: MonadWalletSnapshot | null, owner: string | null, asset: 'MON' | 'AUSD', now = Date.now()): ReadBalance {
  if (!snapshot || !owner || typeof snapshot.ownerAddress !== 'string' || snapshot.chainId !== 10143
      || snapshot.ownerAddress.toLowerCase() !== owner.toLowerCase() || !Array.isArray(snapshot.balances)) return null;
  const decimals = asset === 'AUSD' ? 6 : 18;
  const matches = snapshot.balances.filter(item => item.asset === asset);
  if (matches.length !== 1) return null;
  const row = matches[0];
  if (!row || row.decimals !== decimals || !/^\d+$/.test(row.amountUnits)) return null;
  const observed = monadTimestampMillis(snapshot.observedAt);
  const stale = snapshot.stale || !Number.isFinite(observed) || now - observed > 60_000 || observed > now + 60_000;
  return {units: BigInt(row.amountUnits), decimals, freshness: stale ? 'stale' : 'fresh'};
}

export function ownerScopedPerplRun(run: PerplRun | null, owner: string | null): PerplRun | null {
  if (!run || !owner || typeof run.ownerAddress !== 'string' || run.chainId !== 10143
      || run.ownerAddress.toLowerCase() !== owner.toLowerCase()) return null;
  return run;
}

export function verifiedPerplAvailableUnits(run: PerplRun | null, owner: string | null, now = Date.now()): bigint | null {
  const values = verifiedPerplBalances(run, owner, now);
  return values?.available ?? null;
}

export function verifiedPerplBalanceUnits(run: PerplRun | null, owner: string | null, now = Date.now()): bigint | null {
  const values = verifiedPerplBalances(run, owner, now);
  return values?.total ?? null;
}

function verifiedPerplBalances(run: PerplRun | null, owner: string | null, now: number) {
  const scoped = ownerScopedPerplRun(run, owner);
  const snapshot = scoped?.positionSnapshot;
  if (!snapshot || snapshot.status !== 'finalized' || snapshot.verified !== true
      || !/^[0-9]+$/.test(snapshot.balanceUnits ?? '') || !/^[0-9]+$/.test(snapshot.lockedUnits ?? '')) return null;
  if (typeof snapshot.observedAt !== 'string' && typeof snapshot.observedAt !== 'number') return null;
  const observed = monadTimestampMillis(snapshot.observedAt);
  if (!Number.isFinite(observed) || now - observed > 60_000 || observed > now + 60_000) return null;
  const total = BigInt(snapshot.balanceUnits!);
  const locked = BigInt(snapshot.lockedUnits!);
  const available = total - locked;
  return available < 0n ? null : {total, available};
}

export function requiredPerplFundingUnits(venue: PerplVenue | null): bigint | null {
  if (!venue || venue.chainId !== 10143 || venue.collateral?.symbol !== 'AUSD' || venue.collateral.decimals !== 6) return null;
  if (venue.venueId === 'perpl-direct-testnet-v1') return 100_000_000n;
  const value = venue.limits?.minFundingUnits ?? venue.limits?.minAccountOpenUnits ?? venue.collateral.minAccountOpenUnits;
  if (!value || !/^\d+$/.test(value)) return null;
  return BigInt(value);
}

export type UserHomeAction = {target: 'refresh' | 'funding' | 'settings' | 'setup' | 'status' | 'strategies'; label: string; title: string; detail: string};
export function nextUserHomeAction(input: {
  owner: string | null; walletReady: boolean; walletStale: boolean; mon: ReadBalance; ausd: ReadBalance;
  currentReady: boolean; currentRun: PerplRun | null; currentRunInvalid: boolean; venueReady: boolean; venue: PerplVenue | null;
  venueError: boolean; initialFundingComplete: boolean | null;
}): UserHomeAction {
  if (input.currentRun && !input.currentRunInvalid) return {target: 'status', label: 'View Perpl status', title: 'Your Perpl run is in progress', detail: 'Check your run and recent activity.'};
  if (input.currentRunInvalid) return {target: 'refresh', label: 'Refresh status', title: 'Your strategy status needs a check', detail: 'Refresh to check the latest status.'};
  if (input.venueError) return {target: 'refresh', label: 'Refresh status', title: 'Perpl setup is unavailable', detail: 'Refresh to check the latest strategy availability.'};
  if (input.venueReady && !input.venue?.enabled) {
    return {target: 'strategies', label: 'View strategies', title: 'Perpl setup is not available yet', detail: input.venue?.reasonMessage || input.venue?.reason || 'Check which strategies are available.'};
  }
  if (!input.owner || !input.walletReady || !input.currentReady || input.walletStale) {
    return {target: 'refresh', label: 'Refresh balances and status', title: 'Balances need a refresh', detail: 'Refresh to check your latest balance before starting.'};
  }
  if (!input.venueReady) return {target: 'refresh', label: 'Refresh status', title: 'Checking Perpl setup', detail: 'Refresh to check which setup options are available.'};
  if (input.initialFundingComplete === null) return {target: 'refresh', label: 'Refresh status', title: 'Checking your first-time setup', detail: 'Your saved setup status is loading.'};
  const minimum = requiredPerplFundingUnits(input.venue);
  if (!input.initialFundingComplete) {
    if (!input.mon) return {target: 'funding', label: 'Review test token funding', title: 'MON balance is unavailable', detail: 'Refresh the balance, or open Funding to check your wallet.'};
    if (input.mon.freshness === 'stale') return {target: 'refresh', label: 'Refresh balances', title: 'Balances need a refresh', detail: 'Refresh to check your balance before starting.'};
    if (input.mon.units === 0n) return {target: 'funding', label: 'Get test MON', title: 'Add MON for network fees', detail: 'MON covers network fees. Get test MON, then return here.'};
    if (!input.ausd) return {target: 'funding', label: 'Review AUSD funding', title: 'AUSD balance is unavailable', detail: 'Refresh the balance, or open Funding to check your wallet.'};
    if (input.ausd.freshness === 'stale') return {target: 'refresh', label: 'Refresh balances', title: 'Balances need a refresh', detail: 'Refresh to check your balance before starting.'};
    if (!minimum) return {target: 'strategies', label: 'View strategies', title: 'Perpl setup is not ready to review', detail: 'The service has not returned a required funding amount.'};
    if (input.ausd.units < minimum) return {target: 'funding', label: 'Request test AUSD', title: 'Get test AUSD for practice trading', detail: 'Review the request in your Mera wallet. The faucet decides how much it sends.'};
  } else if (!input.mon || input.mon.units === 0n || !input.ausd || !minimum || input.ausd.units < minimum) {
    return {target: 'settings', label: 'Open wallet tools', title: 'More test tokens may be needed', detail: 'Manage test tokens in Settings.'};
  }
  if (!input.venue?.enabled) return {target: 'strategies', label: 'View strategies', title: 'Perpl setup is not available yet', detail: input.venue?.reasonMessage || input.venue?.reason || 'Check which strategies are available.'};
  return {target: 'setup', label: 'Set up Perpl', title: 'Review Perpl setup', detail: 'Check the funding, duration, markets and permissions before signing.'};
}

export function formatHomeAmount(units: bigint, decimals: number, digits: number): string {
  if (!Number.isInteger(decimals) || !Number.isInteger(digits) || decimals < digits || decimals > 30 || digits < 0 || digits > 6 || units < 0n) {
    throw new Error('Unsupported display precision or amount.');
  }
  const factor = 10n ** BigInt(decimals - digits);
  const rounded = (units + factor / 2n) / factor;
  if (units > 0n && rounded === 0n) return `<0.${'0'.repeat(Math.max(0, digits - 1))}1`;
  const scale = 10n ** BigInt(digits);
  let display = rounded;
  let suffix = '';
  let approximate = units % factor !== 0n;
  const amount = rounded / scale;
  if (amount >= 10_000n) {
    let divisor = 1_000n;
    suffix = 'K';
    if (amount >= 1_000_000n) { divisor = 1_000_000n; suffix = 'M'; }
    if (amount >= 1_000_000_000n) { divisor = 1_000_000_000n; suffix = 'B'; }
    display = (rounded + divisor / 2n) / divisor;
    approximate = true;
  }
  const whole = (display / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (display % scale).toString().padStart(digits, '0');
  return `${approximate ? '≈ ' : ''}${whole}.${fraction}${suffix}`;
}
