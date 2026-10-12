import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text, TextInput} from 'react-native';

const mockNavigation = {navigate: jest.fn(), goBack: jest.fn(), canGoBack: () => true};
const mockPrepare = jest.fn();
const mockUpdatePreferences = jest.fn();
let mockMode = 'user';
let mockTheme = 'original';
let mockWallet: any;
const mockOwner = `0x${'a'.repeat(40)}`;

jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigation, useIsFocused: () => true}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({
  presentationMode: mockMode, effectiveTheme: mockTheme,
})}));
jest.mock('../src/services/useMarketQueries', () => ({useMonadWalletQuery: () => mockWallet}));
jest.mock('../src/services/monadApi', () => ({monadApi: {prepare: (...args: unknown[]) => mockPrepare(...args)}, createMonadIdempotencyKey: () => 'test-idempotency'}));
jest.mock('../src/services/monadValidation', () => ({isAddress: () => true, validatePreparedMonadOperation: jest.fn()}));
jest.mock('../src/services/monadFormatting', () => ({formatMonadUnits: (value: string, decimals = 18) => {
  const units = BigInt(value), scale = 10n ** BigInt(decimals), whole = (units / scale).toString();
  const fraction = (units % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
},
  parseMonadAmount: (value: string) => value === '0.25' ? '250000000000000000' : '0'}));
jest.mock('../src/services/notifications/NotificationClient', () => ({
  defaultNotificationPreferences: {enabled: false, autonomousEntries: true, autonomousCloses: true,
    settlementProblems: true, manualFills: true, showAmounts: false},
  getNotificationPreferences: jest.fn(async () => ({enabled: false, autonomousEntries: true, autonomousCloses: true,
    settlementProblems: true, manualFills: true, showAmounts: false})),
  getPushRegistrationAdapter: () => ({updatePreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
    registerDevice: jest.fn(async () => true), unregisterDevice: jest.fn()}),
}));
jest.mock('../src/services/apiClient', () => ({MobileApiError: class MobileApiError extends Error {code = 'push_disabled';}}));
jest.mock('../src/theme/userThemes', () => ({userThemeTokens: (id: string) => ({id, ink: '#111111', muted: '#555555',
  background: '#ffffff', surface: '#ffffff', raised: '#eeeeee', border: '#111111', accent: '#ffcc00',
  accentText: '#111111', accentBorder: '#111111', success: '#ddffdd', danger: '#ffdddd', neutralSurface: '#eeeeee'})}));
jest.mock('../src/components/user/UserPrimitives', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Wrap = ({children, theme}: any) => ReactRuntime.createElement(Native.View, {testID: `user-page-${theme?.id ?? 'none'}`}, children);
  const Button = ({label, onPress, disabled = false, loading = false}: any) => ReactRuntime.createElement(Native.Pressable,
    {accessibilityRole: 'button', accessibilityLabel: label, accessibilityState: {disabled: disabled || loading}, disabled: disabled || loading, onPress},
    ReactRuntime.createElement(Native.Text, null, label));
  const Heading = ({title}: any) => ReactRuntime.createElement(Native.Text, null, title);
  const Card = ({children}: any) => ReactRuntime.createElement(Native.View, null, children);
  const UserText = ({children}: any) => ReactRuntime.createElement(Native.Text, null, children);
  const Disclosure = ({children, label, value, expanded = false, onPress}: any) => ReactRuntime.createElement(Native.View, null,
    ReactRuntime.createElement(Native.Pressable, {accessibilityRole: 'button', accessibilityLabel: `${label}: ${value}`, onPress},
      ReactRuntime.createElement(Native.Text, null, `${label}: ${value}`)), expanded ? children : null);
  return {UserPage: Wrap, UserButton: Button, UserHeading: Heading, UserCard: Card, UserText, UserDisclosure: Disclosure};
});
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Screen = ({children}: any) => ReactRuntime.createElement(Native.View, {testID: 'developer-send'}, children);
  const FlowScreen = ({children}: any) => ReactRuntime.createElement(Native.View, {testID: 'developer-notifications'}, children);
  const Empty = ({children, label}: any) => ReactRuntime.createElement(Native.View, null, label ? ReactRuntime.createElement(Native.Text, null, label) : null, children);
  const Button = ({label, onPress}: any) => ReactRuntime.createElement(Native.Pressable, {accessibilityRole: 'button', accessibilityLabel: label, onPress}, ReactRuntime.createElement(Native.Text, null, label));
  const Field = ({label, ...props}: any) => ReactRuntime.createElement(Native.TextInput, {accessibilityLabel: label, ...props});
  return {Screen, FlowScreen, PageHeader: Empty, Button, Card: Empty, Field, LoadingBlock: Empty, Notice: Empty, Panel: Empty, StatusBadge: Empty};
});

