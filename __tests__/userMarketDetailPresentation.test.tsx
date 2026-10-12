import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import {UserMarketDetailView} from '../src/screens/UserMarketDetailView';
import {userThemeTokens} from '../src/theme/userThemes';
import type {MarketDirectoryRow} from '../src/types/marketDirectory';

const spot: MarketDirectoryRow = {kind: 'spot', venueId: 'uniswap_v4_testnet', marketId: 'WMON_USDC', displayName: 'Uniswap v4 Testnet',
  symbol: 'WMON/USDC', name: 'Wrapped MON / USDC', status: 'open', available: true, testOnly: true, verified: false,
  verificationSource: 'operator-reviewed', poolId: `0x${'a'.repeat(64)}`,
  poolKey: {currency0: `0x${'1'.repeat(40)}`, currency1: `0x${'2'.repeat(40)}`, fee: 3000, tickSpacing: 60, hooks: `0x${'0'.repeat(40)}`},
  baseAsset: {id: 'WMON', symbol: 'WMON', address: `0x${'3'.repeat(40)}`, decimals: 18},
  quoteAsset: {id: 'USDC', symbol: 'USDC', address: `0x${'4'.repeat(40)}`, decimals: 6}, capabilities: {marketData: true, walletSwap: true, buy: true, sell: true}};
const perpl: MarketDirectoryRow = {kind: 'perpl', venueId: 'perpl-direct-testnet-v1', marketId: '32', displayName: 'Perpl Testnet',
  symbol: 'ETH-PERP', name: 'Ether perpetual', status: 'open', available: true, testOnly: true, chainId: 10143,
  priceDecimals: 2, sizeDecimals: 4, maxLeverage: 10, capabilities: {marketData: true, manualLongShort: true}};
const baseProps: React.ComponentProps<typeof UserMarketDetailView> = {theme: userThemeTokens('original'), venueId: spot.venueId, marketId: spot.marketId,
  market: spot, loading: false, refreshing: false, onRefresh: jest.fn(), onBack: jest.fn(), quote: null, price: '1.25', unit: 'USDC per WMON',
  quoteState: 'Quote unavailable', chartCandles: [], range: '1D', onRangeChange: jest.fn(), overlays: [], summaries: [], chartTrades: [],
  activity: [], livePnl: [], chartSettings: {display: 'candles', defaultRange: '1D', showMarkPrice: true, showVolume: true, showOrderBook: true,
    showTradeMarkers: true, showManualPositions: true, showAutonomousPositions: true, showPnl: true, showRiskLevels: true}, book: null,
  bookStale: false, bookLive: false, publicTrades: [], manualAccount: null, manualReady: false, marketCanTrade: false,
  manualPosition: undefined, autonomousPosition: null, onOpenManualAccount: jest.fn(), onOpenSummary: jest.fn(), onOpenActivity: jest.fn(),
  onOpenSpotTrade: jest.fn(), onOpenPerplTrade: jest.fn()};

function content(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(node => typeof node.props.children === 'string').map(node => node.props.children).join(' ');
}
function button(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.find(node => node.props.accessibilityLabel === label);
}

it('puts the reviewed Spot action above optional pool diagnostics and preserves the exact review payload', async () => {
  const onOpenSpotTrade = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserMarketDetailView {...baseProps} onOpenSpotTrade={onOpenSpotTrade} />); });
  expect(content(renderer)).not.toContain(spot.poolId);
  await act(async () => button(renderer, 'Buy WMON').props.onPress());
  expect(onOpenSpotTrade).toHaveBeenCalledWith('buy', {marketId: 'WMON_USDC', venue: 'uniswap_v4_testnet', accountScope: 'wallet',
    baseAsset: spot.baseAsset, quoteAsset: spot.quoteAsset, poolId: spot.poolId, poolKey: spot.poolKey, verified: false,
    verificationSource: 'operator-reviewed'});
  await act(async () => button(renderer, 'Market details: Show').props.onPress());
  expect(content(renderer)).toContain(spot.poolId);
  await act(async () => renderer.unmount());
});

it('shows Perpl actions before optional public trades and preserves route precision/action params', async () => {
  const onOpenPerplTrade = jest.fn();
  const account = {capabilities: {closePosition: true, reducePosition: true, marketOrders: true}} as any;
  const position = {side: 'short', marketId: 32, sizeUnits: '12500', entryPrice: '6712345', markPrice: '6800000', leverage: 2} as any;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserMarketDetailView {...baseProps} venueId={perpl.venueId} marketId={perpl.marketId}
    market={perpl} unit="AUSD per ETH-PERP" manualAccount={account} manualReady marketCanTrade onOpenPerplTrade={onOpenPerplTrade}
    manualPosition={position} publicTrades={[{id: 'trade-1', price: 6810000, size: 10000, side: 'buy', occurredAt: 1_800_000_000_000}]} />); });
  const body = content(renderer);
  expect(body.indexOf('Long · market or limit')).toBeLessThan(body.indexOf('Live public trades'));
  expect(body).not.toContain('manual stream disconnected');
  await act(async () => button(renderer, 'Long · market or limit').props.onPress());
  expect(onOpenPerplTrade).toHaveBeenLastCalledWith({marketId: '32', symbol: 'ETH-PERP', priceDecimals: 2, sizeDecimals: 4, maxLeverage: 10});
  await act(async () => button(renderer, 'Short · market or limit').props.onPress());
  expect(onOpenPerplTrade).toHaveBeenLastCalledWith({marketId: '32', symbol: 'ETH-PERP', priceDecimals: 2, sizeDecimals: 4, maxLeverage: 10, side: 'short'});
  await act(async () => button(renderer, 'Close manual position').props.onPress());
  expect(onOpenPerplTrade).toHaveBeenLastCalledWith({marketId: '32', symbol: 'ETH-PERP', side: 'short', sizeDecimals: 4, priceDecimals: 2, action: 'close_position'});
  await act(async () => renderer.unmount());
});

