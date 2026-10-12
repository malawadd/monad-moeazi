import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';

let mockOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let mockHead: any = null;
let mockShowAutonomous = true;
const mockFetchPage = jest.fn();
const mockNavigation = {navigate: jest.fn()};

jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigation, useIsFocused: () => true, useFocusEffect: () => {}}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: 'developer', effectiveTheme: 'original', showAutonomousActivity: mockShowAutonomous})}));
jest.mock('../src/services/useMarketQueries', () => ({
  useMonadActivityQuery: () => ({data: mockHead, isLoading: !mockHead, isFetching: false, isStale: false, error: null, refetch: jest.fn()}),
  useMarketTradesQuery: () => ({data: {summaries: []}, isStale: false, isError: false, refetch: jest.fn()}),
  fetchMonadActivityPage: (...args: unknown[]) => mockFetchPage(...args),
}));
jest.mock('../src/services/notifications/NotificationEvents', () => ({subscribeNotificationActivityRefresh: () => () => {}}));
jest.mock('../src/services/pendingOperationJournal', () => ({loadPendingOperationReferences: jest.fn().mockResolvedValue([])}));
jest.mock('../src/services/pendingOperationReminder', () => ({
  loadPendingOperationReminderReferences: jest.fn().mockResolvedValue([]), dismissPendingOperationReminder: jest.fn(),
}));
jest.mock('../src/components/MonadTransactionHash', () => ({MonadTransactionHash: () => null}));
jest.mock('../src/components/MarketTradeSummaryCard', () => ({MarketTradeSummaryCard: () => null}));
jest.mock('../src/screens/UserActivityView', () => ({UserActivityView: () => null}));
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: unknown}) => ReactRuntime.createElement(Native.View, null, children);
  return {
    Button: ({label, onPress}: {label: string; onPress?: () => void}) => ReactRuntime.createElement(Native.Pressable,
      {accessibilityRole: 'button', accessibilityLabel: label, onPress}, ReactRuntime.createElement(Native.Text, null, label)),
    Card: Container, Screen: Container,
    Notice: ({title, message}: {title: string; message: string}) => ReactRuntime.createElement(Native.Text, null, `${title} ${message}`),
    PageHeader: ({title}: {title: string}) => ReactRuntime.createElement(Native.Text, null, title),
    StatusBadge: ({label}: {label: string}) => ReactRuntime.createElement(Native.Text, null, label),
  };
});

import {ActivityScreen} from '../src/screens/ActivityScreen';
import type {MonadActivityEvent, MonadActivityPage} from '../src/types/monad';

const ownerA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ownerB = '0xcccccccccccccccccccccccccccccccccccccccc';
function event(id: string, title = id): MonadActivityEvent {
  return {id, kind: 'send_usdc', status: 'finalized', occurredAt: '2026-10-12T00:00:00Z', title, summary: title, fundsMoved: true};
}
function page(events: MonadActivityEvent[], nextCursor: string | null, hasMore: boolean): MonadActivityPage {
  return {events, nextCursor, hasMore};
}
function content(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType(Text).map(node => String(node.props.children)).join(' ');
}

beforeEach(() => {
  mockOwner = ownerA; mockShowAutonomous = true;
  mockHead = page([event('head-old')], 'cursor-old', true);
  mockFetchPage.mockReset(); mockNavigation.navigate.mockClear();
});

test('retains the prior head and older page when a refreshed head advances', async () => {
  mockFetchPage.mockResolvedValue(page([event('older-page')], 'cursor-next', true));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<ActivityScreen />); });
  await act(async () => { await renderer.root.findByProps({accessibilityLabel: 'Load more activity'}).props.onPress(); });
  mockHead = page([event('head-new')], 'cursor-refreshed', true);
  await act(async () => { renderer.update(<ActivityScreen />); });
  const visible = content(renderer);
  expect(visible).toContain('head-new');
  expect(visible).toContain('head-old');
  expect(visible).toContain('older-page');
  await act(async () => { renderer.unmount(); });
});

test('a late older page cannot cross an owner switch', async () => {
  let resolvePage!: (value: MonadActivityPage) => void;
  mockFetchPage.mockReturnValue(new Promise(resolve => { resolvePage = resolve; }));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<ActivityScreen />); });
  let pending!: Promise<void>;
  act(() => { pending = renderer.root.findByProps({accessibilityLabel: 'Load more activity'}).props.onPress(); });
  mockOwner = ownerB;
  mockHead = page([event('owner-b-event', 'Owner B event')], null, false);
  await act(async () => { renderer.update(<ActivityScreen />); });
  expect(content(renderer)).toContain('Owner B event');
  resolvePage(page([event('owner-a-secret', 'Owner A secret')], null, false));
  await act(async () => { await pending; });
  expect(content(renderer)).toContain('Owner B event');
  expect(content(renderer)).not.toContain('Owner A secret');
  await act(async () => { renderer.unmount(); });
});

test('Developer activity remains raw when the User autonomous activity preference is off', async () => {
  const runId = '11223344-5566-7788-99aa-bbccddeeff00';
  const venueId = 'perpl-direct-testnet-v1';
  mockShowAutonomous = false;
  mockHead = page([event(`${venueId}:${runId}:optimizer:1`, 'Raw optimizer check')], null, false);
  mockHead.events[0]!.kind = 'perpl_direct_optimizer';
  mockHead.events[0]!.venueId = venueId;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<ActivityScreen />); });
  expect(content(renderer)).toContain('Raw optimizer check');
  await act(async () => { renderer.unmount(); });
});