import {SendScreen} from '../src/screens/SendScreen';
import {NotificationSettingsScreen} from '../src/screens/NotificationSettingsScreen';

function pressable(renderer: ReactTestRenderer.ReactTestRenderer, role: string, label: string) {
  return renderer.root.find(node => node.props.accessibilityRole === role && node.props.accessibilityLabel === label);
}
function treeText(renderer: ReactTestRenderer.ReactTestRenderer) { return JSON.stringify(renderer.toJSON()); }
function visibleText(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType(Text).map(node => Array.isArray(node.props.children)
    ? node.props.children.join('') : String(node.props.children ?? '')).join(' ');
}
async function flush() { for (let index = 0; index < 10; index += 1) await Promise.resolve(); }

beforeEach(() => {
  jest.clearAllMocks(); mockMode = 'user'; mockTheme = 'original';
  mockWallet = {data: {ownerAddress: mockOwner, chainId: 10143, stale: false, observedBlock: 42, balances: [
    {asset: 'MON', amountUnits: '5000000000000000000', decimals: 18}, {asset: 'AUSD', amountUnits: '6000000', decimals: 6},
    {asset: 'USDC', amountUnits: '10000000', decimals: 6}, {asset: 'WMON', amountUnits: '0', decimals: 18},
  ]}, error: null, isLoading: false, refetch: jest.fn(async () => undefined)};
  mockPrepare.mockResolvedValue({operationId: 'prepared-send-id'});
  mockUpdatePreferences.mockResolvedValue(undefined);
});

test('User Send keeps current wallet validation and opens the existing OperationReview payload', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SendScreen />); });
  expect(renderer.root.findByProps({testID: 'user-page-original'})).toBeTruthy();
  await act(async () => pressable(renderer, 'button', 'Select MON').props.onPress());
  const customAmount = renderer.root.find(node => node.props.accessibilityRole === 'button'
    && String(node.props.accessibilityLabel).startsWith('Custom amount:'));
  await act(async () => customAmount.props.onPress());
  const amount = renderer.root.find(node => node.type === TextInput && node.props.accessibilityLabel === 'Amount (MON)');
  const recipient = renderer.root.find(node => node.type === TextInput && node.props.accessibilityLabel === 'Recipient wallet address');
  await act(async () => { amount.props.onChangeText('0.25'); recipient.props.onChangeText(`0x${'b'.repeat(40)}`); });
  await act(async () => { pressable(renderer, 'button', 'Prepare transfer review').props.onPress(); await flush(); });
  expect(mockPrepare).toHaveBeenCalledWith(expect.objectContaining({kind: 'send_mon', asset: 'MON', amount: '0.25',
    recipient: `0x${'b'.repeat(40)}`, idempotencyKey: 'test-idempotency'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('OperationReview', expect.objectContaining({
    expected: {ownerAddress: mockOwner, kind: 'send_mon', amount: '0.25', asset: 'MON', recipient: `0x${'b'.repeat(40)}`}, asset: 'MON',
  }));
  await act(async () => renderer.unmount());
});

test('User Send offers exact balance-based percentages before the custom amount', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SendScreen />); });
  await act(async () => pressable(renderer, 'button', 'Select MON').props.onPress());
  expect(treeText(renderer)).toContain('Current wallet balance');
  expect(treeText(renderer)).not.toContain('Balance observed at block');
  const presets = [25, 50, 75].map(percent => renderer.root.findByProps({testID: `send-preset-${percent}`}));
  expect(presets.map(node => node.props.accessibilityLabel)).toEqual([
    'Use 25% of current MON balance', 'Use 50% of current MON balance', 'Use 75% of current MON balance',
  ]);
  await act(async () => presets[0].props.onPress());
  expect(renderer.root.findByProps({testID: 'send-preset-25'}).props.accessibilityState.checked).toBe(true);
  expect(renderer.root.findAllByType(Text).filter(node => node.props.children === '1.25 MON')).toHaveLength(1);
  const customAmount = renderer.root.find(node => node.props.accessibilityRole === 'button'
    && String(node.props.accessibilityLabel).startsWith('Custom amount:'));
  await act(async () => customAmount.props.onPress());
  const amount = renderer.root.find(node => node.type === TextInput && node.props.accessibilityLabel === 'Amount (MON)');
  expect(amount.props.value).toBe('1.25');
  await act(async () => renderer.unmount());
});

