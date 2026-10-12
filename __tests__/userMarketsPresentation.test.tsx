import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {StyleSheet} from 'react-native';
import {UserMarketsView} from '../src/screens/UserMarketsView';
import {userThemeTokens} from '../src/theme/userThemes';
import {marketIdentity, type MarketDirectoryRow} from '../src/types/marketDirectory';
import type {UserMarketOpenPosition} from '../src/services/marketOpenPositions';

const perpl: MarketDirectoryRow = {kind: 'perpl', venueId: 'perpl-direct-testnet-v1', marketId: '16', displayName: 'Perpl Testnet',
  symbol: 'BTC-PERP', name: 'Bitcoin perpetual', status: 'open', available: true, chainId: 10143, priceDecimals: 2, testOnly: true,
  capabilities: {marketData: true, manualLongShort: true}, quote: {mark: '6712345', observedAt: Date.now()}};
const spot: MarketDirectoryRow = {kind: 'spot', venueId: 'uniswap_v4_testnet', marketId: 'WMON_USDC', displayName: 'Uniswap v4 Testnet',
  symbol: 'WMON/USDC', name: 'Wrapped MON / USDC', status: 'open', available: true, testOnly: true,
  capabilities: {marketData: true, walletSwap: true}, baseAsset: {id: 'WMON', symbol: 'WMON', address: '0x1111111111111111111111111111111111111111', decimals: 18},
  quoteAsset: {id: 'USDC', symbol: 'USDC', address: '0x2222222222222222222222222222222222222222', decimals: 6}, quote: {price: '0.997', observedAt: Date.now()}};
const defaults = {theme: userThemeTokens('original'), markets: [perpl, spot], loading: false, refreshing: false,
  search: '', setSearch: jest.fn(), category: 'all' as const, setCategory: jest.fn(), watchlist: [], watchlistOnly: false,
  setWatchlistOnly: jest.fn(), onRefresh: jest.fn(), onOpen: jest.fn(), onWatch: jest.fn()};

function text(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(node => typeof node.props.children === 'string').map(node => node.props.children).join(' ');
}

it('uses a compact single-tap list with stable Perpl and exact Spot quote units', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserMarketsView {...defaults} />); });
  expect(text(renderer)).toContain('AUSD per BTC-PERP');
  expect(text(renderer)).toContain('USDC per WMON');
  expect(text(renderer)).not.toContain('View market and chart');
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Open Bitcoin perpetual market and chart')).toBeTruthy();
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Open Wrapped MON / USDC market and chart')).toBeTruthy();
  const filters = renderer.root.findAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel?.startsWith('Show '));
  expect(new Set(filters.map(node => node.props.accessibilityLabel)).size).toBe(4);
  expect(filters.every(node => (StyleSheet.flatten(node.props.style)?.minHeight ?? 0) >= 48)).toBe(true);
  await act(async () => renderer.root.find(node => node.props.accessibilityLabel === 'Open Bitcoin perpetual market and chart').props.onPress());
  expect(defaults.onOpen).toHaveBeenCalledWith(perpl);
  await act(async () => renderer.unmount());
});

it('keeps Perpl Testnet AUSD visible while venue context is loading, and respects explicit quote currency', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  const futureQuote = {...perpl, quoteAsset: {id: 'USDC', symbol: 'USDC', address: '0x3333333333333333333333333333333333333333', decimals: 6}};
  await act(async () => { renderer = ReactTestRenderer.create(<UserMarketsView {...defaults} markets={[perpl, futureQuote]} />); });
  expect(text(renderer)).toContain('AUSD per BTC-PERP');
  expect(text(renderer)).toContain('USDC per BTC-PERP');
  expect(text(renderer)).not.toContain('Price unit unavailable');
  await act(async () => renderer.unmount());
});

it('keeps verified OPEN markers and signed P&L while displaying one saved-data notice', async () => {
  const positions: UserMarketOpenPosition[] = [
    {source: 'manual', side: 'long', pnlUnits: '1230000'},
    {source: 'autonomous', side: 'short', pnlUnits: '-250000'},
  ];
  const marketPositions = new Map([[marketIdentity(perpl.venueId, perpl.marketId), positions]]);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserMarketsView {...defaults} markets={[perpl]}
    marketPositions={marketPositions} connectionNotice />); });
  const row = renderer.root.find(node => node.props.accessibilityRole === 'button' && String(node.props.accessibilityLabel).startsWith('Open Bitcoin'));
  expect(row.props.accessibilityLabel).toContain('Open position: manual long, autonomous short');
  expect(text(renderer)).toContain('OPEN');
  expect(text(renderer)).not.toContain('LAST KNOWN');
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Manual unrealized P and L +1.23 AUSD')).toBeTruthy();
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Autonomous unrealized P and L −0.25 AUSD')).toBeTruthy();
  expect(text(renderer)).toContain('saved from the last successful refresh');
  expect(text(renderer)).not.toContain('Recent quote');
  expect(text(renderer)).not.toContain('Stale quote');
  await act(async () => renderer.unmount());
});
