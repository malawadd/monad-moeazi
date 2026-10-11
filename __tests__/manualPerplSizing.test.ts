import type {MarketBook, MarketDirectoryRow} from '../src/types/marketDirectory';
import {adjustLimitPriceByTick, getManualPerplEntrySizing, sliderProgress, sliderValueFromOffset} from '../src/services/manualPerplSizing';

const NOW = 1_800_000_000_000;
const market: MarketDirectoryRow = {
  kind: 'perpl', venueId: 'perpl-direct-testnet-v1', marketId: '1', displayName: 'Perpl Testnet',
  symbol: 'BTC-PERP', name: 'BTC', status: 'open', marketOpen: true, available: true, testOnly: true,
  capabilities: {marketData: true, manualLongShort: true}, priceDecimals: 2, sizeDecimals: 2,
  maxLeverage: 10, manualMaxLeverage: 3, initialMarginBps: 2_000, maintenanceMarginBps: 500,
  makerFeeMicros: 100, takerFeeMicros: 500, maxMarketSlippageBps: 100, manualMaxSlippageBps: 100,
  manualMaxOrderUnits: '10000000', minPostingUnits: '1000000',
  quote: {bid: '9990', ask: '10000', mark: '10000', observedAt: NOW},
};
const book: MarketBook = {
  observedAt: NOW,
  bids: [{price: '9990', size: '1000'}],
  asks: [{price: '10000', size: '1000'}, {price: '10100', size: '2000'}, {price: '10101', size: '100000'}],
};
const baseInput = {
  market, book, snapshotObservedAt: NOW, accountFresh: true,
  balanceUnits: '1000000000', lockedUnits: '20000000',
  side: 'long' as const, orderType: 'market' as const, notionalAUsd: 5, leverage: 3,
  capabilityEnabled: true, now: NOW,
};

test('AUSD slider stops at the lower and upper targets and snaps to a step', () => {
  expect(sliderValueFromOffset(-4, 100, 1, 10, 1)).toBe(1);
  expect(sliderValueFromOffset(50, 100, 1, 10, 1)).toBe(6);
  expect(sliderValueFromOffset(120, 100, 1, 10, 1)).toBe(10);
  expect(sliderProgress(5, 1, 9)).toBe(0.5);
});

test('limit price tick controls preserve market precision', () => {
  expect(adjustLimitPriceByTick('100.00', 2, -1)).toBe('99.99');
  expect(adjustLimitPriceByTick('99.99', 2, 1)).toBe('100');
});

test('market entry sizes down to market precision and shows collateral and liquidation estimates', () => {
  const sizing = getManualPerplEntrySizing(baseInput);
  expect(sizing.canReview).toBe(true);
  expect(sizing.maxNotionalAUsd).toBe(10);
  expect(sizing.manualCapAUsd).toBe(10);
  expect(sizing.exchangeMaxLeverage).toBe(10);
  expect(sizing.maxLeverage).toBe(3);
  expect(sizing.sizeUnits).toBe('5');
  expect(sizing.freeCollateralAUsd).toBe(980);
  expect(sizing.lockedCollateralAUsd).toBe(20);
  expect(sizing.entryFeeAUsd).toBeCloseTo(0.0025);
  expect(sizing.openingFeeReserveAUsd).toBeCloseTo(0.0025);
  expect(sizing.liquidationPrice).toBeCloseTo(71.72);
  expect(sizing.liquidationDistancePct).toBeCloseTo(28.28);
  expect(sizing.onePercentUpPnlAUsd).toBeCloseTo(0.05);
  expect(sizing.onePercentDownPnlAUsd).toBeCloseTo(-0.05);
});

test('market entry requires fresh executable depth and the slider maximum becomes zero without it', () => {
  const noDepth = {...book, asks: []};
  const sizing = getManualPerplEntrySizing({...baseInput, book: noDepth});
  expect(sizing.canReview).toBe(false);
  expect(sizing.maxNotionalAUsd).toBe(0);
  expect(sizing.reason).toMatch(/no executable depth/i);
  const staleBook = getManualPerplEntrySizing({...baseInput, book: {...book, observedAt: NOW - 61_000}});
  expect(staleBook.canReview).toBe(false);
  expect(staleBook.reason).toMatch(/order book is stale/i);
});

test('collateral sizing follows the selected leverage and reserves the opening taker fee', () => {
  const collateralLimited = {...baseInput, balanceUnits: '3000000', lockedUnits: '0'};
  const oneTimes = getManualPerplEntrySizing({...collateralLimited, leverage: 1, notionalAUsd: 2});
  const threeTimes = getManualPerplEntrySizing({...collateralLimited, leverage: 3, notionalAUsd: 2});
  expect(oneTimes.maxNotionalAUsd).toBeCloseTo(2.9985);
  expect(threeTimes.maxNotionalAUsd).toBeCloseTo(8.9865);
  expect(oneTimes.canReview).toBe(true);
  expect(threeTimes.openingFeeReserveAUsd).toBeCloseTo(0.001);
});

test('limit entry remains previewable without a book but still requires a fresh ticker', () => {
  const limit = getManualPerplEntrySizing({...baseInput, orderType: 'limit', book: null, limitPrice: '99.99'});
  expect(limit.canReview).toBe(true);
  expect(limit.bookFresh).toBe(false);
  expect(limit.entryPrice).toBeCloseTo(99.99);
  expect(limit.sizeUnits).toBe('5');

  const stale = {...market, quote: {...market.quote, observedAt: NOW - 61_000}};
  const staleLimit = getManualPerplEntrySizing({...baseInput, market: stale, orderType: 'limit', book: null});
  expect(staleLimit.canReview).toBe(false);
  expect(staleLimit.reason).toMatch(/ticker is stale/i);
});

test('entry state blocks zero, below-minimum, over-cap, unavailable capability, and existing position', () => {
  expect(getManualPerplEntrySizing({...baseInput, notionalAUsd: 0}).reason).toMatch(/greater than zero/i);
  expect(getManualPerplEntrySizing({...baseInput, notionalAUsd: 0.5}).reason).toMatch(/at least 1/i);
  expect(getManualPerplEntrySizing({...baseInput, notionalAUsd: 11}).canReview).toBe(false);
  expect(getManualPerplEntrySizing({...baseInput, notionalAUsd: 5, balanceUnits: '1000000', lockedUnits: '0'}).reason).toMatch(/free ausd/i);
  expect(getManualPerplEntrySizing({...baseInput, capabilityEnabled: false}).reason).toMatch(/disabled/i);
  expect(getManualPerplEntrySizing({...baseInput, positionOpen: true}).reason).toMatch(/position is already open/i);
});
