import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {TextInput} from 'react-native';

const mockOwner = '0x1111111111111111111111111111111111111111';
const mockExchangeAddress = '0x3333333333333333333333333333333333333333';
const mockLegacyAccountAddress = '0x5555555555555555555555555555555555555555';
const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
const mockRoute: {params: Record<string, unknown>} = {params: {}};
const mockPrepareOrder = jest.fn();
const mockAccount = {chainId: 10143, ownerAddress: mockOwner, exchangeAddress: mockExchangeAddress, accountMode: 'direct_wallet',
  accountAddress: mockOwner, accountId: 71, status: 'open',
  collateral: {symbol: 'AUSD', address: '0x4444444444444444444444444444444444444444', decimals: 6,
    balanceUnits: '5000000', lockedUnits: '0', walletBalanceUnits: '2500000', allowanceUnits: '2500000'},
  positions: [{marketId: '7', symbol: 'ETH-PERP', side: 'short', sizeUnits: '2500', entryPrice: '12345', markPrice: '12300', leverage: 2, unrealizedPnlUnits: '500'}],
  orders: [{orderId: '90', marketId: '7', symbol: 'ETH-PERP', side: 'short', sizeUnits: '1500', price: '12300', status: 'open'}],
  observedAt: Date.now(), blockNumber: 10, capabilities: {approve: true, open: false, createAccount: false, deposit: true, withdraw: true,
    marketOrders: true, limitOrders: true, cancelOrders: true, closePosition: true, reducePosition: true},
  legacyRecovery: {accountMode: 'legacy_delegated', status: 'open', accountAddress: mockLegacyAccountAddress, accountId: 18,
    collateral: {balanceUnits: '3000000', lockedUnits: '1000000', tokenBalanceUnits: '0'},
    positions: [{marketId: '7', symbol: 'ETH-PERP', side: 'short', sizeUnits: '2500', entryPrice: '12345', markPrice: '12300', leverage: 2, unrealizedPnlUnits: '500'}],
    orders: [{orderId: '91', marketId: '7', symbol: 'ETH-PERP', side: 'short', sizeUnits: '1500', price: '12300', status: 'open'}],
    capabilities: {withdraw: true, rescueTokens: false, marketOrders: false, limitOrders: true, cancelOrders: true, closePosition: true, reducePosition: true}}};

jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation, useRoute: () => mockRoute,
    useIsFocused: () => true,
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/services/useMarketQueries', () => ({
  useManualPerplAccountQuery: () => ({data: mockAccount, isLoading: false, isFetching: false, error: null, refetch: async () => ({})}),
}));
jest.mock('../src/services/manualPerplApi', () => ({manualPerplApi: {
  account: async () => mockAccount,
  prepareOrder: (input: unknown) => mockPrepareOrder(input),
}, createManualPerplIdempotencyKey: () => 'manual-perpl-test-key'}));
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.View, null, children);
  const Label = ({title, label, value, copy, children}: {title?: string; label?: string; value?: string; copy?: string; children?: React.ReactNode}) =>
    ReactRuntime.createElement(Native.Text, null, title ?? label ?? value ?? copy ?? children);
  const Button = ({label, onPress, disabled}: {label: string; onPress: () => void; disabled?: boolean}) =>
    ReactRuntime.createElement(Native.Pressable, {accessibilityRole: 'button', accessibilityLabel: label, onPress, disabled}, ReactRuntime.createElement(Native.Text, null, label));
  const Field = ({label, ...props}: {label: string} & Record<string, unknown>) =>
    ReactRuntime.createElement(Native.TextInput, {accessibilityLabel: label, ...props});
  return {Button, Card: Container, DataRow: Label, Field, Notice: Label, PageHeader: Label, Screen: Container, StatusBadge: Label};
});

import {PerplTradeScreen} from '../src/screens/PerplTradeScreen';

