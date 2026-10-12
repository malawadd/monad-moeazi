import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
let mockOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let mockMode = 'user';
let mockRouteParams: any = {strategyId: 'perpl-deterministic'};
let mockCurrentRun: any = null;
const mockStrategies = jest.fn();
const mockCurrent = jest.fn();

jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation, useRoute: () => ({params: mockRouteParams}),
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/services/monadApi', () => ({monadApi: {strategies: (...args: unknown[]) => mockStrategies(...args)}}));
jest.mock('../src/services/perplApi', () => ({perplApi: {current: (...args: unknown[]) => mockCurrent(...args)}}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: mockMode, effectiveTheme: 'candy-riot'})}));

import {UserStrategiesScreen} from '../src/screens/UserStrategiesScreen';
import {UserStrategyDetailScreen} from '../src/screens/UserStrategyDetailScreen';
import {StrategiesScreen} from '../src/screens/StrategiesScreen';

const catalog = {catalogVersion: 'strategy-catalog-v1', metrics: {strategyId: 'perpl-deterministic', currency: 'AUSD', decimals: 6,
  netRealizedPnlUnits: '-12000', verifiedCycleCount: 2, uniqueActivatedWalletCount: 1, observedAt: 1_800_000_000_000}, strategies: [
  {strategyId: 'perpl-deterministic', version: 'perpl-deterministic-v3-soak', creator: 'Moeazi Team', name: 'Perpl deterministic',
    kind: 'deterministic', status: 'available', description: 'Fixed-rule Perpl Testnet strategy.',
    enrollmentDestination: {type: 'mobile_route', route: 'PerplSetup', venueId: 'perpl-direct-testnet-v1'},
    fee: {model: 'performance', rateBps: 0, appliesTo: 'positive_net_realized_profit', currency: 'AUSD', description: '0% Moeazi performance fee.'},
    venueFees: {venue: 'Perpl', description: 'Venue fees are separate.'}},
  {strategyId: 'moeazi-agentic', version: 'planned-v1', creator: 'Moeazi Team', name: 'Agentic strategy',
    kind: 'agentic', status: 'planned_unavailable', description: 'Concept only; unavailable.', enrollmentDestination: null,
    fee: {model: 'performance', rateBps: 200, appliesTo: 'positive_net_realized_profit', currency: 'AUSD', description: 'Planned 2% fee; not charged now.'},
    venueFees: null},
]};

async function flushPromises() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
function content(renderer: ReactTestRenderer.ReactTestRenderer) {
  const parts: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string' || typeof value === 'number') parts.push(String(value));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object' && 'children' in value) collect((value as {children?: unknown}).children);
  };
  collect(renderer.toJSON());
  return parts.join(' ');
}
function button(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.find(node => node.props.accessibilityLabel === label);
}
function activeRun(ownerAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
  return {runId: 'run-1', venueId: 'perpl-direct-testnet-v1', chainId: 10143, ownerAddress,
    vaultAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', status: 'active'};
}

beforeEach(() => {
  mockNavigation.navigate.mockClear(); mockOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; mockMode = 'user';
  mockRouteParams = {strategyId: 'perpl-deterministic'}; mockCurrentRun = null;
  mockStrategies.mockReset().mockResolvedValue(catalog); mockCurrent.mockReset().mockImplementation(async () => ({current: mockCurrentRun}));
});

test('User Strategies branch shows required Perpl, service metrics, and no invented catalog entries', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<StrategiesScreen />); await flushPromises(); });
  const perpl = button(renderer, 'View Perpl details');
  expect(content(renderer)).toContain('Review Testnet strategies and current availability.');
  expect(content(renderer)).not.toContain('Fixed-rule Perpl Testnet strategy.');
  expect(content(renderer)).toContain('Included · required');
  expect(content(renderer)).toContain('−0.012 AUSD');
  expect(content(renderer)).toContain('ACTIVATED WALLETS');
  expect(content(renderer)).not.toContain('VERIFIED NET REALIZED PNL');
  expect(content(renderer).indexOf('View Perpl details')).toBeLessThan(content(renderer).indexOf('Agentic strategy'));
  await act(async () => button(renderer, 'Result details: Show').props.onPress());
  expect(content(renderer)).toContain('Verified completed cycles');
  expect(content(renderer)).toContain('Activated wallet addresses');
  expect(content(renderer)).toContain('Activated wallets counts addresses, not people.');
  expect(content(renderer)).not.toContain('Lifetime');
  expect(content(renderer)).not.toContain('Community');
  await act(async () => perpl.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('StrategyDetail', {strategyId: 'perpl-deterministic'});
  await act(async () => renderer.unmount());
});

