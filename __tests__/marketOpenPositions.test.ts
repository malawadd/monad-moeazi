import {formatSignedAUsdPnl, verifiedMarketOpenPositions} from '../src/services/marketOpenPositions';
import {autonomousPositionReadUnavailable, EMPTY_MARKET_POSITION_READS, manualPositionReadUnavailable,
  retainMarketPositionReads} from '../src/services/marketPositionReads';
import type {ManualPerplAccount, ManualPerplPosition} from '../src/types/manualPerpl';
import type {MarketDirectoryRow} from '../src/types/marketDirectory';
import type {PerplRun} from '../src/types/perpl';

const owner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const now = Date.parse('2026-10-12T12:00:00Z');
const market: MarketDirectoryRow = {kind: 'perpl', venueId: 'perpl-direct-testnet-v1', marketId: '16', displayName: 'Perpl',
  symbol: 'BTC-PERP', name: 'Bitcoin perpetual', status: 'open', available: true, chainId: 10143, testOnly: true,
  capabilities: {marketData: true}};
const manualPosition: ManualPerplPosition = {marketId: '16', symbol: 'BTC-PERP', side: 'long', sizeUnits: '100',
  entryPrice: '6700000', markPrice: '6710000', leverage: 2, unrealizedPnlUnits: '1200000', markValid: true,
  verified: true, stateSource: 'finalized_perpl_exchange', finalizedBlockNumber: 702_000};
const account = (overrides: Partial<ManualPerplAccount> = {}) => ({chainId: 10143, ownerAddress: owner,
  exchangeAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', accountMode: 'direct_wallet', accountAddress: owner,
  accountId: 1, status: 'open', collateral: {symbol: 'AUSD', address: '0xcccccccccccccccccccccccccccccccccccccccc', decimals: 6,
    balanceUnits: '0', lockedUnits: '0', walletBalanceUnits: '0', allowanceUnits: '0'}, positions: [manualPosition], orders: [],
  observedAt: now, blockNumber: 702_000, capabilities: {}, legacyRecovery: {accountMode: null, status: 'none', accountAddress: null,
    accountId: null, collateral: {balanceUnits: '0', lockedUnits: '0', tokenBalanceUnits: '0'}, positions: [], orders: [],
    capabilities: {}}, ...overrides}) as unknown as ManualPerplAccount;
const run = (overrides: Partial<PerplRun> = {}) => ({runId: 'run-1', venueId: 'perpl-direct-testnet-v1', status: 'active',
  ownerAddress: owner, vaultAddress: '0xdddddddddddddddddddddddddddddddddddddddd', chainId: 10143,
  collateral: {symbol: 'AUSD', address: '0xcccccccccccccccccccccccccccccccccccccccc', decimals: 6},
  positionSnapshot: {status: 'finalized', stateSource: 'finalized_perpl_exchange', verified: true, blockNumber: 702_000,
    observedAt: now, positions: [{...manualPosition, venueId: 'perpl-direct-testnet-v1'}]}, ...overrides}) as unknown as PerplRun;

test('returns only exact owner/venue/market verified positions from manual and autonomous sources', () => {
  expect(verifiedMarketOpenPositions(market, {ownerAddress: owner, manualAccount: account(), autonomousRun: run()}))
    .toEqual([{source: 'manual', side: 'long', pnlUnits: '1200000'},
      {source: 'autonomous', side: 'long', pnlUnits: '1200000'}]);
  expect(verifiedMarketOpenPositions({...market, venueId: 'perpl-testnet-v1'},
    {ownerAddress: owner, manualAccount: account(), autonomousRun: null})).toEqual([]);
  expect(verifiedMarketOpenPositions(market, {ownerAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    manualAccount: account(), autonomousRun: run()})).toEqual([]);
});

test('keeps the last verified position and P&L while the cached read ages', () => {
  const oldAccount = account({observedAt: now - 120_000});
  expect(verifiedMarketOpenPositions(market, {ownerAddress: owner, manualAccount: oldAccount, autonomousRun: null}))
    .toEqual([{source: 'manual', side: 'long', pnlUnits: '1200000'}]);
});

test('retains owner-scoped positions across unavailable DTOs and clears them only on verified empty reads', () => {
  const first = retainMarketPositionReads(owner, account(), {current: run()}, EMPTY_MARKET_POSITION_READS);
  const unavailableManual = account({status: 'unavailable', accountMode: 'unavailable', unavailable: true, positions: []});
  const unavailableRun = run({positionSnapshot: {status: 'unavailable', stateSource: 'finalized_perpl_exchange',
    verified: false, observedAt: now, reason: 'provider_unavailable'}});
  expect(manualPositionReadUnavailable(unavailableManual, owner)).toBe(true);
  expect(autonomousPositionReadUnavailable({current: unavailableRun}, owner)).toBe(true);
  const retained = retainMarketPositionReads(owner, unavailableManual, {current: unavailableRun}, first);
  expect(retained.manualAccount).toEqual(account());
  expect(retained.autonomousRun).toEqual(run());
  expect(verifiedMarketOpenPositions(market, {ownerAddress: owner, manualAccount: retained.manualAccount,
    autonomousRun: retained.autonomousRun})).toHaveLength(2);

  const noDirectAccount = account({status: 'not_created', accountMode: 'not_created', accountAddress: null,
    accountId: null, positions: []});
  const manualClosed = retainMarketPositionReads(owner, noDirectAccount, undefined, retained);
  const autonomousClosed = retainMarketPositionReads(owner, undefined, {current: null}, manualClosed);
  expect(manualClosed.manualAccount?.positions).toEqual([]);
  expect(autonomousClosed.autonomousRun).toBeNull();
  expect(verifiedMarketOpenPositions(market, {ownerAddress: owner, manualAccount: autonomousClosed.manualAccount,
    autonomousRun: autonomousClosed.autonomousRun})).toEqual([]);
});

test('clears retained snapshots on owner change', () => {
  const first = retainMarketPositionReads(owner, account(), {current: run()}, EMPTY_MARKET_POSITION_READS);
  const changed = retainMarketPositionReads('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', undefined, undefined, first);
  expect(changed.manualAccount).toBeNull();
  expect(changed.autonomousRun).toBeNull();
});

test('ignores unverified and zero-size rows instead of inventing an open position', () => {
  expect(verifiedMarketOpenPositions(market, {ownerAddress: owner,
    manualAccount: account({positions: [{...manualPosition, verified: false}, {...manualPosition, sizeUnits: '0'}]}), autonomousRun: null}))
    .toEqual([]);
  expect(formatSignedAUsdPnl('1200000')).toBe('+1.2 AUSD');
  expect(formatSignedAUsdPnl('-10000')).toBe('−0.01 AUSD');
  expect(formatSignedAUsdPnl('not-units')).toBeNull();
});
