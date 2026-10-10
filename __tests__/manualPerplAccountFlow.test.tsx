import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {TextInput} from 'react-native';

const mockOwner = '0x1111111111111111111111111111111111111111';
const mockAccountAddress = '0x3333333333333333333333333333333333333333';
const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
let mockAccountResult: any;
const mockPrepareAccount = jest.fn();

jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation, useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/services/manualPerplApi', () => ({manualPerplApi: {
  account: async () => mockAccountResult,
  prepareAccount: (input: unknown) => mockPrepareAccount(input),
}, createManualPerplIdempotencyKey: () => 'manual-perpl-test-key'}));
jest.mock('../src/services/monadApi', () => ({monadApi: {wallet: async () => ({ownerAddress: mockOwner, chainId: 10143,
  balances: [{asset: 'AUSD', amountUnits: '2500000', decimals: 6}]})}}));
jest.mock('../src/services/marketDirectoryApi', () => ({marketDirectoryApi: {list: async () => ({markets: []})}}));
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.View, null, children);
  const Label = ({title, label, value, children}: {title?: string; label?: string; value?: string; children?: React.ReactNode}) =>
    ReactRuntime.createElement(Native.Text, null, title ?? label ?? value ?? children);
  const Button = ({label, onPress, disabled}: {label: string; onPress: () => void; disabled?: boolean}) =>
    ReactRuntime.createElement(Native.Pressable, {accessibilityRole: 'button', accessibilityLabel: label, onPress, disabled}, ReactRuntime.createElement(Native.Text, null, label));
  const Field = ({label, ...props}: {label: string} & Record<string, unknown>) =>
    ReactRuntime.createElement(Native.TextInput, {accessibilityLabel: label, ...props});
  return {Button, Card: Container, DataRow: Label, Field, Notice: Label, PageHeader: Label, Screen: Container, StatusBadge: Label};
});

import {PerplManualAccountScreen} from '../src/screens/PerplManualAccountScreen';

function account(status: 'not_created' | 'created' | 'open') {
  return {chainId: 10143, ownerAddress: mockOwner, accountAddress: status === 'not_created' ? null : mockAccountAddress,
    accountId: status === 'open' ? 71 : null, status, collateral: {symbol: 'AUSD', address: mockAccountAddress, decimals: 6,
      balanceUnits: '5000000', lockedUnits: '0'}, positions: [], orders: [], observedAt: Date.now(), blockNumber: 10,
    capabilities: {createAccount: status === 'not_created', fundAccount: status !== 'not_created', openAccount: status === 'created',
      deposit: status === 'open', withdraw: status === 'open', marketOrders: status === 'open', limitOrders: status === 'open',
      cancelOrders: status === 'open', closePosition: status === 'open', reducePosition: status === 'open'}};
}

function prepared(action: string, amountUnits?: string) {
  const to = '0x2222222222222222222222222222222222222222';
  return {operationId: 'setup-operation', venueId: 'perpl-direct-testnet-v1', chainId: 10143, status: 'prepared', action,
    expiresAt: Date.now() + 60_000, transaction: {chainId: 10143, type: 'eip1559', to, data: '0x1234', value: '0', nonce: '3',
      gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'},
    review: {action, ownerAddress: mockOwner, chainId: 10143, venueId: 'perpl-direct-testnet-v1', accountAddress: mockAccountAddress,
      ...(amountUnits ? {amountUnits} : {}), transactionTarget: to, transactionValue: '0',
      maxGas: {gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000', maxCostWei: '63000000000000'}}};
}

async function renderAccount(status: 'not_created' | 'created' | 'open') {
  mockAccountResult = account(status);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplManualAccountScreen />); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return renderer;
}

async function enterAmount(renderer: ReactTestRenderer.ReactTestRenderer, amount: string, button: string) {
  const field = renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'AUSD amount');
  expect(field).toBeDefined();
  await act(async () => field!.props.onChangeText(amount));
  const control = renderer.root.findAll(node => node.props.accessibilityLabel === button)[0];
  expect(control).toBeDefined();
  await act(async () => control!.props.onPress());
}
async function pressButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const control = renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
  expect(control).toBeDefined();
  await act(async () => control!.props.onPress());
}

beforeEach(() => { mockNavigation.navigate.mockClear(); mockPrepareAccount.mockReset(); });

test('created manual account opens with the exact reviewed AUSD amount', async () => {
  mockPrepareAccount.mockImplementation(async ({action, amountUnits}: {action: string; amountUnits?: string}) => prepared(action, amountUnits));
  const renderer = await renderAccount('created');
  await enterAmount(renderer, '1.25', 'Review Perpl account opening');
  expect(mockPrepareAccount).toHaveBeenCalledWith({action: 'open', amountUnits: '1250000', idempotencyKey: 'manual-perpl-test-key'});
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'open', amountUnits: '1250000', ownerAddress: mockOwner}),
    returnRoute: 'PerplManualAccount',
  }));
  await act(async () => renderer.unmount());
});

test('open manual account exposes funding and reviews the exact amount', async () => {
  mockPrepareAccount.mockImplementation(async ({action, amountUnits}: {action: string; amountUnits?: string}) => prepared(action, amountUnits));
  const renderer = await renderAccount('open');
  await enterAmount(renderer, '2', 'Review AUSD funding');
  expect(mockPrepareAccount).toHaveBeenCalledWith({action: 'fund', amountUnits: '2000000', idempotencyKey: 'manual-perpl-test-key'});
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'fund', amountUnits: '2000000', accountAddress: mockAccountAddress}),
  }));
  await act(async () => renderer.unmount());
});

test('new manual account starts through a fresh creation review', async () => {
  mockPrepareAccount.mockImplementation(async ({action, amountUnits}: {action: string; amountUnits?: string}) => prepared(action, amountUnits));
  const renderer = await renderAccount('not_created');
  await pressButton(renderer, 'Review manual account creation');
  expect(mockPrepareAccount).toHaveBeenCalledWith({action: 'create', idempotencyKey: 'manual-perpl-test-key'});
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'create', ownerAddress: mockOwner, venueId: 'perpl-direct-testnet-v1'}),
  }));
  await act(async () => renderer.unmount());
});