test('switching assets clears the User amount instead of reinterpreting it', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SendScreen />); });
  await act(async () => pressable(renderer, 'button', 'Select MON').props.onPress());
  await act(async () => renderer.root.findByProps({testID: 'send-preset-25'}).props.onPress());
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === '1.25 MON')).toBe(true);
  await act(async () => pressable(renderer, 'button', 'Choose token · MON: Wallet balances').props.onPress());
  const usdc = renderer.root.find(node => node.props.accessibilityRole === 'radio' && String(node.props.accessibilityLabel).startsWith('USDC,'));
  await act(async () => { usdc.props.onPress(); });
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Not set')).toBe(true);
  expect(renderer.root.findByProps({testID: 'send-preset-25'}).props.accessibilityState.checked).toBe(false);
  await act(async () => renderer.unmount());
});

test('AUSD is the User Send default and unsupported assets never reach prepare; long press opens actual held-token choices', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SendScreen />); });
  expect(pressable(renderer, 'button', 'Select AUSD').props.accessibilityState.selected).toBe(true);
  expect(visibleText(renderer)).toContain('AUSD sending is coming soon.');
  expect(pressable(renderer, 'button', 'Prepare transfer review').props.disabled).toBe(true);
  expect(renderer.root.findByProps({testID: 'send-preset-25'}).props.accessibilityLabel).toBe('Use 25% of current AUSD balance');
  expect(pressable(renderer, 'button', 'Choose token · AUSD: Wallet balances')).toBeTruthy();
  await act(async () => { pressable(renderer, 'button', 'Prepare transfer review').props.onPress(); await flush(); });
  expect(mockPrepare).not.toHaveBeenCalled();
  await act(async () => pressable(renderer, 'button', 'Select MON').props.onLongPress());
  const options = renderer.root.findAll(node => node.props.accessibilityRole === 'radio');
  expect(options.some(node => node.props.accessibilityLabel === 'AUSD, 6, sending coming soon')).toBe(true);
  expect(options.some(node => node.props.accessibilityLabel === 'MON, 5, sending available')).toBe(true);
  expect(options.some(node => node.props.accessibilityLabel === 'USDC, 10, sending available')).toBe(true);
  expect(options.some(node => String(node.props.accessibilityLabel).startsWith('WMON,'))).toBe(false);
  await act(async () => pressable(renderer, 'button', 'Choose token · AUSD: Wallet balances').props.onPress());
  await act(async () => pressable(renderer, 'button', 'Select AUSD').props.onLongPress());
  expect(renderer.root.find(node => node.props.accessibilityRole === 'radio' && String(node.props.accessibilityLabel).startsWith('AUSD,'))).toBeTruthy();
  await act(async () => pressable(renderer, 'button', 'Choose token · AUSD: Wallet balances').props.onPress());
  await act(async () => pressable(renderer, 'button', 'Choose token · AUSD: Wallet balances').props.onPress());
  const usdc = renderer.root.find(node => node.props.accessibilityRole === 'radio' && String(node.props.accessibilityLabel).startsWith('USDC,'));
  await act(async () => { usdc.props.onPress(); });
  expect(pressable(renderer, 'button', 'Choose token · USDC: Wallet balances')).toBeTruthy();
  expect(pressable(renderer, 'button', 'Prepare transfer review').props.disabled).toBe(false);
  expect(mockPrepare).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

