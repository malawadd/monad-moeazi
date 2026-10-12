import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {TextInput} from 'react-native';
import {UserSpotTradeReviewView} from '../src/screens/UserSpotTradeReviewView';
import {userThemeTokens} from '../src/theme/userThemes';

const baseAsset = {id: 'WMON', symbol: 'WMON', address: '0x1111111111111111111111111111111111111111', decimals: 18};
const quoteAsset = {id: 'USDC', symbol: 'USDC', address: '0x2222222222222222222222222222222222222222', decimals: 6};
const baseProps: React.ComponentProps<typeof UserSpotTradeReviewView> = {theme: userThemeTokens('original'), marketId: 'WMON_USDC',
  accountScope: 'wallet', baseAsset, quoteAsset, venue: 'uniswap_v4_testnet', venueLabel: 'Uniswap v4 Testnet', side: 'buy',
  amount: '', inputBalance: {amountUnits: '1000000', decimals: 6}, slippage: '50', quote: null, quoteReady: false,
  needsUnverifiedWarning: false, unverifiedAcknowledged: false, approvalCheckQuote: false, feeLabel: null, loading: false, error: '',
  onBack: jest.fn(), onSideChange: jest.fn(), onAmountChange: jest.fn(), onSlippageChange: jest.fn(), onGetQuote: jest.fn(),
  onAcknowledge: jest.fn(), onPrepare: jest.fn()};

function find(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.find(node => node.props.accessibilityLabel === label);
}

test('wallet token amount presets use exact matching balance units and slippage presets map to basis points', async () => {
  const onAmountChange = jest.fn(); const onSlippageChange = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserSpotTradeReviewView {...baseProps}
    onAmountChange={onAmountChange} onSlippageChange={onSlippageChange} />); });
  await act(async () => find(renderer, '25 percent · 0.25 USDC').props.onPress());
  expect(onAmountChange).toHaveBeenCalledWith('0.25');
  await act(async () => find(renderer, '50 percent · 0.5 USDC').props.onPress());
  expect(onAmountChange).toHaveBeenLastCalledWith('0.5');
  await act(async () => find(renderer, '0.1% slippage').props.onPress());
  expect(onSlippageChange).toHaveBeenCalledWith('10');
  await act(async () => find(renderer, '0.5% slippage').props.onPress());
  expect(onSlippageChange).toHaveBeenLastCalledWith('50');
  await act(async () => find(renderer, '1% slippage').props.onPress());
  expect(onSlippageChange).toHaveBeenLastCalledWith('100');
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test('custom amount and custom 1-to-500-bps entry stay secondary', async () => {
  const onAmountChange = jest.fn(); const onSlippageChange = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserSpotTradeReviewView {...baseProps}
    onAmountChange={onAmountChange} onSlippageChange={onSlippageChange} />); });
  await act(async () => find(renderer, 'Custom amount: Enter USDC').props.onPress());
  const amountInput = renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Amount in USDC');
  expect(amountInput).toBeDefined();
  await act(async () => find(renderer, 'Custom slippage: 50 bps').props.onPress());
  const slippageInput = renderer.root.findAllByType(TextInput).find(node => node.props.accessibilityLabel === 'Maximum slippage (basis points)');
  expect(slippageInput).toBeDefined();
  await act(async () => renderer.unmount());
});

test('stale or missing wallet balance never fabricates amount percentage choices', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserSpotTradeReviewView {...baseProps} inputBalance={undefined} />); });
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === '25 percent · 0.25 USDC')).toHaveLength(0);
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  await act(async () => renderer.unmount());
});
