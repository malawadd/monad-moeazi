import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {View} from 'react-native';

const mockNavigation = {navigate: jest.fn(), goBack: jest.fn()};
let mockOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let mockMode = 'user';
let mockRouteParams: any = {runId: 'run-a'};
const mockRunHistory = jest.fn();
const mockTrades = jest.fn();

jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation, useRoute: () => ({params: mockRouteParams}),
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/services/perplApi', () => ({perplApi: {runHistory: (...args: unknown[]) => mockRunHistory(...args)}}));
jest.mock('../src/services/marketDirectoryApi', () => ({marketDirectoryApi: {trades: (...args: unknown[]) => mockTrades(...args)}}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: mockMode, effectiveTheme: 'original', showAutonomousActivity: true})}));

import {PerplHistoryScreen} from '../src/screens/PerplHistoryScreen';

const ownerA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ownerB = '0xcccccccccccccccccccccccccccccccccccccccc';
function run(ownerAddress = ownerA, runId = 'run-a') {
  return {runId, venueId: 'perpl-direct-testnet-v1', status: 'completed', ownerAddress,
    vaultAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', chainId: 10143,
    collateral: {symbol: 'AUSD', address: '0xa9012a055bd4e0edff8ce09f960291c09d5322dc', decimals: 6},
    startingAmountUnits: '100000000', returnedUnits: '100000000'};
}
function page(ownerAddress = ownerA, runId = 'run-a', events: any[] = [], hasMore = false): any {
  return {run: run(ownerAddress, runId), events, orders: [], observations: [], hasMore, nextCursor: hasMore ? 'cursor-1' : null};
}
function event(id: string, summary = id) { return {id, kind: 'perpl_recovery_finalized', status: 'completed', summary,
  occurredAt: '2026-10-12T00:00:00Z', amountUnits: '100000000', transactionHash: `0x${id}`}; }
async function flush() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
function content(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(node => typeof node.props.children === 'string').map(node => node.props.children).join(' ');
}
function button(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.find(node => node.props.accessibilityLabel === label);
}

beforeEach(() => {
  mockNavigation.navigate.mockClear(); mockNavigation.goBack.mockClear(); mockOwner = ownerA; mockMode = 'user';
  mockRouteParams = {runId: 'run-a'}; mockRunHistory.mockReset().mockResolvedValue(page()); mockTrades.mockReset().mockResolvedValue({summaries: []});
});

test('User history validates the selected run, shows readable receipt details and returns to that exact status ID', async () => {
  mockRunHistory.mockResolvedValue(page(ownerA, 'run-a', [event('receipt-1', 'AUSD returned to your wallet')]));
  mockTrades.mockResolvedValue({summaries: [
    {summaryId: 'summary-1', runId: 'run-a', venueId: 'perpl-direct-testnet-v1', marketId: '32', source: 'autonomous', symbol: 'ETH', direction: 'long',
      sizeUnits: '1000', status: 'closed', netRealizedPnlUnits: '-50', feesKnown: true, orderIds: [], transactionHashes: [], activityIds: []},
    {summaryId: 'wrong-run', runId: 'run-b', venueId: 'perpl-direct-testnet-v1', source: 'autonomous'},
    {summaryId: 'spot', runId: 'run-a', venueId: 'spot-testnet', source: 'autonomous'},
  ]});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplHistoryScreen />); await flush(); });
  expect(mockRunHistory).toHaveBeenCalledWith('run-a', 50);
  expect(content(renderer)).toContain('Starting collateral');
  expect(content(renderer)).toContain('Collateral returned');
  expect(content(renderer)).toContain('Completed');
  expect(content(renderer)).not.toContain('AUSD returned to your wallet');
  expect(content(renderer)).not.toContain('0xreceipt-1');
  expect(content(renderer)).not.toContain('wrong-run');
  await act(async () => button(renderer, 'Position summaries: 1').props.onPress());
  expect(content(renderer)).toContain('Reported net realized P&L');
  expect(content(renderer)).not.toContain('Not available AUSD');
  await act(async () => button(renderer, 'View ETH market summary').props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('MarketDetail', {venueId: 'perpl-direct-testnet-v1', marketId: '32', summaryId: 'summary-1'});
  const eventDetails = renderer.root.findByProps({testID: 'user-perpl-event-receipt-1'})
    .findAll(node => node.props.accessibilityLabel === 'Event details: Show');
  expect(eventDetails.length).toBeGreaterThan(0);
  await act(async () => eventDetails[0].props.onPress());
  expect(content(renderer)).toContain('AUSD returned to your wallet');
  expect(content(renderer)).toContain('0xreceipt-1');
  expect(content(renderer)).toContain('100 AUSD');
  await act(async () => button(renderer, 'View run status').props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('PerplStatus', {runId: 'run-a'});
  await act(async () => renderer.unmount());
});