it('opens the selected trade summary by ID and returns to the market without losing its references', async () => {
  const onBack = jest.fn();
  const summary = {summaryId: 'summary-a', venueId: spot.venueId, marketId: spot.marketId, symbol: spot.symbol,
    direction: 'buy', sizeUnits: '2000000000000000000', weightedEntryPrice: '1250000', weightedExitPrice: '1300000',
    entryAt: 1_800_000_000_000, exitAt: 1_800_000_001_000, status: 'closed', source: 'manual', orderIds: ['order-a'],
    transactionHashes: ['0x1234'], activityIds: ['activity-a'], feesKnown: true, priceDecimals: 6, sizeDecimals: 18} as any;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserMarketDetailView {...baseProps} selectedSummaryId="summary-a"
    onBack={onBack} summaries={[summary]} />); });
  expect(content(renderer)).toContain('Selected trade summary');
  expect(content(renderer)).toContain('2');
  expect(content(renderer)).toContain('1.25');
  await act(async () => button(renderer, 'Order and transaction references: Show').props.onPress());
  expect(renderer.root.findAll(node => node.props.selectable === true)
    .some(node => JSON.stringify(node.props.children).includes('0x1234'))).toBe(true);
  await act(async () => button(renderer, 'Back to market').props.onPress());
  expect(onBack).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

it.each([
  {
    name: 'USDC 6 decimals quoted against an 18-decimal base',
    market: spot,
    summary: {summaryId: 'summary-usdc', venueId: spot.venueId, marketId: spot.marketId, symbol: spot.symbol,
      direction: 'buy', sizeUnits: '2000000000000000000', weightedEntryPrice: '1250000', weightedExitPrice: '1300000',
      realizedPricePnlUnits: '250000', feesUnits: '10000', netRealizedPnlUnits: '240000', status: 'closed', source: 'manual',
      orderIds: [], transactionHashes: [], activityIds: [], feesKnown: true, priceDecimals: 6, sizeDecimals: 18} as any,
    expected: ['1.25', '1.3', '0.25 USDC', '0.01 USDC', '0.24 USDC'],
  },
  {
    name: 'WMON 18 decimals quoted against an 18-decimal base despite stale six-decimal summary metadata',
    market: {...spot, symbol: 'WMON/WMON', quoteAsset: {...spot.quoteAsset!, id: 'WMON', symbol: 'WMON',
      address: `0x${'5'.repeat(40)}`, decimals: 18}},
    summary: {summaryId: 'summary-wmon', venueId: spot.venueId, marketId: spot.marketId, symbol: 'WMON/WMON',
      direction: 'buy', sizeUnits: '2000000000000000000', weightedEntryPrice: '1234000000000000000',
      weightedExitPrice: '1456000000000000000', realizedPricePnlUnits: '5000000000000000000',
      feesUnits: '100000000000000000', netRealizedPnlUnits: '4900000000000000000', status: 'closed', source: 'manual',
      orderIds: [], transactionHashes: [], activityIds: [], feesKnown: true, priceDecimals: 6, sizeDecimals: 18} as any,
    expected: ['1.234', '1.456', '5 WMON', '0.1 WMON', '4.9 WMON'],
  },
])('formats $name from exact directory token decimals', async ({market, summary, expected}) => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserMarketDetailView {...baseProps} venueId={market.venueId}
    marketId={market.marketId} market={market} selectedSummaryId={summary.summaryId} summaries={[summary]} />); });
  const body = content(renderer);
  for (const value of expected) expect(body).toContain(value);
  await act(async () => renderer.unmount());
});

it('does not scale Perpl prices or sizes when the venue did not return decimals', async () => {
  const missingPrecision = {...perpl, priceDecimals: undefined, sizeDecimals: undefined};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserMarketDetailView {...baseProps} venueId={perpl.venueId}
    marketId={perpl.marketId} market={missingPrecision} price="Unavailable" chartCandles={[{t: 1, o: 1, h: 2, l: 1, c: 2}]}
    manualPosition={{side: 'long', marketId: 32, sizeUnits: '12500', entryPrice: '6712345'} as any} />); });
  expect(content(renderer)).toContain('Chart values are unavailable because price precision was not returned.');
  expect(content(renderer)).toContain('Unavailable');
  expect(renderer.root.findAll(node => node.props.accessibilityRole === 'image')).toHaveLength(0);
  await act(async () => renderer.unmount());
});

it('does not insert a transient background-refresh row above market trade controls', async () => {
  const account = {capabilities: {closePosition: true, reducePosition: true, marketOrders: true}} as any;
  const position = {side: 'long', marketId: 32, sizeUnits: '12500', entryPrice: '6712345'} as any;
  const renderMarket = async (refreshingStale: boolean) => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => { renderer = ReactTestRenderer.create(<UserMarketDetailView {...baseProps} venueId={perpl.venueId}
      marketId={perpl.marketId} market={perpl} refreshingStale={refreshingStale} manualAccount={account} manualPosition={position}
      manualReady marketCanTrade />); });
    return renderer;
  };
  const idle = await renderMarket(false);
  const refreshing = await renderMarket(true);
  expect(content(refreshing)).toBe(content(idle));
  expect(content(refreshing)).not.toContain('Refreshing; last known market data remains visible.');
  expect(button(idle, 'Add AUSD margin')).toBeTruthy();
  expect(button(refreshing, 'Add AUSD margin')).toBeTruthy();
  await act(async () => { idle.unmount(); refreshing.unmount(); });
});
