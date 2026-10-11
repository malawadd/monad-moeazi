import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockOwner = '0x1111111111111111111111111111111111111111';
const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
let mockCurrentRun: any;
const mockPrepare = jest.fn();
jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation,
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/services/monadApi', () => ({monadApi: {wallet: async () => ({ownerAddress: mockOwner, chainId: 10143,
  balances: [{asset: 'AUSD', amountUnits: '250000000', decimals: 6}]})}}));
jest.mock('../src/services/wallet/meraAuth', () => ({openMeraSigningSession: jest.fn()}));
jest.mock('../src/services/perplApi', () => ({perplApi: {
  venues: async () => ({venues: [{venueId: 'perpl-direct-testnet-v1', displayName: 'Perpl Testnet', chainId: 10143,
    executionModel: 'direct', enabled: true, collateral: {symbol: 'AUSD', address: '0xa9012a055bd4e0edff8ce09f960291c09d5322dc', decimals: 6},
    limits: {minAccountOpenUnits: '100000000', minFundingUnits: '100000000', maxFundingUnits: '500000000', minDurationSeconds: 600,
      maxDurationSeconds: 43200, backendMaxMarketSlippageBps: 500},
    markets: [{id: 1, symbol: 'BTC', isOpen: true, maxMarketSlippageBps: 500, maxLeverage: 5}]}]}),
  current: async () => ({current: mockCurrentRun}),
  prepare: (input: unknown) => mockPrepare(input),
}, createPerplIdempotencyKey: () => 'perpl-test-key'}));
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.View, null, children);
  const Button = ({label, onPress, disabled}: {label: string; onPress: () => void; disabled?: boolean}) => ReactRuntime.createElement(Native.Pressable,
    {accessibilityRole: 'button', accessibilityLabel: label, onPress, disabled}, ReactRuntime.createElement(Native.Text, null, label));
  const Label = ({title, label, value, copy, children}: {title?: string; label?: string; value?: string; copy?: string; children?: React.ReactNode}) =>
    ReactRuntime.createElement(Native.Text, null, title ?? label ?? value ?? copy ?? children);
  const Field = ({label}: {label: string}) => ReactRuntime.createElement(Native.Text, null, label);
  return {Button, Card: Container, DataRow: Label, Field, LoadingBlock: Label, Notice: Label, PageHeader: Label, Screen: Container};
});

import {PerplSetupScreen} from '../src/screens/PerplSetupScreen';

beforeEach(() => {
  mockNavigation.navigate.mockClear(); mockPrepare.mockReset();
  mockCurrentRun = {runId: 'active-run', venueId: 'perpl-direct-testnet-v1', status: 'active', phase: 'running',
    ownerAddress: mockOwner, vaultAddress: '0x2222222222222222222222222222222222222222', chainId: 10143,
    collateral: {symbol: 'AUSD', address: '0xa9012a055bd4e0edff8ce09f960291c09d5322dc', decimals: 6}, expiresAt: Date.now() + 60_000};
});

test('an active Perpl run opens status and blocks another prepare', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplSetupScreen />); await Promise.resolve(); await Promise.resolve(); });
  const statusButton = renderer.root.findAll(node => node.props.accessibilityLabel === 'Open Perpl run status')[0];
  expect(statusButton).toBeDefined();
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Prepare exact Perpl review')).toHaveLength(0);
  await act(async () => statusButton.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplStatus');
  expect(mockPrepare).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});
