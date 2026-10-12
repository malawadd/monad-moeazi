import React from 'react';
import {AppState, Linking} from 'react-native';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
const mockPrepareAusdClaim = jest.fn();
const mockClipboardSetString = jest.fn();
let mockOwner: string | null;
let mockRouteParams: Record<string, unknown>;
let mockWalletQuery: any;
let mockCurrentQuery: any;
let mockVenueQuery: any;
let mockAppStateListener: ((state: string) => void) | null;

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => ({params: mockRouteParams}),
  useIsFocused: () => true,
  useFocusEffect: () => undefined,
}));
jest.mock('@tanstack/react-query', () => ({useQuery: () => mockVenueQuery}));
jest.mock('../src/services/useMarketQueries', () => ({
  useMonadWalletQuery: () => mockWalletQuery,
  usePerplCurrentQuery: () => mockCurrentQuery,
}));
jest.mock('../src/services/perplApi', () => ({perplApi: {venues: jest.fn()}}));
jest.mock('../src/services/perplValidation', () => ({findPerplVenue: (venues: unknown[]) => venues[0]}));
jest.mock('@react-native-clipboard/clipboard', () => ({__esModule: true, default: {setString: (...args: unknown[]) => mockClipboardSetString(...args)}}));
jest.mock('../src/services/userAusdFunding', () => ({prepareUserAusdClaim: (...args: unknown[]) => mockPrepareAusdClaim(...args)}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({effectiveTheme: 'original'})}));
jest.mock('../src/services/haptics', () => ({haptics: {confirm: jest.fn(), reject: jest.fn(), selection: jest.fn()}}));
jest.mock('../src/components/user/UserPrimitives', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.View, null, children);
  const Button = ({label, onPress, disabled = false, loading = false}: {label: string; onPress: () => void; disabled?: boolean; loading?: boolean}) =>
    ReactRuntime.createElement(Native.Pressable, {accessibilityRole: 'button', accessibilityLabel: label,
      accessibilityState: {disabled: disabled || loading, busy: loading}, disabled: disabled || loading, onPress},
    ReactRuntime.createElement(Native.Text, null, label));
  const Disclosure = ({label, value, expanded, onPress, children}: {label: string; value: string; expanded: boolean; onPress: () => void; children?: React.ReactNode}) =>
    ReactRuntime.createElement(Native.View, null,
      ReactRuntime.createElement(Native.Pressable, {accessibilityRole: 'button', accessibilityLabel: `${label}: ${value}`, onPress},
        ReactRuntime.createElement(Native.Text, null, `${label}: ${value}`)),
      expanded ? ReactRuntime.createElement(Native.View, null, children) : null);
  const UserText = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.Text, null, children);
  const ValueRow = ({label, value}: {label: string; value: string}) => ReactRuntime.createElement(Native.Text, null, `${label}: ${value}`);
  return {UserPage: Container, UserCard: Container, UserText, UserButton: Button, UserDisclosure: Disclosure, UserValueRow: ValueRow};
});

import {UserFundingScreen} from '../src/screens/UserFundingScreen';

const OWNER_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const AUSD_MIN = '100000000';
const venue = {venueId: 'perpl-direct-testnet-v1', displayName: 'Perpl Direct Testnet', chainId: 10143,
  executionModel: 'direct', enabled: true, collateral: {symbol: 'AUSD', address: '0xcccccccccccccccccccccccccccccccccccccccc', decimals: 6},
  limits: {minFundingUnits: AUSD_MIN, minDurationSeconds: 600, maxDurationSeconds: 43200}};

function wallet(owner: string, monUnits: string, ausdUnits: string) {
  return {ownerAddress: owner, chainId: 10143, observedBlock: 100, observedAt: new Date().toISOString(), stale: false,
    balances: [
      {asset: 'MON', tokenAddress: null, amountUnits: monUnits, decimals: 18},
      {asset: 'AUSD', tokenAddress: '0xcccccccccccccccccccccccccccccccccccccccc', amountUnits: ausdUnits, decimals: 6},
    ]};
}
function button(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.find(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label);
}
function press(node: ReactTestRenderer.ReactTestInstance) {
  if (node.props.disabled) return;
  return node.props.onPress?.();
}
function text(renderer: ReactTestRenderer.ReactTestRenderer) {
  return JSON.stringify(renderer.toJSON());
}
async function flushPromises() { for (let index = 0; index < 10; index += 1) await Promise.resolve(); }

beforeEach(() => {
  jest.clearAllMocks();
  mockOwner = OWNER_A; mockRouteParams = {};
  mockAppStateListener = null;
  mockWalletQuery = {data: wallet(OWNER_A, '0', '0'), isFetching: false, isError: false,
    refetch: jest.fn(async () => ({data: mockWalletQuery.data}))};
  mockCurrentQuery = {data: {current: null}, isFetching: false, isError: false, refetch: jest.fn()};
  mockVenueQuery = {data: venue, isFetching: false, isError: false, refetch: jest.fn()};
  mockPrepareAusdClaim.mockResolvedValue({prepared: {operationId: 'op-ausd'}, expected: {ownerAddress: OWNER_A, asset: 'AUSD'}});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    mockAppStateListener = listener as unknown as (state: string) => void;
    return {remove: jest.fn()};
  });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