test('missing or malformed aggregate metrics remain unavailable rather than zero', async () => {
  mockStrategies.mockResolvedValue({...catalog, metrics: null});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategiesScreen />); await flushPromises(); });
  expect(content(renderer)).toContain('VERIFIED RESULT TOTALS · NOT AVAILABLE');
  expect(content(renderer)).not.toContain('0 AUSD');
  await act(async () => renderer.unmount());
  mockStrategies.mockResolvedValue({...catalog, metrics: {...catalog.metrics, uniqueActivatedWalletCount: -1}});
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategiesScreen />); await flushPromises(); });
  expect(content(renderer)).toContain('VERIFIED RESULT TOTALS · NOT AVAILABLE');
  await act(async () => renderer.unmount());
});

test('catalog current-run action is bound to the same run ID', async () => {
  mockCurrentRun = activeRun();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategiesScreen />); await flushPromises(); });
  await act(async () => button(renderer, 'View Perpl status').props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplStatus', {runId: 'run-1'});
  await act(async () => renderer.unmount());
});

test('Perpl detail opens only the catalog-declared setup after a known empty status', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategyDetailScreen />); await flushPromises(); });
  const review = button(renderer, 'Review Perpl setup');
  expect(review.props.disabled).toBe(false);
  await act(async () => review.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplSetup');
  await act(async () => renderer.unmount());
});

test('Perpl detail keeps setup action prominent and exact aggregate values in a disclosure', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategyDetailScreen />); await flushPromises(); });
  expect(button(renderer, 'Review Perpl setup').props.disabled).toBe(false);
  expect(content(renderer)).toContain('NET REALIZED P&L');
  expect(content(renderer)).not.toContain('Exact net realized P&L');
  expect(content(renderer)).not.toContain('Fixed-rule Perpl Testnet strategy.');
  await act(async () => button(renderer, 'How it works: Show').props.onPress());
  expect(content(renderer)).toContain('Fixed-rule Perpl Testnet strategy.');
  await act(async () => button(renderer, 'Result scope: Show').props.onPress());
  expect(content(renderer)).toContain('Exact net realized P&L');
  expect(content(renderer)).toContain('Activated wallet addresses');
  await act(async () => renderer.unmount());
});

test('active or unknown owner-matched Perpl run goes to status and blocks a second setup', async () => {
  mockCurrentRun = activeRun();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategyDetailScreen />); await flushPromises(); });
  expect(button(renderer, 'Review Perpl setup').props.disabled).toBe(true);
  await act(async () => button(renderer, 'View Perpl status').props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplStatus', {runId: 'run-1'});
  await act(async () => renderer.unmount());

  mockCurrentRun = {...activeRun(), status: 'future_state'};
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategyDetailScreen />); await flushPromises(); });
  expect(button(renderer, 'Review Perpl setup').props.disabled).toBe(true);
  expect(button(renderer, 'Check Perpl status')).toBeTruthy();
  await act(async () => renderer.unmount());
});

test('planned Agentic detail is informative but has no action', async () => {
  mockRouteParams = {strategyId: 'moeazi-agentic'};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategyDetailScreen />); await flushPromises(); });
  expect(content(renderer)).toContain('Planned concept.');
  expect(content(renderer)).not.toContain('Planned 2% fee; not charged now.');
  await act(async () => button(renderer, 'Fee details: Show').props.onPress());
  expect(content(renderer)).toContain('Planned 2% fee; not charged now.');
  expect(button(renderer, 'Coming soon').props.disabled).toBe(true);
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Review Perpl setup')).toHaveLength(0);
  expect(content(renderer)).not.toContain('−0.012 AUSD');
  await act(async () => renderer.unmount());
});

test('status from another owner is rejected and owner changes discard late reads', async () => {
  mockCurrentRun = activeRun('0xcccccccccccccccccccccccccccccccccccccccc');
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategyDetailScreen />); await flushPromises(); });
  expect(button(renderer, 'Review Perpl setup').props.disabled).toBe(true);
  expect(content(renderer)).toContain('Setup stays unavailable until your current Perpl status can be checked.');
  expect(content(renderer)).not.toContain('0xcccccccccccccccccccccccccccccccccccccccc');
  await act(async () => renderer.unmount());

  let resolveOld!: (value: any) => void; let resolveNew!: (value: any) => void;
  mockCurrent.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
  mockOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  await act(async () => { renderer = ReactTestRenderer.create(<UserStrategiesScreen />); await Promise.resolve(); });
  mockOwner = '0xcccccccccccccccccccccccccccccccccccccccc';
  await act(async () => { renderer.update(<UserStrategiesScreen />); await Promise.resolve(); });
  await act(async () => { resolveNew({current: null}); await flushPromises(); });
  await act(async () => { resolveOld({current: activeRun()}); await flushPromises(); });
  expect(content(renderer)).not.toContain('CURRENT RUN');
  expect(content(renderer)).not.toContain('run-1');
  await act(async () => renderer.unmount());
});
