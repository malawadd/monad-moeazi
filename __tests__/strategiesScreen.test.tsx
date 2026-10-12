import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockNavigation = {navigate: jest.fn()};
let mockCurrentRun: any;
let mockHistoryRuns: any[];
const mockStrategies = jest.fn();
jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation,
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/services/monadApi', () => ({monadApi: {strategies: (...args: unknown[]) => mockStrategies(...args)}}));
jest.mock('../src/services/perplApi', () => ({perplApi: {
  current: async () => ({current: mockCurrentRun}),
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
  return {Button, Card: Container, DataRow: Label, LoadingBlock: Label, Notice: Label,
    PageHeader: Label, Screen: Container, StatusBadge: Label};
});

import {StrategiesScreen} from '../src/screens/StrategiesScreen';

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

beforeEach(() => {
  mockNavigation.navigate.mockClear(); mockStrategies.mockReset().mockResolvedValue(catalog); mockCurrentRun = null; mockHistoryRuns = [];
});

test('catalog selects Perpl by default and opens a separate detail page without enrolling', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<StrategiesScreen />); await flushPromises(); });
  const perpl = renderer.root.find(node => node.props.accessibilityLabel === 'Perpl deterministic strategy');
  expect(perpl.props.accessibilityState).toEqual({selected: true});
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Review Perpl setup')).toHaveLength(0);
  await act(async () => perpl.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('StrategyDetail', {strategyId: 'perpl-deterministic'});
  await act(async () => renderer.unmount());
});

test('an active Perpl run links to status and legacy agent status remains reachable', async () => {
  mockCurrentRun = {runId: 'run-1', venueId: 'perpl-direct-testnet-v1', chainId: 10143,
    ownerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', vaultAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    status: 'active', optimizer: {version: 'perpl-deterministic-v3-soak'}};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<StrategiesScreen />); await flushPromises(); });
  const status = renderer.root.find(node => node.props.accessibilityLabel === 'Open Perpl run status');
  await act(async () => status.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplStatus');
  const agent = renderer.root.find(node => node.props.accessibilityLabel === 'Read legacy agent status');
  await act(async () => agent.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('AgentStatus');
  await act(async () => renderer.unmount());
});

test('completed owner history changes the catalog enrollment label', async () => {
  mockHistoryRuns = [{runId: 'done-1', venueId: 'perpl-direct-testnet-v1', chainId: 10143,
    ownerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', vaultAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    status: 'completed', optimizer: {version: 'perpl-deterministic-v3-soak'}}];
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<StrategiesScreen />); await flushPromises(); });
  expect(JSON.stringify(renderer.toJSON())).toContain('Previously enrolled · new run needs Mera approval');
  await act(async () => renderer.unmount());
});
