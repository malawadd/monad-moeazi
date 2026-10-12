import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text, TextInput} from 'react-native';

const mockOwner = '0x1111111111111111111111111111111111111111';
const mockExchangeAddress = '0x3333333333333333333333333333333333333333';
const mockLegacyAccountAddress = '0x5555555555555555555555555555555555555555';
const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
const mockRoute: {params: Record<string, unknown>} = {params: {}};
let mockPresentationMode: 'user' | 'developer' = 'developer';
let mockSnapshotData: any = null;
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
let mockTradeAccount: any = mockAccount;

jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation, useRoute: () => mockRoute,
    useIsFocused: () => true,
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: mockPresentationMode, effectiveTheme: 'original'})}));
jest.mock('../src/services/useMarketQueries', () => ({
  useManualPerplAccountQuery: () => ({data: mockTradeAccount, isLoading: false, isFetching: false, error: null, refetch: async () => ({})}),
  useMarketSnapshotQuery: () => ({data: mockSnapshotData, isLoading: false, isError: false, refetch: async () => ({})}),
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
      ...(input.leverage !== undefined ? {leverage: input.leverage} : {}),
      sizeUnits: input.sizeUnits ?? (kind === 'close_position' ? '2500' : kind === 'amend_limit' ? '1500' : '0'),
      ...(input.limitPrice ? {limitPrice: input.limitPrice, priceDecimals: Number(mockSnapshotData?.market.priceDecimals ?? mockRoute.params.priceDecimals ?? 2)} : {}), orderId: input.orderId ?? null,
      orderDescription: {amountCNS: input.collateralAmountUnits ?? '0'}, transactionTarget: to, transactionData: '0x1234',
      transactionNonce: '3', transactionValue: '0', expiresAt,
      maxGas: {gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000', maxCostWei: '63000000000000'}}};
}

async function render(params: Record<string, unknown>) {
  mockRoute.params = params;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplTradeScreen />); await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
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

beforeEach(() => { mockPresentationMode = 'developer'; mockSnapshotData = null; mockTradeAccount = mockAccount; mockPrepareOrder.mockReset(); mockNavigation.navigate.mockClear(); mockPrepareOrder.mockImplementation(async input => makePrepared(input as Record<string, any>)); });

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

test('User mode close review uses the same exact prepare and validation path', async () => {
  mockPresentationMode = 'user';
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'close_position', sizeDecimals: 3});
  await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === 'Review full close')[0].props.onPress());
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'close_position', marketId: '7', side: 'short'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'close_position', side: 'short', sizeUnits: '2500'}),
    returnRoute: 'PerplTrade',
  }));
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Prepare exact Mera review')).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test('User mode amendment starts from the selected PNS price used in the exact review', async () => {
  mockPresentationMode = 'user';
  mockTradeAccount = {...mockAccount, positions: [], orders: [{orderId: '90', marketId: '7', symbol: 'ETH-PERP', side: 'short',
    sizeUnits: '1500', price: '9999', pricePNS: '123456', status: 'open'}]};
  mockSnapshotData = freshMarketSnapshot();
  mockSnapshotData.market.priceDecimals = 2;
  mockSnapshotData.market.sizeDecimals = 3;
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'amend_limit', orderId: '90', priceDecimals: 2, sizeDecimals: 3});
  expect(renderer.root.findAllByType(Text).some(node => node.props.children === '1234.56')).toBe(true);
  await press(renderer, 'Review price change');
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'amend_limit', orderId: '90', side: 'short', limitPrice: '1234.56'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'amend_limit', orderId: '90', side: 'short', limitPrice: '1234.56'}),
  }));
  await act(async () => renderer.unmount());
});

test('User limit price can be cleared and replaced without live-quote reseeding', async () => {
  mockPresentationMode = 'user';
  mockTradeAccount = {...mockAccount, positions: []};
  mockSnapshotData = freshMarketSnapshot();
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP'});
  await press(renderer, 'Limit');
  await press(renderer, 'Type a limit price: Advanced');
  const readPriceInput = () => renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Limit price · AUSD');
  expect(readPriceInput()?.props.value).toBe('12301');
  await setField(renderer, 'Limit price · AUSD', '');
  expect(readPriceInput()?.props.value).toBe('');
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Review long limit order')[0].props.disabled).toBe(true);
  await setField(renderer, 'Limit price · AUSD', '3000');
  expect(readPriceInput()?.props.value).toBe('3000');
  await press(renderer, 'Review long limit order');
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'limit_entry', limitPrice: '3000'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'limit_entry', limitPrice: '3000', priceDecimals: 4}),
  }));
  await act(async () => renderer.unmount());
});

test('Developer amendment keeps the entered limit price when refreshed order data changes', async () => {
  mockTradeAccount = {...mockAccount, positions: [], orders: [{orderId: '90', marketId: '7', symbol: 'ETH-PERP', side: 'short',
    sizeUnits: '1500', price: '9999', pricePNS: '123456', status: 'open'}]};
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'amend_limit', orderId: '90', priceDecimals: 2});
  await setField(renderer, 'New limit price', '77.12');
  mockTradeAccount = {...mockTradeAccount, orders: [{...mockTradeAccount.orders[0], pricePNS: '999900'}]};
  await act(async () => renderer.update(<PerplTradeScreen />));
  const input = renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'New limit price');
  expect(input?.props.value).toBe('77.12');
  await act(async () => renderer.unmount());
});

