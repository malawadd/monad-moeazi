import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';

let mockOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const mockFetch = jest.fn();
const mockNavigation = {goBack: jest.fn(), navigate: jest.fn()};
let mockRoute: {params: {itemId: string; event?: unknown; operationId?: string}; path?: string} = {
  params: {itemId: 'event-1', event: {id: 'event-1', title: 'Untrusted route event', summary: 'must not render'}},
};

jest.mock('@react-navigation/native', () => {
  const ReactRuntime = require('react');
  return {useNavigation: () => mockNavigation, useRoute: () => mockRoute,
    useFocusEffect: (callback: () => void | (() => void)) => ReactRuntime.useEffect(callback, [callback])};
});
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: 'user', effectiveTheme: 'original'})}));
jest.mock('../src/services/useMarketQueries', () => ({fetchMonadActivityPage: (...args: unknown[]) => mockFetch(...args)}));

import {ActivityDetailScreen} from '../src/screens/ActivityDetailScreen';

const ownerA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ownerB = '0xcccccccccccccccccccccccccccccccccccccccc';
function page(id: string, title: string) { return {events: [{id, kind: 'wallet_sent', title, summary: title, status: 'finalized',
  occurredAt: '2026-10-12T00:00:00Z', fundsMoved: true}], nextCursor: null, hasMore: false}; }
async function flush() { for (let index = 0; index < 10; index += 1) await Promise.resolve(); }
function text(renderer: ReactTestRenderer.ReactTestRenderer) { return renderer.root.findAllByType(Text).map(node => String(node.props.children)).join(' '); }

beforeEach(() => {
  mockOwner = ownerA; mockRoute = {params: {itemId: 'event-1', event: {id: 'event-1', title: 'Untrusted route event', summary: 'must not render'}}};
  mockNavigation.goBack.mockClear(); mockNavigation.navigate.mockClear(); mockFetch.mockReset().mockResolvedValue(page('event-1', 'Owner A event'));
});

test('ActivityDetail resolves an event from the authenticated activity feed instead of trusting route params', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<ActivityDetailScreen />); await flush(); });
  expect(mockFetch).toHaveBeenCalledWith(ownerA, null);
  expect(text(renderer)).toContain('Owner A event');
  expect(text(renderer)).not.toContain('Untrusted route event');
  await act(async () => renderer.root.find(node => node.props.accessibilityLabel === 'Back to activity').props.onPress());
  expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

test('ActivityDetail clears the previous owner and ignores late responses after an owner switch', async () => {
  let finishOwnerA!: (value: unknown) => void;
  mockFetch.mockReset().mockImplementationOnce(() => new Promise(resolve => { finishOwnerA = resolve; }))
    .mockResolvedValueOnce(page('event-1', 'Owner B event'));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<ActivityDetailScreen />); await Promise.resolve(); });
  mockOwner = ownerB;
  await act(async () => { renderer.update(<ActivityDetailScreen />); await flush(); });
  expect(mockFetch).toHaveBeenLastCalledWith(ownerB, null);
  expect(text(renderer)).toContain('Owner B event');
  await act(async () => { finishOwnerA(page('event-1', 'Owner A secret')); await flush(); });
  expect(text(renderer)).toContain('Owner B event');
  expect(text(renderer)).not.toContain('Owner A secret');
  await act(async () => renderer.unmount());
});

test('User cold activity links return to Activity and cancellation errors offer a retry without leaking CancelledError', async () => {
  mockRoute = {params: {itemId: 'unknown_receipt'}, path: 'activity/unknown_receipt'};
  mockFetch.mockReset().mockRejectedValue(Object.assign(new Error('CancelledError'), {name: 'CancelledError'}));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<ActivityDetailScreen />); await flush(); });
  expect(text(renderer)).toContain('Activity unavailable');
  expect(text(renderer)).toContain('The activity check was interrupted. Refresh activity to try again.');
  expect(text(renderer)).not.toContain('CancelledError');
  const back = renderer.root.find(node => node.props.accessibilityLabel === 'Back to activity');
  await act(async () => back.props.onPress());
  expect(mockNavigation.navigate).toHaveBeenCalledWith('Main', {screen: 'Activity'});
  expect(mockNavigation.goBack).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

test('a successful owner-scoped lookup with no matching ID remains a not-found result', async () => {
  mockRoute = {params: {itemId: 'unknown_receipt'}};
  mockFetch.mockReset().mockResolvedValue(page('different-event', 'Other event'));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<ActivityDetailScreen />); await flush(); });
  expect(text(renderer)).toContain('Activity not found');
  expect(text(renderer)).not.toContain('Activity unavailable');
  expect(text(renderer)).not.toContain('interrupted');
  await act(async () => renderer.unmount());
});

test('grouped operation lookup follows all older pages and retains the selected event across page boundaries', async () => {
  const operationId = 'aa58b552-cc08-4a04-8553-36d663c031cd';
  const prefix = `operation:${operationId}:`;
  const selectedId = `${prefix}finalized:0x${'f'.repeat(64)}`;
  mockRoute = {params: {itemId: selectedId, operationId}};
  mockFetch.mockReset()
    .mockResolvedValueOnce({events: [{id: selectedId, kind: 'wallet_swap', title: 'Wallet swap finalized', summary: 'Finalized receipt',
      status: 'finalized', occurredAt: '2026-10-12T12:03:00Z', fundsMoved: true}], nextCursor: 'older-1', hasMore: true})
    .mockResolvedValueOnce({events: [{id: `${prefix}prepared`, kind: 'wallet_swap', title: 'Wallet swap prepared', summary: 'Prepared',
      status: 'prepared', occurredAt: '2026-10-12T12:00:00Z', fundsMoved: false}], nextCursor: 'older-2', hasMore: true})
    .mockResolvedValueOnce({events: [{id: `${prefix}authorized`, kind: 'wallet_swap', title: 'Wallet swap approved', summary: 'Authorized',
      status: 'authorized', occurredAt: '2026-10-12T12:01:00Z', fundsMoved: false}], nextCursor: null, hasMore: false});

  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<ActivityDetailScreen />); await flush(); });

  expect(mockFetch.mock.calls).toEqual([[ownerA, null], [ownerA, 'older-1'], [ownerA, 'older-2']]);
  expect(text(renderer)).toContain('Wallet swap finalized');
  expect(text(renderer)).toContain('Operation timeline');
  const rendered = text(renderer);
  expect(rendered.indexOf('prepared · wallet swap')).toBeLessThan(rendered.indexOf('authorized · wallet swap'));
  expect(rendered.indexOf('authorized · wallet swap')).toBeLessThan(rendered.indexOf('finalized · wallet swap'));
  await act(async () => renderer.unmount());
});
