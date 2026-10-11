import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text, TextInput} from 'react-native';
import {encodeFunctionData} from 'viem';

const mockOwner = '0x1111111111111111111111111111111111111111';
const mockExchangeAddress = '0x3333333333333333333333333333333333333333';
const mockTokenAddress = '0x4444444444444444444444444444444444444444';
const mockLegacyAccountAddress = '0x5555555555555555555555555555555555555555';
const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
let mockAccountResult: any;
const mockPrepareAccount = jest.fn();

jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigation, useIsFocused: () => true}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/services/useMarketQueries', () => ({
  useManualPerplAccountQuery: () => ({data: mockAccountResult, isLoading: false, isFetching: false, error: null, refetch: async () => ({})}),
  useMarketDirectoryQuery: () => ({data: {markets: []}, isLoading: false, isFetching: false, error: null, refetch: async () => ({})}),
}));
jest.mock('../src/services/manualPerplApi', () => ({manualPerplApi: {
  account: async () => mockAccountResult,
  prepareAccount: (input: unknown) => mockPrepareAccount(input),
}, createManualPerplIdempotencyKey: () => 'manual-perpl-test-key'}));
jest.mock('../src/services/perplApi', () => ({perplApi: {venues: async () => ({venues: [{venueId: 'perpl-direct-testnet-v1', chainId: 10143,
  collateral: {symbol: 'AUSD', address: mockTokenAddress, decimals: 6}, limits: {minAccountOpenUnits: '100000000'}}]})}}));
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

const APPROVE_ABI = [{type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{name: 'spender', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}]}] as const;
const CREATE_ABI = [{type: 'function', name: 'createAccount', stateMutability: 'nonpayable',
  inputs: [{name: 'amountCNS', type: 'uint256'}], outputs: [{type: 'uint256'}]}] as const;

function account(status: 'not_created' | 'open', allowanceUnits = '0', withLegacy = false, lockedUnits = '0') {
  const exists = status === 'open';
  return {chainId: 10143, ownerAddress: mockOwner, exchangeAddress: mockExchangeAddress,
    accountMode: exists ? 'direct_wallet' : 'not_created', accountAddress: exists ? mockOwner : null,
    accountId: exists ? 71 : null, status, collateral: {symbol: 'AUSD', address: mockTokenAddress, decimals: 6,
      balanceUnits: '5000000', lockedUnits, walletBalanceUnits: '250000000', allowanceUnits}, positions: [], orders: [], observedAt: Date.now(), blockNumber: 10,
    capabilities: {approve: true, open: !exists, createAccount: !exists, deposit: exists, withdraw: exists, marketOrders: exists, limitOrders: exists,
      cancelOrders: exists, closePosition: exists, reducePosition: exists},
    legacyRecovery: withLegacy ? {accountMode: 'legacy_delegated', status: 'open', accountAddress: mockLegacyAccountAddress, accountId: 19,
      collateral: {balanceUnits: '3000000', lockedUnits: '0', tokenBalanceUnits: '1000000'}, positions: [], orders: [],
      capabilities: {withdraw: true, rescueTokens: true, marketOrders: false, limitOrders: false, cancelOrders: false, closePosition: false, reducePosition: false}}
      : {accountMode: null, status: 'none', accountAddress: null, accountId: null,
        collateral: {balanceUnits: '0', lockedUnits: '0', tokenBalanceUnits: '0'}, positions: [], orders: [],
        capabilities: {withdraw: false, rescueTokens: false, marketOrders: false, limitOrders: false, cancelOrders: false, closePosition: false, reducePosition: false}}};
}

