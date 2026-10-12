import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';

const mockOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const mockRecipient = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
let mockParams: any;
const mockSignSubmit = jest.fn();
const mockSubmit = jest.fn();
const mockBroadcast = jest.fn();
const mockOperation = jest.fn();
const mockPrepare = jest.fn();

jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigation, useRoute: () => ({params: mockParams})}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: 'user', effectiveTheme: 'original'})}));
jest.mock('../src/services/meraSubmission', () => ({signAndSubmitWithMera: (...args: unknown[]) => mockSignSubmit(...args)}));
jest.mock('../src/services/monadApi', () => ({monadApi: {
  submit: (...args: unknown[]) => mockSubmit(...args), broadcast: (...args: unknown[]) => mockBroadcast(...args),
  operation: (...args: unknown[]) => mockOperation(...args), prepare: (...args: unknown[]) => mockPrepare(...args),
}}));

import {OperationReviewScreen} from '../src/screens/OperationReviewScreen';

function prepared(expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  return {operationId: 'original-operation-77', ownerAddress: mockOwner, chainId: 10143, kind: 'send_mon', expiresAt,
    transactionType: 'eip1559', transaction: {chainId: 10143, type: 2, to: mockRecipient, data: '0x', value: '1000000000000000',
      nonce: '3', gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'},
    review: {kind: 'send_mon', ownerAddress: mockOwner, amount: '0.001', amountUnits: '1000000000000000', asset: 'MON', recipient: mockRecipient}};
}
const expected = {ownerAddress: mockOwner, kind: 'send_mon', amount: '0.001', asset: 'MON', recipient: mockRecipient};
function press(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.find(node => node.props.accessibilityLabel === label);
}
function body(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType(Text).map(node => String(node.props.children)).join(' ');
}
async function flush() { for (let index = 0; index < 10; index += 1) await Promise.resolve(); }

beforeEach(() => {
  mockNavigation.navigate.mockClear(); mockNavigation.goBack.mockClear(); mockPrepare.mockReset(); mockSubmit.mockReset(); mockBroadcast.mockReset();
  mockOperation.mockReset().mockResolvedValue({operationId: 'original-operation-77', status: 'prepared'});
  mockSignSubmit.mockReset(); mockParams = {prepared: prepared(), expected};
});

test('cancelling Mera submits nothing and leaves the same original operation retryable', async () => {
  mockSignSubmit.mockRejectedValueOnce(new Error('User cancelled the passkey prompt'))
    .mockImplementationOnce(async (request: any) => {
      await request.sign({address: mockOwner, signEip1559Transaction: jest.fn().mockResolvedValue('0x02abcd')});
      request.onSubmissionStarting?.();
      return request.submit('0x02abcd');
    });
  mockSubmit.mockResolvedValue({operationId: 'original-operation-77', status: 'submitted'});
  mockBroadcast.mockResolvedValue({operationId: 'original-operation-77', status: 'submitted'});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<OperationReviewScreen />); });
  await act(async () => { press(renderer, 'Send MON with Mera').props.onPress(); await flush(); });
  expect(body(renderer)).toContain('User cancelled the passkey prompt');
  expect(mockSubmit).not.toHaveBeenCalled(); expect(mockBroadcast).not.toHaveBeenCalled(); expect(mockPrepare).not.toHaveBeenCalled();
  expect(press(renderer, 'Send MON with Mera').props.disabled).toBe(false);
  await act(async () => { press(renderer, 'Send MON with Mera').props.onPress(); await flush(); });
  expect(mockSubmit).toHaveBeenCalledWith('original-operation-77', '0x02abcd');
  expect(mockBroadcast).toHaveBeenCalledWith('original-operation-77');
  expect(mockPrepare).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

test('expired prepared review never opens Mera or submits a transaction', async () => {
  mockParams = {prepared: prepared(new Date(Date.now() - 1000).toISOString()), expected};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<OperationReviewScreen />); });
  await act(async () => { press(renderer, 'Send MON with Mera').props.onPress(); await flush(); });
  expect(body(renderer)).toContain('prepared request is missing or expired');
  expect(mockSignSubmit).not.toHaveBeenCalled(); expect(mockSubmit).not.toHaveBeenCalled();
  expect(mockBroadcast).not.toHaveBeenCalled(); expect(mockPrepare).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

