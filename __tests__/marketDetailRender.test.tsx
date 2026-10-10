import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
const mockRoute = {params: {venueId: 'perpl-direct-testnet-v1', marketId: '16'}};
const mockMarket = {kind: 'perpl' as const, venueId: 'perpl-direct-testnet-v1', marketId: '16', displayName: 'Perpl Testnet',
  symbol: 'BTC-PERP', name: 'Bitcoin perpetual', status: 'open' as const, marketOpen: true, available: true, testOnly: true,
  priceDecimals: 2, sizeDecimals: 3, capabilities: {marketData: true, manualLongShort: false},
  quote: {mark: '6712345', observedAt: Date.now(), bid: '6712300', ask: '6712400'}};

jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation, useRoute: () => mockRoute,
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: '0x1111111111111111111111111111111111111111'})}));
jest.mock('../src/services/marketDirectoryApi', () => ({marketDirectoryApi: {
  list: async () => ({markets: [mockMarket]}),
  detail: async () => ({market: mockMarket, candles: [], resolutionSeconds: 60, observedAt: Date.now()}),
  trades: async () => ({summaries: [], activity: []}),
}}));
jest.mock('../src/services/manualPerplApi', () => ({manualPerplApi: {account: async () => null}}));
jest.mock('../src/services/perplApi', () => ({perplApi: {current: async () => ({current: null})}}));
jest.mock('../src/components/MarketChart', () => ({MarketChart: () => null}));
jest.mock('../src/components/MarketTradeSummaryCard', () => ({MarketTradeSummaryCard: () => null}));
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.View, null, children);
  const Label = ({title, label, copy, children}: {title?: string; label?: string; copy?: string; children?: React.ReactNode}) =>
    ReactRuntime.createElement(Native.Text, null, title ?? label ?? copy ?? children);
  const DataRow = ({label, value}: {label: string; value: string}) => ReactRuntime.createElement(Native.Text, null, `${label}: ${value}`);
  return {Button: Label, Card: Container, DataRow, Notice: Label, PageHeader: Label, Screen: Container, StatusBadge: Label};
});

import {MarketDetailScreen} from '../src/screens/MarketDetailScreen';

test('market detail safely renders from loading to loaded data', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await act(async () => { renderer = ReactTestRenderer.create(<MarketDetailScreen />); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('BTC-PERP');
  expect(text).toContain('Perpl Testnet market · for Testnet verification.');
  expect(text).not.toContain('Rendered more hooks');
  expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Rendered more hooks');
  await act(async () => renderer.unmount());
  consoleError.mockRestore();
});