function prepared(action: string, amountUnits: string) {
  const expiresAt = Date.now() + 60_000;
  const legacy = action.startsWith('legacy_');
  const to = action === 'approve' ? mockTokenAddress : legacy ? mockLegacyAccountAddress : mockExchangeAddress;
  const data = action === 'approve' ? encodeFunctionData({abi: APPROVE_ABI, functionName: 'approve', args: [mockExchangeAddress, BigInt(amountUnits)]})
    : action === 'open' ? encodeFunctionData({abi: CREATE_ABI, functionName: 'createAccount', args: [BigInt(amountUnits)]}) : '0x1234';
  return {operationId: 'manual-operation', venueId: 'perpl-direct-testnet-v1', chainId: 10143, status: 'prepared', action,
    expiresAt, transaction: {chainId: 10143, type: 'eip1559', to, data, value: '0', nonce: '3',
      gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'},
    review: {action, ownerAddress: mockOwner, chainId: 10143, venueId: 'perpl-direct-testnet-v1', accountMode: legacy ? 'legacy_delegated' : 'direct_wallet',
      accountAddress: legacy ? mockLegacyAccountAddress : mockOwner,
      amountUnits, transactionTarget: to, transactionData: data, transactionNonce: '3', transactionValue: '0', expiresAt,
      maxGas: {gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000', maxCostWei: '63000000000000'}}};
}

async function renderAccount(status: 'not_created' | 'open', allowanceUnits = '0', withLegacy = false, lockedUnits = '0') {
  mockAccountResult = account(status, allowanceUnits, withLegacy, lockedUnits);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplManualAccountScreen />); await Promise.resolve(); await Promise.resolve(); });
  return renderer;
}
async function setAmount(renderer: ReactTestRenderer.ReactTestRenderer, value: string) {
  const field = renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'AUSD amount');
  expect(field).toBeDefined();
  await act(async () => field!.props.onChangeText(value));
}
async function pressButton(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const control = renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
  expect(control).toBeDefined();
  await act(async () => control!.props.onPress());
}

beforeEach(() => { mockNavigation.navigate.mockClear(); mockPrepareAccount.mockReset(); });

test('new direct account requires a separate exact AUSD approval before createAccount', async () => {
  mockPrepareAccount.mockImplementation(async ({action, amountUnits}: {action: string; amountUnits: string}) => prepared(action, amountUnits));
  const renderer = await renderAccount('not_created');
  await setAmount(renderer, '100');
  const openButton = renderer.root.findAll(node => node.props.accessibilityLabel === 'Review account creation and initial deposit')[0];
  expect(openButton.props.disabled).toBe(true);
  await pressButton(renderer, 'Review exact AUSD approval');
  expect(mockPrepareAccount).toHaveBeenCalledWith({action: 'approve', amountUnits: '100000000', idempotencyKey: 'manual-perpl-test-key'});
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'approve', amountUnits: '100000000', ownerAddress: mockOwner,
      accountAddress: mockOwner, transactionTarget: mockTokenAddress, approvalSpender: mockExchangeAddress}),
    returnRoute: 'PerplManualAccount',
  }));
  await act(async () => renderer.unmount());
});

test('approved direct account creation reviews exact initial collateral with Perpl', async () => {
  mockPrepareAccount.mockImplementation(async ({action, amountUnits}: {action: string; amountUnits: string}) => prepared(action, amountUnits));
  const renderer = await renderAccount('not_created', '100000000');
  await setAmount(renderer, '100');
  await pressButton(renderer, 'Review account creation and initial deposit');
  expect(mockPrepareAccount).toHaveBeenCalledWith({action: 'open', amountUnits: '100000000', idempotencyKey: 'manual-perpl-test-key'});
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'open', amountUnits: '100000000', accountAddress: mockOwner, transactionTarget: mockExchangeAddress}),
  }));
  await act(async () => renderer.unmount());
});

test('later direct deposits use the existing exchange account and its exact AUSD allowance', async () => {
  mockPrepareAccount.mockImplementation(async ({action, amountUnits}: {action: string; amountUnits: string}) => prepared(action, amountUnits));
  const renderer = await renderAccount('open', '5000000');
  await setAmount(renderer, '2');
  await pressButton(renderer, 'Review AUSD deposit');
  expect(mockPrepareAccount).toHaveBeenCalledWith({action: 'deposit', amountUnits: '2000000', idempotencyKey: 'manual-perpl-test-key'});
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'deposit', amountUnits: '2000000', accountMode: 'direct_wallet', accountAddress: mockOwner}),
  }));
  await act(async () => renderer.unmount());
});