test('wallet swap without authoritative precision cannot be signed', async () => {
  const walletSwap = prepared();
  walletSwap.kind = 'wallet_swap';
  (walletSwap as any).review = {kind: 'wallet_swap', ownerAddress: mockOwner, amountInUnits: '1000000', minAmountOutUnits: '500000'};
  mockParams = {prepared: walletSwap, expected: {...expected, kind: 'wallet_swap'}};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<OperationReviewScreen />); });
  expect(body(renderer)).toContain('Unavailable · request a fresh swap review');
  expect(press(renderer, 'Review swap with Mera').props.disabled).toBe(true);
  expect(mockSignSubmit).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

test('token approval review exposes the spender before Mera can sign', async () => {
  const approval = prepared();
  approval.kind = 'approve_token';
  (approval as any).review = {kind: 'approve_token', ownerAddress: mockOwner, amountUnits: '1000000', tokenAddress: mockRecipient, spender: '0xcccccccccccccccccccccccccccccccccccccccc'};
  mockParams = {prepared: approval, expected: {ownerAddress: mockOwner, kind: 'approve_token', tokenAddress: mockRecipient,
    spender: '0xcccccccccccccccccccccccccccccccccccccccc', amountUnits: '1000000'}, approvalDecimals: 6, approvalSymbol: 'USDC'};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<OperationReviewScreen />); });
  expect(body(renderer)).toContain('Spender permission');
  expect(body(renderer)).not.toContain('0xcccccccccccccccccccccccccccccccccccccccc');
  expect(body(renderer)).not.toContain(mockRecipient);
  expect(press(renderer, 'Approve exact amount with Mera').props.disabled).toBe(false);
  await act(async () => { press(renderer, 'Operation details: Network and original ID').props.onPress(); });
  expect(body(renderer)).toContain('Approval spender address');
  expect(body(renderer)).toContain('Approval token address');
  expect(body(renderer)).toContain('0xcccccccccccccccccccccccccccccccccccccccc');
  expect(body(renderer)).toContain(mockRecipient);
  await act(async () => renderer.unmount());
});

test('swap review shows human venue and exact trade terms before hiding contract identifiers in details', async () => {
  const swap = prepared();
  const input = `0x${'1'.repeat(40)}`, output = `0x${'2'.repeat(40)}`;
  swap.kind = 'wallet_swap';
  (swap as any).review = {kind: 'wallet_swap', ownerAddress: mockOwner, amountInUnits: '1000000',
    minAmountOutUnits: '500000000000000000', inputDecimals: 6, outputDecimals: 18,
    tokenIn: input, tokenOut: output, venue: 'uniswap_v4_testnet'};
  mockParams = {prepared: swap, expected: {ownerAddress: mockOwner, kind: 'wallet_swap', amountInUnits: '1000000',
    minAmountOutUnits: '500000000000000000', inputDecimals: 6, outputDecimals: 18, tokenIn: input, tokenOut: output,
    venue: 'uniswap_v4_testnet'}, inputSymbol: 'USDC', outputSymbol: 'WMON'};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<OperationReviewScreen />); });
  expect(body(renderer)).toContain('1 USDC');
  expect(body(renderer)).toContain('0.5 WMON');
  expect(body(renderer)).toContain('Uniswap v4 · Testnet');
  expect(body(renderer)).not.toContain('uniswap_v4_testnet');
  expect(body(renderer)).not.toContain(input);
  expect(body(renderer)).not.toContain(output);
  await act(async () => { press(renderer, 'Operation details: Network and original ID').props.onPress(); });
  expect(body(renderer)).toContain('Venue identifier');
  expect(body(renderer)).toContain('Input token address');
  expect(body(renderer)).toContain('Output token address');
  expect(body(renderer)).toContain('uniswap_v4_testnet');
  expect(body(renderer)).toContain(input);
  expect(body(renderer)).toContain(output);
  await act(async () => renderer.unmount());
});