function makePrepared(input: Record<string, any>) {
  const expiresAt = Date.now() + 60_000;
  const legacy = input.accountMode === 'legacy_delegated';
  const to = legacy ? mockLegacyAccountAddress : mockExchangeAddress;
  const kind = String(input.kind);
  return {operationId: `op-${kind}`, venueId: 'perpl-direct-testnet-v1', chainId: 10143, status: 'prepared', action: kind,
    expiresAt, transaction: {chainId: 10143, type: 'eip1559', to, data: '0x1234', value: '0', nonce: '3',
      gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'},
    review: {action: kind, kind, ownerAddress: mockOwner, chainId: 10143, venueId: 'perpl-direct-testnet-v1',
      accountMode: legacy ? 'legacy_delegated' : 'direct_wallet', accountAddress: legacy ? mockLegacyAccountAddress : mockOwner,
      marketId: input.marketId, ...(input.side ? {side: input.side} : {}),
      sizeUnits: input.sizeUnits ?? (kind === 'close_position' ? '2500' : kind === 'amend_limit' ? '1500' : '0'),
      ...(input.limitPrice ? {limitPrice: input.limitPrice} : {}), orderId: input.orderId ?? null,
      orderDescription: {amountCNS: input.collateralAmountUnits ?? '0'}, transactionTarget: to, transactionData: '0x1234',
      transactionNonce: '3', transactionValue: '0', expiresAt,
      maxGas: {gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000', maxCostWei: '63000000000000'}}};
}

async function render(params: Record<string, unknown>) {
  mockRoute.params = params;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplTradeScreen />); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return renderer;
}
async function setField(renderer: ReactTestRenderer.ReactTestRenderer, label: string, value: string) {
  const input = renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === label);
  expect(input).toBeDefined();
  await act(async () => input!.props.onChangeText(value));
}
async function prepare(renderer: ReactTestRenderer.ReactTestRenderer) {
  const button = renderer.root.findAll(node => String(node.props.accessibilityLabel ?? '').startsWith('Prepare exact'))[0];
  expect(button).toBeDefined();
  await act(async () => button!.props.onPress());
}

beforeEach(() => { mockPrepareOrder.mockReset(); mockNavigation.navigate.mockClear(); mockPrepareOrder.mockImplementation(async input => makePrepared(input as Record<string, any>)); });

test('close uses the verified position direction and reviews the full size', async () => {
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'close_position', side: 'long'});
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'close_position', marketId: '7', side: 'short'}));
  expect(mockPrepareOrder.mock.calls[0][0]).not.toHaveProperty('sizeUnits');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'close_position', side: 'short', sizeUnits: '2500'}),
  }));
  await act(async () => renderer.unmount());
});

test('limit amendment sends a human price at market precision and keeps its open order terms', async () => {
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'amend_limit', orderId: '90', priceDecimals: 2, side: 'long'});
  await setField(renderer, 'New limit price', '123.45');
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'amend_limit', orderId: '90', side: 'short', limitPrice: '123.45'}));
  expect(mockPrepareOrder.mock.calls[0][0]).not.toHaveProperty('sizeUnits');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'amend_limit', orderId: '90', side: 'short', limitPrice: '123.45', sizeUnits: '1500'}),
  }));
  await act(async () => renderer.unmount());
});

test('add margin sends and reviews exact collateral base units', async () => {
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'add_margin'});
  await setField(renderer, 'AUSD margin to add', '2.5');
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'add_margin', collateralAmountUnits: '2500000'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'add_margin', collateralAmountUnits: '2500000'}),
  }));
  await act(async () => renderer.unmount());
});

test('legacy close action stays bound to the saved delegated account recovery path', async () => {
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'close_position', accountMode: 'legacy_delegated'});
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'close_position', accountMode: 'legacy_delegated', side: 'short'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'close_position', accountMode: 'legacy_delegated',
      accountAddress: mockLegacyAccountAddress, transactionTarget: mockLegacyAccountAddress}),
  }));
  await act(async () => renderer.unmount());
});
