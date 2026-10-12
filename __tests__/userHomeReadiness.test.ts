import {
  formatHomeAmount, nextUserHomeAction, ownerScopedPerplRun, readUserWalletAsset,
  isUserHomeOffline, requiredPerplFundingUnits, verifiedPerplAvailableUnits, verifiedPerplBalanceUnits,
} from '../src/services/userHomeReadiness';
import type {MonadWalletSnapshot} from '../src/types/monad';
import type {PerplRun, PerplVenue} from '../src/types/perpl';

const owner = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const now = Date.parse('2026-09-01T12:00:00.000Z');

function wallet(overrides: Partial<MonadWalletSnapshot> = {}): MonadWalletSnapshot {
  return {ownerAddress: owner, chainId: 10143, observedBlock: 12, observedAt: new Date(now).toISOString(), stale: false,
    balances: [
      {asset: 'AUSD', tokenAddress: null, amountUnits: '12500000', decimals: 6},
      {asset: 'MON', tokenAddress: null, amountUnits: '2000000000000000000', decimals: 18},
    ], ...overrides};
}

function run(overrides: Partial<PerplRun> = {}): PerplRun {
  return {runId: 'run-1', venueId: 'perpl-direct-testnet-v1', status: 'active', ownerAddress: owner,
    vaultAddress: '0x3333333333333333333333333333333333333333', chainId: 10143,
    collateral: {symbol: 'AUSD', address: '0x4444444444444444444444444444444444444444', decimals: 6},
    positionSnapshot: {status: 'finalized', stateSource: 'venue', verified: true,
      observedAt: new Date(now).toISOString(), balanceUnits: '100000000', lockedUnits: '70000000'}, ...overrides};
}

test('wallet reads require one exact owner, chain, asset row, decimals and well-formed units', () => {
  expect(readUserWalletAsset(wallet(), owner, 'AUSD', now)).toEqual({units: 12_500_000n, decimals: 6, freshness: 'fresh'});
  expect(readUserWalletAsset(wallet({stale: true}), owner, 'MON', now)?.freshness).toBe('stale');
  expect(readUserWalletAsset(wallet({observedAt: new Date(now - 60_001).toISOString()}), owner, 'AUSD', now)?.freshness).toBe('stale');
  expect(readUserWalletAsset(wallet({ownerAddress: other}), owner, 'AUSD', now)).toBeNull();
  expect(readUserWalletAsset(wallet({chainId: 1 as 10143}), owner, 'AUSD', now)).toBeNull();
  expect(readUserWalletAsset(wallet({balances: []}), owner, 'AUSD', now)).toBeNull();
  expect(readUserWalletAsset(wallet({balances: [
    {asset: 'AUSD', tokenAddress: null, amountUnits: '1', decimals: 6},
    {asset: 'AUSD', tokenAddress: null, amountUnits: '2', decimals: 6},
  ]}), owner, 'AUSD', now)).toBeNull();
  expect(readUserWalletAsset(wallet({balances: [{asset: 'MON', tokenAddress: null, amountUnits: '0', decimals: 6}]}), owner, 'MON', now)).toBeNull();
  expect(readUserWalletAsset(wallet({balances: [{asset: 'MON', tokenAddress: null, amountUnits: '-1', decimals: 18}]}), owner, 'MON', now)).toBeNull();
});

test('Perpl balances appear only from a fresh verified finalized position snapshot', () => {
  const current = run();
  expect(ownerScopedPerplRun(current, owner)).toBe(current);
  expect(ownerScopedPerplRun(current, other)).toBeNull();
  expect(verifiedPerplBalanceUnits(current, owner, now)).toBe(100_000_000n);
  expect(verifiedPerplAvailableUnits(current, owner, now)).toBe(30_000_000n);
  expect(verifiedPerplBalanceUnits(run({positionSnapshot: {...current.positionSnapshot!, verified: false}}), owner, now)).toBeNull();
  expect(verifiedPerplBalanceUnits(run({positionSnapshot: {...current.positionSnapshot!, status: 'unavailable'}}), owner, now)).toBeNull();
  expect(verifiedPerplBalanceUnits(run({positionSnapshot: {...current.positionSnapshot!, observedAt: new Date(now - 60_001).toISOString()}}), owner, now)).toBeNull();
  expect(verifiedPerplBalanceUnits(run({positionSnapshot: {...current.positionSnapshot!, lockedUnits: '100000001'}}), owner, now)).toBeNull();
});

test('Perpl funding threshold is taken from the live venue contract', () => {
  const direct: PerplVenue = {venueId: 'perpl-direct-testnet-v1', displayName: 'Direct', chainId: 10143,
    executionModel: 'direct', enabled: true, collateral: {symbol: 'AUSD', address: '0x1', decimals: 6}};
  expect(requiredPerplFundingUnits(direct)).toBe(100_000_000n);
  expect(requiredPerplFundingUnits({...direct, venueId: 'perpl-testnet-v1', limits: {minFundingUnits: '25000000'}})).toBe(25_000_000n);
  expect(requiredPerplFundingUnits({...direct, chainId: 1})).toBeNull();
  expect(requiredPerplFundingUnits({...direct, collateral: {symbol: 'USDC', address: '0x1', decimals: 6}})).toBeNull();
});

test('next step preserves the first-use sequence and does not equate missing data with zero', () => {
  const base = {owner, walletReady: true, walletStale: false, mon: {units: 1n, decimals: 18, freshness: 'fresh' as const},
    ausd: {units: 0n, decimals: 6, freshness: 'fresh' as const}, currentReady: true, currentRun: null,
    currentRunInvalid: false, venueReady: true, venue: {venueId: 'perpl-direct-testnet-v1', displayName: 'Direct', chainId: 10143,
      executionModel: 'direct', enabled: true, collateral: {symbol: 'AUSD', address: '0x1', decimals: 6}} as PerplVenue,
    venueError: false, initialFundingComplete: false};
  expect(nextUserHomeAction({...base, mon: {...base.mon, units: 0n}}).label).toBe('Get test MON');
  expect(nextUserHomeAction({...base, mon: null}).title).toBe('MON balance is unavailable');
  expect(nextUserHomeAction({...base, ausd: {...base.ausd, units: 99_999_999n}}).label).toBe('Request test AUSD');
  expect(nextUserHomeAction({...base, currentRunInvalid: true}).target).toBe('refresh');
  expect(nextUserHomeAction({...base, currentRun: run()}).target).toBe('status');
  expect(nextUserHomeAction({...base, currentRun: run()})).toMatchObject({
    title: 'Your autonomous run is in progress', label: 'View autonomous run',
  });
  expect(nextUserHomeAction({...base, initialFundingComplete: true, ausd: {...base.ausd, units: 100_000_000n}}).target).toBe('setup');
});

test('large visible values are compact while exact values stay available elsewhere', () => {
  expect(formatHomeAmount(19_979_859_323n, 6, 2)).toBe('≈ 19.98K');
  expect(formatHomeAmount(12_500_000n, 6, 2)).toBe('12.50');
  expect(formatHomeAmount(10n, 6, 2)).toBe('<0.01');
  expect(() => formatHomeAmount(1n, 2, 3)).toThrow('Unsupported display precision');
});

test('only an explicit offline signal immediately invalidates Home freshness', () => {
  expect(isUserHomeOffline(false)).toBe(true);
  expect(isUserHomeOffline(true)).toBe(false);
  expect(isUserHomeOffline(null)).toBe(false);
  expect(isUserHomeOffline(undefined)).toBe(false);
});
