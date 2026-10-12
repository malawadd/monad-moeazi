import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockOwner = '0x1111111111111111111111111111111111111111';
const mockVault = '0x2222222222222222222222222222222222222222';
const mockAusd = '0xa9012a055bd4e0edff8ce09f960291c09d5322dc';
const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
let mockCurrentRun: any;
let mockPresentationMode = 'developer';
const mockPrepare = jest.fn();
const mockEnroll = jest.fn();
const mockOpenMeraSigningSession = jest.fn();
const mockSession = {address: mockOwner, signEip1559Transaction: jest.fn(), signTypedData: jest.fn(), end: jest.fn()};
jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation,
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: mockPresentationMode, effectiveTheme: 'original'})}));
jest.mock('../src/services/monadApi', () => ({monadApi: {wallet: async () => ({ownerAddress: mockOwner, chainId: 10143,
  balances: [{asset: 'AUSD', amountUnits: '250000000', decimals: 6}]})}}));
jest.mock('../src/services/wallet/meraAuth', () => ({openMeraSigningSession: (...args: unknown[]) => mockOpenMeraSigningSession(...args)}));
jest.mock('../src/services/perplApi', () => ({perplApi: {
  venues: async () => ({venues: [{venueId: 'perpl-direct-testnet-v1', displayName: 'Perpl Testnet', chainId: 10143,
    executionModel: 'direct', enabled: true, collateral: {symbol: 'AUSD', address: '0xa9012a055bd4e0edff8ce09f960291c09d5322dc', decimals: 6},
    limits: {minAccountOpenUnits: '100000000', minFundingUnits: '100000000', maxFundingUnits: '500000000', minDurationSeconds: 600,
      maxDurationSeconds: 43200, backendMaxMarketSlippageBps: 500},
    markets: [{id: 1, symbol: 'BTC', isOpen: true, maxMarketSlippageBps: 500, maxLeverage: 5}]}]}),
  current: async () => ({current: mockCurrentRun}),
  prepare: (input: unknown) => mockPrepare(input),
  enroll: (input: unknown) => mockEnroll(input),
}, createPerplIdempotencyKey: () => 'perpl-test-key'}));
jest.mock('../src/services/perplValidation', () => {
  const actual = jest.requireActual('../src/services/perplValidation');
  return {...actual, validatePreparedPerpl: jest.fn(), validatePerplRawTransaction: jest.fn(), validatePerplSignature: jest.fn()};
});
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
import {MobileApiError} from '../src/services/apiClient';

function preparedReview() {
  const deadline = String(Math.floor(Date.now() / 1000) + 300);
  return {runId: 'prepared-run', venueId: 'perpl-direct-testnet-v1', chainId: 10143, ownerAddress: mockOwner,
    vaultAddress: mockVault, amountUnits: '100000000', collateral: {symbol: 'AUSD', address: mockAusd, decimals: 6},
    durationSeconds: 7200, maxPositionExposureUnits: '50000000', maxLeverage: 3, maxSlippageBps: 100,
    markets: [{id: 1, symbol: 'BTC', isOpen: true, maxMarketSlippageBps: 100, maxLeverage: 3}], limits: {},
    operatorPermission: {address: '0x3333333333333333333333333333333333333333', scope: 'trade', withdrawals: false, perOrderCapsEnforcedBy: 'Moeazi backend'},
    fundingTransaction: {chainId: 10143, type: 2, to: mockAusd, data: '0x1234', value: '0', nonce: '1', gasLimit: '65000', maxFeePerGas: '1000000000', maxPriorityFeePerGas: '100000000'},
    mandateTypedData: {domain: {name: 'Perpl', verifyingContract: mockVault}, types: {}, primaryType: 'PerplRunMandate',
      message: {policyVersion: 2, nonce: '1', setupDeadline: deadline}}, preparedExpiresAt: Date.now() + 600_000} as any;
}

async function flushPromises() { for (let index = 0; index < 12; index++) await Promise.resolve(); }