test('first-use progresses MON to AUSD to Perpl from the live owner balances', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserFundingScreen />); });
  expect(text(renderer)).toContain('Get started');
  expect(text(renderer)).toContain('Funding steps. Get MON is next.');
  expect(text(renderer)).toContain('STEP 1 OF 3');
  expect(button(renderer, 'Open Monad MON faucet')).toBeTruthy();
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Request test AUSD')).toHaveLength(0);

  mockWalletQuery = {...mockWalletQuery, data: wallet(OWNER_A, '1000000000000000000', '0')};
  await act(async () => renderer.update(<UserFundingScreen />));
  expect(text(renderer)).toContain('Funding steps. Get AUSD is next.');
  expect(text(renderer)).toContain('STEP 2 OF 3');
  expect(button(renderer, 'Request test AUSD').props.disabled).toBe(false);
  const controls = renderer.root.findAll(node => node.props.accessibilityRole === 'button');
  const actionIndex = controls.findIndex(node => node.props.accessibilityLabel === 'Request test AUSD');
  const balanceDetailsIndex = controls.findIndex(node => node.props.accessibilityLabel === 'Test token balances: Details');
  expect(actionIndex).toBeGreaterThanOrEqual(0);
  expect(actionIndex).toBeLessThan(balanceDetailsIndex);

  mockWalletQuery = {...mockWalletQuery, data: wallet(OWNER_A, '1000000000000000000', AUSD_MIN)};
  await act(async () => renderer.update(<UserFundingScreen />));
  expect(text(renderer)).toContain('Funding steps. Perpl setup is next.');
  await act(async () => press(button(renderer, 'Continue to Perpl setup')));
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplSetup');
  await act(async () => renderer.unmount());
});

test('requesting AUSD opens the existing exact Mera review route', async () => {
  mockWalletQuery = {...mockWalletQuery, data: wallet(OWNER_A, '1000000000000000000', '0')};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserFundingScreen />); });
  await act(async () => { press(button(renderer, 'Request test AUSD')); await flushPromises(); });
  expect(mockPrepareAusdClaim).toHaveBeenCalledWith(OWNER_A);
  expect(mockNavigation.navigate).toHaveBeenCalledWith('OperationReview', {
    prepared: {operationId: 'op-ausd'}, expected: {ownerAddress: OWNER_A, asset: 'AUSD'}, asset: 'AUSD',
  });
  await act(async () => renderer.unmount());
});

test('repeat entry defaults to AUSD and lets the user select MON', async () => {
  mockRouteParams = {repeat: true};
  mockWalletQuery = {...mockWalletQuery, data: wallet(OWNER_A, '1000000000000000000', AUSD_MIN)};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserFundingScreen />); });
  expect(text(renderer)).toContain('Test tokens');
  expect(text(renderer)).toContain('TEST AUSD');
  expect(text(renderer)).not.toContain('Funding steps.');
  expect(text(renderer)).not.toContain('STEP 2 OF 3');
  const radios = renderer.root.findAll(node => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function');
  expect(radios).toHaveLength(2);
  expect(radios[0].props.accessibilityState).toMatchObject({checked: false});
  expect(radios[1].props.accessibilityState).toMatchObject({checked: true});
  expect(button(renderer, 'Request test AUSD').props.disabled).toBe(false);
  await act(async () => radios[0].props.onPress());
  expect(text(renderer)).toContain('TEST MON');
  expect(text(renderer)).not.toContain('Funding steps.');
  expect(button(renderer, 'Open Monad MON faucet')).toBeTruthy();
  expect(button(renderer, 'Check MON balance')).toBeTruthy();
  await act(async () => renderer.unmount());
});

test('faucet return and repeated MON checks refresh balance without inventing an arrival', async () => {
  mockWalletQuery = {...mockWalletQuery, data: wallet(OWNER_A, '0', '0')};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserFundingScreen />); });
  await act(async () => { press(button(renderer, 'Open Monad MON faucet')); await flushPromises(); });
  expect(Linking.openURL).toHaveBeenCalledWith('https://faucet.monad.xyz/');
  expect(text(renderer)).toContain('Get test MON, then return here and check your balance.');

  await act(async () => { mockAppStateListener?.('active'); await flushPromises(); });
  expect(mockWalletQuery.refetch).toHaveBeenCalledTimes(1);
  expect(text(renderer)).toContain('No new MON balance detected yet. Check again after the faucet confirms.');
  expect(text(renderer)).not.toContain('A higher MON balance is visible');
  await act(async () => { press(button(renderer, 'Check MON balance')); await flushPromises(); });
  await act(async () => { press(button(renderer, 'Check MON balance')); await flushPromises(); });
  expect(mockWalletQuery.refetch).toHaveBeenCalledTimes(3);
  expect(text(renderer)).toContain('No new MON balance detected yet. Check again after the faucet confirms.');
  await act(async () => renderer.unmount());
});

test('a prepared AUSD result is discarded after the signed-in owner changes', async () => {
  mockWalletQuery = {...mockWalletQuery, data: wallet(OWNER_A, '1000000000000000000', '0')};
  let finishPrepare!: (value: {prepared: {operationId: string}; expected: {ownerAddress: string; asset: string}}) => void;
  mockPrepareAusdClaim.mockReturnValue(new Promise(resolve => { finishPrepare = resolve; }));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserFundingScreen />); });
  await act(async () => { press(button(renderer, 'Request test AUSD')); await flushPromises(); });
  expect(mockPrepareAusdClaim).toHaveBeenCalledTimes(1);
  mockOwner = OWNER_B;
  await act(async () => renderer.update(<UserFundingScreen />));
  await act(async () => { finishPrepare({prepared: {operationId: 'late-op'}, expected: {ownerAddress: OWNER_A, asset: 'AUSD'}}); await flushPromises(); });
  expect(mockNavigation.navigate).not.toHaveBeenCalledWith('OperationReview', expect.anything());
  await act(async () => renderer.unmount());
});
