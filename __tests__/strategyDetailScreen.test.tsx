import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
let mockRouteParams: any;
let mockCurrentRun: any;
let mockCurrentError: Error | null;
let mockHistoryRuns: any[];
const mockStrategies = jest.fn();
jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation, useRoute: () => ({params: mockRouteParams}),
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/services/monadApi', () => ({monadApi: {strategies: (...args: unknown[]) => mockStrategies(...args)}}));
jest.mock('../src/services/perplApi', () => ({perplApi: {
  current: async () => { if (mockCurrentError) throw mockCurrentError; return {current: mockCurrentRun}; },
  history: async () => ({runs: mockHistoryRuns, hasMore: false, nextCursor: null}),
}}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: 'developer', effectiveTheme: 'original'})}));
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.View, null, children);
  const Button = ({label, onPress, disabled}: {label: string; onPress?: () => void; disabled?: boolean}) =>
    ReactRuntime.createElement(Native.Pressable, {accessibilityRole: 'button', accessibilityLabel: label, onPress, disabled},
      ReactRuntime.createElement(Native.Text, null, label));
  const Label = ({title, label, value, copy, children}: {title?: string; label?: string; value?: string; copy?: string; children?: React.ReactNode}) =>
    ReactRuntime.createElement(Native.Text, null, title ?? label ?? value ?? copy ?? children);
  const DataRow = ({label, value}: {label: string; value: string}) => ReactRuntime.createElement(Native.Text, null, `${label}: ${value}`);
  const Notice = ({title, message}: {title: string; message?: string}) => ReactRuntime.createElement(Native.Text, null, `${title} ${message ?? ''}`);
  return {Button, Card: Container, DataRow, LoadingBlock: Label, Notice,
    PageHeader: Label, Screen: Container, StatusBadge: Label};
});

import {StrategyDetailScreen} from '../src/screens/StrategyDetailScreen';

const catalog = {catalogVersion: 'strategy-catalog-v1', metrics: {strategyId: 'perpl-deterministic', currency: 'AUSD', decimals: 6,
  netRealizedPnlUnits: '-12000', verifiedCycleCount: 2, uniqueActivatedWalletCount: 1, observedAt: 1000}, strategies: [
  {strategyId: 'perpl-deterministic', version: 'perpl-deterministic-v3-soak', creator: 'Moeazi Team', name: 'Perpl deterministic',
    kind: 'deterministic', status: 'available', description: 'Fixed-rule strategy.',
    enrollmentDestination: {type: 'mobile_route', route: 'PerplSetup', venueId: 'perpl-direct-testnet-v1'},
    fee: {model: 'performance', rateBps: 0, appliesTo: 'positive_net_realized_profit', currency: 'AUSD', description: '0% Moeazi performance fee.'},
    venueFees: {venue: 'Perpl', description: 'Perpl fees apply separately.'}},
  {strategyId: 'moeazi-agentic', version: 'planned-v1', creator: 'Moeazi Team', name: 'Agentic strategy',
    kind: 'agentic', status: 'planned_unavailable', description: 'Planned only.', enrollmentDestination: null,
    fee: {model: 'performance', rateBps: 200, appliesTo: 'positive_net_realized_profit', currency: 'AUSD', description: 'Planned 2% of positive net realized profit.'},
    venueFees: null},
]};

async function flushPromises() { for (let index = 0; index < 10; index += 1) await Promise.resolve(); }
function textContent(renderer: ReactTestRenderer.ReactTestRenderer) { return JSON.stringify(renderer.toJSON()); }

beforeEach(() => {
  mockNavigation.navigate.mockClear(); mockStrategies.mockReset().mockResolvedValue(catalog);
  mockCurrentRun = null; mockCurrentError = null; mockHistoryRuns = []; mockRouteParams = {strategyId: 'perpl-deterministic'};
});

test('deterministic details describe the fixed policy, verified metrics, and setup approval boundary', async () => {
  mockCurrentRun = {runId: 'run-1', venueId: 'perpl-direct-testnet-v1', chainId: 10143,
    ownerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', vaultAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', status: 'active'};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<StrategyDetailScreen />); await flushPromises(); });
  const content = textContent(renderer);
  for (const term of ['0% Moeazi performance fee.', '100 AUSD fixed', '10–720 minutes', '0.15 AUSD per cycle', 'Verified completed cycles', 'As of', 'does not enroll or trade']) {
    expect(content).toContain(term);
  }
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Enable strategy').props.disabled).toBe(true);
  await act(async () => renderer.root.find(node => node.props.accessibilityLabel === 'Open Perpl run status').props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplStatus');
  await act(async () => renderer.unmount());
});

test('agentic details state the concept and unknowns and keep Enable disabled', async () => {
  mockRouteParams = {strategyId: 'moeazi-agentic'};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<StrategyDetailScreen />); await flushPromises(); });
  const content = textContent(renderer);
  for (const term of ['replaceable decision provider', 'reviewed risk policy', 'explicit Mera opt-in', 'Activity',
    'Not announced', 'Performance history', 'Supported markets', 'Launch date', '2% of positive net realized profit only', 'Charged now']) {
    expect(content).toContain(term);
  }
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Enable').props.disabled).toBe(true);
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Enable strategy')).toHaveLength(0);
  await act(async () => renderer.unmount());
});

test('completed owner history is shown and a failed current status check blocks setup', async () => {
  mockHistoryRuns = [{runId: 'done-1', venueId: 'perpl-direct-testnet-v1', chainId: 10143,
    ownerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', vaultAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    status: 'completed', optimizer: {version: 'perpl-deterministic-v3-soak'}}];
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<StrategyDetailScreen />); await flushPromises(); });
  expect(textContent(renderer)).toContain('Previously enrolled · new run needs Mera approval');
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Enable strategy').props.disabled).toBe(false);
  await act(async () => renderer.unmount());

  mockCurrentError = new Error('status offline');
  await act(async () => { renderer = ReactTestRenderer.create(<StrategyDetailScreen />); await flushPromises(); });
  expect(renderer.root.find(node => node.props.accessibilityLabel === 'Enable strategy').props.disabled).toBe(true);
  expect(textContent(renderer)).toContain('status offline');
  await act(async () => renderer.unmount());
});
