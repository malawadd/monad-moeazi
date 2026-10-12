const mockInitialPush = jest.fn<Promise<string | null>, []>();
let mockNativeListener: ((event: {url: string}) => void) | undefined;

jest.mock('../src/services/notifications/NotificationLinks', () => ({
  getInitialNotificationUrl: () => mockInitialPush(),
  subscribeNotificationOpened: () => () => undefined,
}));

import {Alert, Linking} from 'react-native';
import {createMobileLinking, INITIAL_PUSH_URL_TIMEOUT_MS, safeMobileDeepLink} from '../src/navigation/linking';
import {acquirePreparedReview, beginMeraSigningSession, resetSigningGuardForTests} from '../src/services/signingGuard';
import {userMarketDetailBackAction} from '../src/navigation/userMarketDetailBack';

const linkOptions = (mode: 'user' | 'developer') => createMobileLinking(mode);

beforeEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  mockInitialPush.mockReset();
  mockInitialPush.mockResolvedValue(null);
  mockNativeListener = undefined;
  resetSigningGuardForTests();
});

afterEach(() => {
  jest.useRealTimers();
  resetSigningGuardForTests();
});

test('native OS initial URL wins without initializing optional push lookup', async () => {
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('moeazi-monad://markets/venue7/market32');
  await expect(linkOptions('user').getInitialURL?.()).resolves.toBe('moeazi-monad://markets/venue7/market32');
  expect(mockInitialPush).not.toHaveBeenCalled();
});

test('a hanging optional notification does not hold startup and a late notification is delivered', async () => {
  let resolvePush!: (url: string | null) => void;
  mockInitialPush.mockReturnValue(new Promise(resolve => { resolvePush = resolve; }));
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  const options = linkOptions('user');
  const received: string[] = [];
  options.subscribe?.(url => received.push(url));

  jest.useFakeTimers();
  const initial = options.getInitialURL?.();
  await Promise.resolve();
  await Promise.resolve();
  await jest.advanceTimersByTimeAsync(INITIAL_PUSH_URL_TIMEOUT_MS);
  await expect(initial).resolves.toBeNull();

  resolvePush('moeazi-monad://activity/item_42');
  await Promise.resolve();
  await Promise.resolve();
  expect(received).toEqual(['moeazi-monad://activity/item_42']);
});

test('incoming links cannot discard an unsigned review, and work after explicit release', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'addEventListener').mockImplementation(((event: 'url', listener: (event: {url: string}) => void) => {
    if (event === 'url') mockNativeListener = listener as (event: {url: string}) => void;
    return {remove: jest.fn()};
  }) as unknown as typeof Linking.addEventListener);
  const received: string[] = [];
  linkOptions('developer').subscribe?.(url => received.push(url));
  const releaseReview = acquirePreparedReview();

  mockNativeListener?.({url: 'moeazi-monad://account'});
  expect(received).toEqual([]);
  expect(alert).toHaveBeenCalledWith(
    'Finish or cancel this review',
    expect.stringContaining('Finish or cancel it'),
    expect.any(Array),
    expect.any(Object),
  );

  releaseReview();
  const endPasskey = beginMeraSigningSession();
  mockNativeListener?.({url: 'moeazi-monad://account'});
  expect(received).toEqual([]);
  endPasskey();
  mockNativeListener?.({url: 'moeazi-monad://account'});
  expect(received).toEqual(['moeazi-monad://account']);
});

test('legacy autonomy status stays in Developer Mode and User links go to neutral Strategies', () => {
  expect(linkOptions('user').config?.screens?.AutonomyStatus).toBeUndefined();
  expect(linkOptions('developer').config?.screens?.AutonomyStatus).toBe('autonomy/status');
  expect(safeMobileDeepLink('moeazi-monad://autonomy/status', 'user')).toBe('moeazi-monad://strategies');
});

test('cold receipt links preserve the backend operation identity', () => {
  const activityId = 'operation:aa58b552-cc08-4a04-8553-36d663c031cd:finalized:0xf869f500c54b2510974435678c771f6343463f02b2967a379e40154d7c7b00ea';
  const url = `moeazi-monad://activity/${activityId}`;
  expect(safeMobileDeepLink(url, 'user')).toBe(url);
  expect(linkOptions('user').config?.screens?.ActivityDetail).toBe('activity/:itemId');
});

test('the same receipt allowlist is applied to a cold notification URL', async () => {
  const url = 'moeazi-monad://activity/operation:aa58b552-cc08-4a04-8553-36d663c031cd:finalized:0xf869f500c54b2510974435678c771f6343463f02b2967a379e40154d7c7b00ea';
  jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
  mockInitialPush.mockResolvedValue(url);
  await expect(linkOptions('user').getInitialURL?.()).resolves.toBe(url);

  mockInitialPush.mockResolvedValue('moeazi-monad://activity/../home');
  await expect(linkOptions('user').getInitialURL?.()).resolves.toBeNull();
});

test('activity links accept only known backend ID shapes and reject URL syntax', () => {
  const operationId = 'operation:aa58b552-cc08-4a04-8553-36d663c031cd:finalized:0xf869f500c54b2510974435678c771f6343463f02b2967a379e40154d7c7b00ea';
  const manualId = 'manual-perpl:aa58b552-cc08-4a04-8553-36d663c031cd:finalized';
  const mandateId = 'mandate:aa58b552-cc08-4a04-8553-36d663c031cd:signed';
  for (const id of [operationId, manualId, mandateId, 'activity-1']) {
    expect(safeMobileDeepLink(`moeazi-monad://activity/${id}`, 'developer')).toBe(`moeazi-monad://activity/${id}`);
  }

  for (const suffix of [
    'operation:aa58b552-cc08-4a04-8553-36d663c031cd:finalized:0x1234',
    'operation:aa58b552-cc08-4a04-8553-36d663c031cd:unknown',
    'operation:aa58b552-cc08-4a04-8553-36d663c031cd:finalized:0x' + 'f'.repeat(64) + '?next=home',
    'operation%3Aaa58b552-cc08-4a04-8553-36d663c031cd%3Afinalized%3A0x' + 'f'.repeat(64),
    '../home',
    'operation:../../home:finalized',
  ]) {
    expect(safeMobileDeepLink(`moeazi-monad://activity/${suffix}`, 'user')).toBeNull();
  }
  expect(safeMobileDeepLink(`moeazi-monad://activity/${'x'.repeat(101)}`, 'user')).toBeNull();
});

test('User linked market Back returns to Markets while ordinary in-app Back is preserved', () => {
  expect(linkOptions('user').config?.initialRouteName).toBe('Main');
  expect(userMarketDetailBackAction({linkedPath: 'markets/perpl-direct-testnet-v1/32', canGoBack: true})).toBe('markets');
  expect(userMarketDetailBackAction({canGoBack: true})).toBe('back');
  expect(userMarketDetailBackAction({selectedSummaryId: 'summary-1', linkedPath: 'markets/perpl-direct-testnet-v1/32', canGoBack: true}))
    .toBe('clear-summary');
});

test('Developer linking keeps the existing stack contract', () => {
  expect(linkOptions('developer').config?.initialRouteName).toBeUndefined();
  expect(linkOptions('developer').config?.screens?.MarketDetail).toBe('markets/:venueId/:marketId');
});
