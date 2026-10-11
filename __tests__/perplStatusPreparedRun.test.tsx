import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockOwner = '0x1111111111111111111111111111111111111111';
const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
const mockPreparedRun = {runId: 'prepared-run', venueId: 'perpl-direct-testnet-v1', status: 'prepared', phase: 'prepared',
  ownerAddress: mockOwner, vaultAddress: '0x2222222222222222222222222222222222222222', chainId: 10143,
  collateral: {symbol: 'AUSD', address: '0xa9012a055bd4e0edff8ce09f960291c09d5322dc', decimals: 6}};

jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation,
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/services/perplApi', () => ({perplApi: {
  current: async () => ({current: mockPreparedRun}), history: async () => ({runs: [], hasMore: false, nextCursor: null}),
}, createPerplIdempotencyKey: () => 'perpl-test-key'}));
jest.mock('../src/services/wallet/meraAuth', () => ({openMeraSigningSession: jest.fn()}));
jest.mock('../src/screens/PerplRecoveryPanel', () => ({PerplRecoveryPanel: () => null}));
jest.mock('../src/components/PerplOptimizerCard', () => ({PerplOptimizerCard: () => null}));
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.View, null, children);
  const Button = ({label, onPress, disabled}: {label: string; onPress: () => void; disabled?: boolean}) => ReactRuntime.createElement(Native.Pressable,
    {accessibilityRole: 'button', accessibilityLabel: label, onPress, disabled}, ReactRuntime.createElement(Native.Text, null, label));
  const Label = ({title, label, value, copy, children}: {title?: string; label?: string; value?: string; copy?: string; children?: React.ReactNode}) =>
    ReactRuntime.createElement(Native.Text, null, title ?? label ?? value ?? copy ?? children);
  return {Button, Card: Container, DataRow: Label, LoadingBlock: Label, Notice: Label, PageHeader: Label, Screen: Container, StatusBadge: Label};
});

import {PerplStatusScreen} from '../src/screens/PerplStatusScreen';

test('prepared runs link back to setup and never offer stop', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplStatusScreen />); await Promise.resolve(); await Promise.resolve(); });
  const setupButton = renderer.root.find(node => node.props.accessibilityLabel === 'Return to Perpl setup');
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Prepare Perpl stop review')).toHaveLength(0);
  await act(async () => setupButton.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplSetup');
  await act(async () => renderer.unmount());
});
