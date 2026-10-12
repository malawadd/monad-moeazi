import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';

const mockNavigation = {goBack: jest.fn(), navigate: jest.fn()};
const mockReviewGuard = jest.fn();
const mockQuote = jest.fn();
let mockRoute: {params: Record<string, unknown>; path?: string} = {params: {}};
let mockFocused = true;
let mockPresentation: {presentationMode: 'user' | 'developer'; effectiveTheme: string} = {
  presentationMode: 'user', effectiveTheme: 'original',
};

jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigation, useRoute: () => mockRoute,
  useFocusEffect: () => {}, useIsFocused: () => mockFocused}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: null})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => mockPresentation}));
jest.mock('../src/services/useMarketQueries', () => ({useMonadWalletQuery: () => ({})}));
jest.mock('../src/navigation/usePreparedReviewGuard', () => ({usePreparedReviewGuard: (...args: unknown[]) => mockReviewGuard(...args)}));
jest.mock('../src/services/monadApi', () => ({createMonadIdempotencyKey: () => 'test-key', getMonadApprovalRequirement: () => null,
  monadApi: {quote: (...args: unknown[]) => mockQuote(...args)}}));

import {UnavailableDestinationScreen} from '../src/screens/UnavailableDestinationScreen';
import {TokenApprovalReviewScreen} from '../src/screens/TokenApprovalReviewScreen';
import {TradeReviewScreen} from '../src/screens/TradeReviewScreen';

function content(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType(Text).map(node => String(node.props.children)).join(' ');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockRoute = {params: {label: 'credits'}};
  mockPresentation = {presentationMode: 'user', effectiveTheme: 'blueprint'};
});

test('unsupported destination uses themed User primitives while Developer retains its original fallback', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UnavailableDestinationScreen />); });
  expect(content(renderer)).toContain('Credits is unavailable');
  expect(content(renderer)).toContain('Choose another feature from Home.');
  expect(content(renderer)).not.toContain('current shell');
  expect(content(renderer)).not.toContain('No transaction, setting, or account state was changed by opening this link.');
  const backHome = renderer.root.find(node => node.props.accessibilityLabel === 'Back to Home');
  expect(backHome).toBeDefined();
  await act(async () => backHome.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('Main', {screen: 'Home'});
  mockNavigation.navigate.mockClear();
  mockPresentation.presentationMode = 'developer';
  await act(async () => renderer.update(<UnavailableDestinationScreen />));
  expect(content(renderer)).toContain('No transaction, setting, or account state was changed by opening this link.');
  expect(content(renderer)).not.toContain('This link did not change your settings or start an action.');
  await act(async () => renderer.unmount());
});

test('missing approval is themed in User Mode and keeps the Developer fallback unchanged', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<TokenApprovalReviewScreen />); });
  expect(content(renderer)).toContain('Approval unavailable');
  expect(content(renderer)).toContain('Return to the swap and request a fresh quote.');
  mockPresentation.presentationMode = 'developer';
  await act(async () => renderer.update(<TokenApprovalReviewScreen />));
  expect(content(renderer)).toContain('Approval details unavailable');
  expect(content(renderer)).toContain('Return to the originating action and prepare a fresh quote.');
  await act(async () => renderer.unmount());
});

test('incomplete trade route has an actionable User fallback and unchanged Developer copy', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<TradeReviewScreen />); });
  expect(content(renderer)).toContain('Market route unavailable');
  expect(content(renderer)).toContain('Return to Markets and choose a route supplied by the service.');
  await act(async () => renderer.root.find(node => node.props.accessibilityLabel === 'Back to Markets').props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('Main', {screen: 'Markets'});
  mockNavigation.navigate.mockClear();
  mockPresentation.presentationMode = 'developer';
  await act(async () => renderer.update(<TradeReviewScreen />));
  expect(content(renderer)).toContain('Return to Markets and choose a route supplied by the Monad service.');
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Back to Markets')).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test('TradeReview passes navigation focus into its prepared quote guard', async () => {
  mockFocused = false;
  mockRoute = {params: {marketId: 'WMON_USDC', accountScope: 'wallet', venue: 'moeazi_test_amm',
    baseAsset: {id: 'WMON', symbol: 'WMON', address: `0x${'1'.repeat(40)}`, decimals: 18},
    quoteAsset: {id: 'USDC', symbol: 'USDC', address: `0x${'2'.repeat(40)}`, decimals: 6}}};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<TradeReviewScreen />); });
  expect(mockReviewGuard).toHaveBeenCalledWith(false, false);
  await act(async () => renderer.unmount());
});

test('returning from token approval restores the swap draft but asks for a new quote', async () => {
  mockRoute = {params: {marketId: 'WMON_USDC', accountScope: 'wallet', venue: 'moeazi_test_amm',
    baseAsset: {id: 'WMON', symbol: 'WMON', address: `0x${'1'.repeat(40)}`, decimals: 18},
    quoteAsset: {id: 'USDC', symbol: 'USDC', address: `0x${'2'.repeat(40)}`, decimals: 6},
    swapDraft: {side: 'sell', amount: '0.025', slippage: '75'}}};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<TradeReviewScreen />); });
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'sell WMON').props.accessibilityState.selected).toBe(true);
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Custom amount: 0.025').props).toBeDefined();
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Custom slippage: 75 bps').props).toBeDefined();
  expect(content(renderer)).toContain('Get verified quote');
  expect(content(renderer)).not.toContain('Check this swap');
  expect(mockQuote).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});