test.each([
  ['owner', {ownerAddress: `0x${'c'.repeat(40)}`}],
  ['network', {chainId: 1}],
])('User Send does not prepare using a %s-mismatched wallet snapshot', async (_label, mismatch) => {
  mockWallet.data = {...mockWallet.data, ...mismatch};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SendScreen />); });
  await act(async () => pressable(renderer, 'button', 'Select MON').props.onPress());
  await act(async () => { pressable(renderer, 'button', 'Prepare transfer review').props.onPress(); await flush(); });
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(treeText(renderer)).toContain('Refresh the balance for this wallet on Monad Testnet');
  await act(async () => renderer.unmount());
});

test('User Send does not prepare against a stale wallet snapshot', async () => {
  mockWallet.data.stale = true;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SendScreen />); });
  await act(async () => pressable(renderer, 'button', 'Select MON').props.onPress());
  await act(async () => { pressable(renderer, 'button', 'Prepare transfer review').props.onPress(); await flush(); });
  expect(mockPrepare).not.toHaveBeenCalled();
  expect(treeText(renderer)).toContain('A current wallet balance is required');
  await act(async () => renderer.unmount());
});

test('User notification choices update the same account preference API and survive a theme rerender', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<NotificationSettingsScreen />); await flush(); });
  const control = pressable(renderer, 'switch', 'Manual fills');
  expect(control.props.accessibilityState.checked).toBe(true);
  await act(async () => { control.props.onPress(); await flush(); });
  expect(mockUpdatePreferences).toHaveBeenCalledWith({enabled: false, autonomousEntries: true, autonomousCloses: true,
    settlementProblems: true, manualFills: false, showAmounts: false});
  expect(treeText(renderer)).toContain('Preference saved');
  mockTheme = 'candy-riot';
  await act(async () => renderer.update(<NotificationSettingsScreen />));
  expect(renderer.root.findByProps({testID: 'user-page-candy-riot'})).toBeTruthy();
  expect(treeText(renderer)).toContain('Trade notifications');
  await act(async () => renderer.unmount());
});

test('Developer screen components remain selected by the original presentation branches', async () => {
  mockMode = 'developer';
  let send!: ReactTestRenderer.ReactTestRenderer;
  let notifications!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { send = ReactTestRenderer.create(<SendScreen />); notifications = ReactTestRenderer.create(<NotificationSettingsScreen />); await flush(); });
  expect(send.root.findByProps({testID: 'developer-send'})).toBeTruthy();
  expect(notifications.root.findByProps({testID: 'developer-notifications'})).toBeTruthy();
  await act(async () => { send.unmount(); notifications.unmount(); });
});

test('Developer Send preserves its original amount when the asset changes', async () => {
  mockMode = 'developer';
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SendScreen />); });
  const amount = renderer.root.find(node => node.type === TextInput && node.props.accessibilityLabel === 'Amount (MON)');
  await act(async () => amount.props.onChangeText('0.25'));
  const usdc = renderer.root.findAll(node => node.props.accessibilityState?.selected === false).find(node =>
    node.findAllByType(Text).some(child => child.props.children === 'USDC'));
  expect(usdc).toBeDefined();
  await act(async () => usdc!.props.onPress());
  expect(renderer.root.find(node => node.type === TextInput && node.props.accessibilityLabel === 'Amount (USDC)').props.value).toBe('0.25');
  await act(async () => renderer.unmount());
});