test('repeated optimizer scans are grouped and never presented as an executed trade', async () => {
  mockRunHistory.mockResolvedValue(page(ownerA, 'run-a', [
    {id: 'scan-1', kind: 'perpl_direct_optimizer', status: 'optimizer_market_scan_not_due', summary: 'Perpl policy optimizer market scan not due'},
    {id: 'scan-2', kind: 'perpl_direct_optimizer', status: 'optimizer_market_scan_not_due', summary: 'Perpl policy optimizer market scan not due'},
  ]));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplHistoryScreen />); await flush(); });
  expect(content(renderer)).not.toContain('No market passed optimizer filters');
  expect(content(renderer)).not.toContain('No events are recorded for this run yet.');
  await act(async () => button(renderer, 'Strategy checks: 2').props.onPress());
  expect(content(renderer)).toContain('Recorded strategy scans and policy checks. These entries do not imply that an order was proposed or filled.');
  expect(content(renderer)).toContain('2 checks');
  await act(async () => renderer.unmount());
});

test('run ID or owner mismatches never display history and errors reveal no owner details', async () => {
  mockRunHistory.mockResolvedValue(page(ownerA, 'different-run', [event('secret')]));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplHistoryScreen />); await flush(); });
  expect(content(renderer)).toContain('This Perpl run history is unavailable for the current wallet.');
  expect(content(renderer)).not.toContain('0xsecre');
  await act(async () => renderer.unmount());

  mockRunHistory.mockResolvedValue(page(ownerB, 'run-a', [event('owner-secret')]));
  await act(async () => { renderer = ReactTestRenderer.create(<PerplHistoryScreen />); await flush(); });
  expect(content(renderer)).toContain('This Perpl run history is unavailable for the current wallet.');
  expect(content(renderer)).not.toContain(ownerB);
  expect(content(renderer)).not.toContain('owner-secret');
  await act(async () => renderer.unmount());
});

test('pagination deduplicates overlapping events and discards a late page after owner changes', async () => {
  mockRunHistory.mockResolvedValueOnce(page(ownerA, 'run-a', [event('same', 'First receipt')], true))
    .mockResolvedValueOnce(page(ownerA, 'run-a', [event('same', 'Duplicate receipt'), event('next', 'Next receipt')], false));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplHistoryScreen />); await flush(); });
  await act(async () => button(renderer, 'Load more history').props.onPress());
  await act(async () => flush());
  expect(renderer.root.findAll(node => node.type === View && node.props.testID === 'user-perpl-event-same')).toHaveLength(1);
  expect(renderer.root.findAll(node => node.type === View && node.props.testID === 'user-perpl-event-next')).toHaveLength(1);
  expect(content(renderer)).not.toContain('Duplicate receipt');
  await act(async () => renderer.root.findByProps({testID: 'user-perpl-event-same'})
    .findAll(node => node.props.accessibilityLabel === 'Event details: Show')[0].props.onPress());
  expect(content(renderer)).toContain('First receipt');
  await act(async () => renderer.root.findByProps({testID: 'user-perpl-event-next'})
    .findAll(node => node.props.accessibilityLabel === 'Event details: Show')[0].props.onPress());
  expect(content(renderer)).toContain('Next receipt');
  await act(async () => renderer.unmount());

  let resolveOld!: (value: any) => void;
  mockRunHistory.mockReset().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(page(ownerB, 'run-a', [event('new-owner', 'New wallet event')]));
  mockOwner = ownerA;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplHistoryScreen />); await Promise.resolve(); });
  mockOwner = ownerB;
  await act(async () => { renderer.update(<PerplHistoryScreen />); await flush(); });
  await act(async () => { resolveOld(page(ownerA, 'run-a', [event('old-owner', 'Old wallet event')])); await flush(); });
  expect(renderer.root.findAll(node => node.type === View && node.props.testID === 'user-perpl-event-new-owner')).toHaveLength(1);
  expect(renderer.root.findAll(node => node.type === View && node.props.testID === 'user-perpl-event-old-owner')).toHaveLength(0);
  expect(content(renderer)).not.toContain('Old wallet event');
  await act(async () => renderer.unmount());
});

test('Developer Perpl history continues to render its existing diagnostic screen', async () => {
  mockMode = 'developer';
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplHistoryScreen />); await flush(); });
  expect(content(renderer)).toContain('Every venue update');
  expect(content(renderer)).not.toContain('Run history');
  await act(async () => renderer.unmount());
});