test('withdrawals are capped by free collateral after Perpl locked margin', async () => {
  mockPrepareAccount.mockImplementation(async ({action, amountUnits}: {action: string; amountUnits: string}) => prepared(action, amountUnits));
  const renderer = await renderAccount('open', '5000000', false, '2000000');
  await setAmount(renderer, '4');
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Review AUSD withdrawal')[0].props.disabled).toBe(true);
  await setAmount(renderer, '3');
  await pressButton(renderer, 'Review AUSD withdrawal');
  expect(mockPrepareAccount).toHaveBeenCalledWith({action: 'withdraw', amountUnits: '3000000', idempotencyKey: 'manual-perpl-test-key'});
  await act(async () => renderer.unmount());
});

test('legacy recovery withdraw remains bound to the saved delegated account', async () => {
  mockPrepareAccount.mockImplementation(async ({action, amountUnits}: {action: string; amountUnits: string}) => prepared(action, amountUnits));
  const renderer = await renderAccount('not_created', '0', true);
  const field = renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Legacy recovery amount');
  expect(field).toBeDefined();
  await act(async () => field!.props.onChangeText('1'));
  await pressButton(renderer, 'Review legacy AUSD withdrawal');
  expect(mockPrepareAccount).toHaveBeenCalledWith({action: 'legacy_withdraw', amountUnits: '1000000', idempotencyKey: 'manual-perpl-test-key'});
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'legacy_withdraw', accountMode: 'legacy_delegated',
      accountAddress: mockLegacyAccountAddress, transactionTarget: mockLegacyAccountAddress}),
  }));
  await act(async () => renderer.unmount());
});

test('legacy token rescue returns the exact amount to the Mera-owned recovery flow', async () => {
  mockPrepareAccount.mockImplementation(async ({action, amountUnits}: {action: string; amountUnits: string}) => prepared(action, amountUnits));
  const renderer = await renderAccount('not_created', '0', true);
  const field = renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Legacy recovery amount');
  expect(field).toBeDefined();
  await act(async () => field!.props.onChangeText('1'));
  await pressButton(renderer, 'Recover legacy AUSD to Mera wallet');
  expect(mockPrepareAccount).toHaveBeenCalledWith({action: 'legacy_rescue', amountUnits: '1000000', idempotencyKey: 'manual-perpl-test-key'});
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'legacy_rescue', accountMode: 'legacy_delegated',
      accountAddress: mockLegacyAccountAddress, transactionTarget: mockLegacyAccountAddress}),
  }));
  await act(async () => renderer.unmount());
});

test('an unavailable Perpl snapshot shows no account or recovery actions', async () => {
  mockAccountResult = {...account('not_created'), accountMode: 'unavailable', status: 'unavailable', unavailable: true,
    capabilities: {approve: false, open: false, createAccount: false, deposit: false, withdraw: false, marketOrders: false,
      limitOrders: false, cancelOrders: false, closePosition: false, reducePosition: false},
    legacyRecovery: {accountMode: null, status: 'unavailable', accountAddress: null, accountId: null,
      collateral: {balanceUnits: '0', lockedUnits: '0', tokenBalanceUnits: '0'}, positions: [], orders: [],
      capabilities: {withdraw: false, rescueTokens: false, marketOrders: false, limitOrders: false,
        cancelOrders: false, closePosition: false, reducePosition: false}}};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplManualAccountScreen />); await Promise.resolve(); await Promise.resolve(); });
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Review exact AUSD approval')).toHaveLength(0);
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Review account creation and initial deposit')).toHaveLength(0);
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Review legacy AUSD withdrawal')).toHaveLength(0);
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === 'Perpl could not verify the direct account state. Refresh before approving, opening, or managing collateral.')).toBe(true);
  await act(async () => renderer.unmount());
});