beforeEach(async () => {
  mockPresentationMode = 'developer';
  await AsyncStorage.clear();
  require('../src/services/signingGuard').resetSigningGuardForTests();
  mockNavigation.navigate.mockClear(); mockPrepare.mockReset(); mockEnroll.mockReset(); mockOpenMeraSigningSession.mockReset();
  mockSession.signEip1559Transaction.mockReset().mockResolvedValue('0x1234');
  mockSession.signTypedData.mockReset().mockResolvedValue('0x1234'); mockSession.end.mockReset();
  let releaseSession: (() => void) | undefined;
  mockSession.end.mockImplementation(() => { releaseSession?.(); releaseSession = undefined; });
  mockOpenMeraSigningSession.mockImplementation(async () => {
    releaseSession = require('../src/services/signingGuard').beginMeraSigningSession();
    return mockSession;
  });
  mockEnroll.mockResolvedValue({runId: 'prepared-run', venueId: 'perpl-direct-testnet-v1'});
  mockCurrentRun = {runId: 'active-run', venueId: 'perpl-direct-testnet-v1', status: 'active', phase: 'running',
    ownerAddress: mockOwner, vaultAddress: mockVault, chainId: 10143,
    collateral: {symbol: 'AUSD', address: mockAusd, decimals: 6}, expiresAt: Date.now() + 60_000};
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

test('an unsigned prepared run can be refreshed and the new exact review opens Mera', async () => {
  mockCurrentRun = {...mockCurrentRun, status: 'prepared'};
  mockPrepare.mockResolvedValue(preparedReview());
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplSetupScreen />); await flushPromises(); });
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Open Perpl run status')).toHaveLength(0);
  const prepareButton = renderer.root.find(node => node.props.accessibilityLabel === 'Prepare exact Perpl review');
  await act(async () => { prepareButton.props.onPress(); await flushPromises(); });
  const signButton = renderer.root.find(node => node.props.accessibilityLabel === 'Unlock Mera and sign exact setup');
  await act(async () => { signButton.props.onPress(); await flushPromises(); });
  expect(mockOpenMeraSigningSession).toHaveBeenCalledWith('signin');
  expect(mockSession.signEip1559Transaction).toHaveBeenCalledWith(10143, expect.objectContaining({to: mockAusd}));
  expect(mockSession.signTypedData).toHaveBeenCalledWith(10143, expect.objectContaining({primaryType: 'PerplRunMandate'}));
  expect(mockEnroll).toHaveBeenCalledWith(expect.objectContaining({runId: 'prepared-run'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplStatus');
  await act(async () => renderer.unmount());
});

test('a run becoming active after review preparation still blocks Mera signing', async () => {
  mockCurrentRun = null;
  mockPrepare.mockResolvedValue(preparedReview());
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplSetupScreen />); await flushPromises(); });
  const prepareButton = renderer.root.find(node => node.props.accessibilityLabel === 'Prepare exact Perpl review');
  await act(async () => { prepareButton.props.onPress(); await flushPromises(); });
  mockCurrentRun = {runId: 'new-active-run', venueId: 'perpl-direct-testnet-v1', status: 'active', phase: 'running',
    ownerAddress: mockOwner, vaultAddress: mockVault, chainId: 10143, collateral: {symbol: 'AUSD', address: mockAusd, decimals: 6}};
  const signButton = renderer.root.find(node => node.props.accessibilityLabel === 'Unlock Mera and sign exact setup');
  await act(async () => { signButton.props.onPress(); await flushPromises(); });
  expect(mockOpenMeraSigningSession).not.toHaveBeenCalled();
  expect(mockEnroll).not.toHaveBeenCalled();
  expect(mockNavigation.navigate).not.toHaveBeenCalledWith('PerplStatus');
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Open Perpl run status').length).toBeGreaterThan(0);
  await act(async () => renderer.unmount());
});

test('User Mode routes an on-chain unsettled-run conflict to run history and blocks another prepare', async () => {
  mockPresentationMode = 'user';
  mockCurrentRun = null;
  mockPrepare.mockRejectedValueOnce(new MobileApiError(
    'This Mera owner already has an active or unsettled Perpl run.', 409, 'perpl_run_active'));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplSetupScreen />); await flushPromises(); });
  const prepareButton = renderer.root.find(node => node.props.accessibilityLabel === 'Review this setup');
  await act(async () => { prepareButton.props.onPress(); await flushPromises(); });
  expect(mockPrepare).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Review this setup')).toHaveLength(0);
  const historyButton = renderer.root.find(node => node.props.accessibilityLabel === 'Review Perpl runs');
  await act(async () => historyButton.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplStatus');
  expect(mockPrepare).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});