test('User margin amount presets send their exact base units to the existing prepare controller', async () => {
  mockPresentationMode = 'user';
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'add_margin'});
  await press(renderer, 'Max · 5 AUSD');
  await press(renderer, 'Review added margin');
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'add_margin', collateralAmountUnits: '5000000'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'add_margin', collateralAmountUnits: '5000000'}),
  }));
  await act(async () => renderer.unmount());
});

function freshMarketSnapshot() {
  const observedAt = Date.now();
  return {observedAt, market: {kind: 'perpl', venueId: 'perpl-direct-testnet-v1', marketId: '7', displayName: 'ETH Perpetual',
    symbol: 'ETH-PERP', name: 'ETH Perpetual', status: 'open', marketOpen: true, available: true, testOnly: true,
    priceDecimals: 4, sizeDecimals: 6, maxLeverage: 5, manualMaxLeverage: 3, initialMarginBps: 2_000,
    maintenanceMarginBps: 500, manualMaxOrderUnits: '1000000000', minPostingUnits: '1000000',
    makerFeeMicros: 1_000, takerFeeMicros: 2_000, manualMaxSlippageBps: 100, maxMarketSlippageBps: 100,
    quote: {bid: '123000000', ask: '123010000', observedAt}},
    book: {observedAt, bids: [{price: '123000000', size: '1000000000'}], asks: [{price: '123010000', size: '1000000000'}]}};
}

async function press(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  const target = renderer.root.findAll(node => node.props.accessibilityLabel === label)[0];
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
}

test('market entry prepares the fresh sized long order and validates the exact size', async () => {
  mockTradeAccount = {...mockAccount, positions: []};
  mockSnapshotData = freshMarketSnapshot();
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', priceDecimals: 4, sizeDecimals: 6});
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'market_entry', side: 'long', leverage: 1,
    marketId: '7', sizeUnits: expect.any(String)}));
  expect(BigInt(mockPrepareOrder.mock.calls[0][0].sizeUnits)).toBeGreaterThan(0n);
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'market_entry', side: 'long', sizeUnits: mockPrepareOrder.mock.calls[0][0].sizeUnits}),
  }));
  await act(async () => renderer.unmount());
});

test('limit entry preserves selected short side, fresh side quote and exact market precision', async () => {
  mockTradeAccount = {...mockAccount, positions: []};
  mockSnapshotData = freshMarketSnapshot();
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', priceDecimals: 4, sizeDecimals: 6});
  await press(renderer, 'SHORT');
  await press(renderer, 'limit order');
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'limit_entry', side: 'short', leverage: 1,
    limitPrice: '12300', sizeUnits: expect.any(String)}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'limit_entry', side: 'short', limitPrice: '12300'}),
  }));
  await act(async () => renderer.unmount());
});

test('partial reduction sends a positive amount smaller than the refreshed position', async () => {
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'reduce_size', sizeDecimals: 3});
  await setField(renderer, 'Size to reduce', '1.5');
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'reduce_size', side: 'short', sizeUnits: '1500'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'reduce_size', side: 'short', sizeUnits: '1500'}),
  }));
  await act(async () => renderer.unmount());
});

test('cancel binds the selected direct-wallet order ID without adding size fields', async () => {
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'cancel_limit', orderId: '90'});
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'cancel_limit', orderId: '90'}));
  expect(mockPrepareOrder.mock.calls[0][0]).not.toHaveProperty('sizeUnits');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'cancel_limit', orderId: '90'}),
  }));
  await act(async () => renderer.unmount());
});

test('legacy reduction stays limited to the delegated account and exact partial size', async () => {
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'reduce_size', accountMode: 'legacy_delegated', sizeDecimals: 3});
  await setField(renderer, 'Size to reduce', '1.5');
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'reduce_size', accountMode: 'legacy_delegated', side: 'short', sizeUnits: '1500'}));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'reduce_size', accountMode: 'legacy_delegated', accountAddress: mockLegacyAccountAddress,
      transactionTarget: mockLegacyAccountAddress, sizeUnits: '1500'}),
  }));
  await act(async () => renderer.unmount());
});

test('legacy cancellation uses the delegated order ID and cannot amend', async () => {
  const renderer = await render({marketId: '7', symbol: 'ETH-PERP', action: 'cancel_limit', accountMode: 'legacy_delegated', orderId: '91'});
  await prepare(renderer);
  expect(mockPrepareOrder).toHaveBeenCalledWith(expect.objectContaining({kind: 'cancel_limit', accountMode: 'legacy_delegated', orderId: '91'}));
  expect(mockPrepareOrder.mock.calls[0][0]).not.toHaveProperty('limitPrice');
  expect(mockNavigation.navigate).toHaveBeenCalledWith('ManualPerplReview', expect.objectContaining({
    expected: expect.objectContaining({action: 'cancel_limit', accountMode: 'legacy_delegated', accountAddress: mockLegacyAccountAddress,
      transactionTarget: mockLegacyAccountAddress, orderId: '91'}),
  }));
  await act(async () => renderer.unmount());
});
