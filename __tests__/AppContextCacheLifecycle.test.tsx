import React, {useEffect} from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockEvents: string[] = [];
let mockRefreshSession = jest.fn();
let mockCreateSession = jest.fn();
let mockChallenge = jest.fn();
let mockLogout = jest.fn();
let mockOpenSigningSession = jest.fn();
let mockClearSession = jest.fn();

jest.mock('../src/services/apiClient', () => ({
  mobileApi: {
    challenge: (...args: unknown[]) => mockChallenge(...args),
    createSession: (...args: unknown[]) => mockCreateSession(...args),
    logout: (...args: unknown[]) => mockLogout(...args),
  },
  refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
}));
jest.mock('../src/services/queryCache', () => ({clearOwnerScopedQueryCache: () => { mockEvents.push('cache.clear'); }}));
jest.mock('../src/services/sessionStore', () => ({clearSession: (...args: unknown[]) => mockClearSession(...args)}));
jest.mock('../src/services/deviceIdentity', () => ({getDeviceIdentity: async () => ({deviceId: 'device-1', deviceName: 'Test phone'})}));
jest.mock('../src/services/wallet/meraAuth', () => ({openMeraSigningSession: (...args: unknown[]) => mockOpenSigningSession(...args)}));
jest.mock('../src/services/notifications/NotificationClient', () => ({
  getNotificationPreferences: async () => ({enabled: false}),
  getPushRegistrationAdapter: () => ({registerDevice: async () => {}, unregisterDevice: async () => {}, subscribeForeground: () => () => {}}),
}));
jest.mock('../src/services/notifications/NotificationEvents', () => ({publishNotificationActivityRefresh: jest.fn()}));

import {AppProvider, useApp} from '../src/state/AppContext';
import type {PasskeyAction} from '../src/services/wallet/meraAuth';

const ownerA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ownerB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
let latest: ReturnType<typeof useApp> | null;

function session(address: string) {
  return {accessToken: 'access', refreshToken: 'refresh', expiresIn: 3600,
    session: {subject: `mera:${address.toLowerCase()}`, walletAddress: address, deviceId: 'device-1'}};
}
function Probe() {
  const state = useApp();
  latest = state;
  useEffect(() => { mockEvents.push(`commit:${state.mode}:${state.ownerAddress ?? 'none'}`); }, [state.mode, state.ownerAddress]);
  return null;
}
function renderProvider() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => { renderer = ReactTestRenderer.create(<AppProvider><Probe /></AppProvider>); });
  return renderer;
}
async function flush() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
async function restore(address = ownerA) {
  mockRefreshSession.mockResolvedValue(session(address));
  const renderer = renderProvider();
  await act(async () => { await flush(); });
  return renderer;
}

beforeEach(() => {
  mockEvents.length = 0; latest = null;
  mockRefreshSession = jest.fn().mockResolvedValue(session(ownerA));
  mockCreateSession = jest.fn().mockResolvedValue({session: session(ownerB).session});
  mockChallenge = jest.fn().mockResolvedValue({message: 'Sign in challenge', challengeToken: 'challenge'});
  mockLogout = jest.fn().mockResolvedValue(undefined);
  mockClearSession = jest.fn().mockResolvedValue(undefined);
  mockOpenSigningSession = jest.fn().mockResolvedValue({address: ownerB, signMessage: async () => 'signature', end: jest.fn()});
});

test('cold session restore clears the cache before committing the restored owner', async () => {
  const renderer = await restore();
  expect(latest?.mode).toBe('authenticated');
  expect(latest?.ownerAddress).toBe(ownerA);
  expect(mockEvents.indexOf('cache.clear')).toBeGreaterThan(-1);
  expect(mockEvents.indexOf('cache.clear')).toBeLessThan(mockEvents.indexOf(`commit:authenticated:${ownerA}`));
  await act(async () => renderer.unmount());
});

test('changing authenticated owners clears the previous cache before publishing the new owner', async () => {
  const renderer = await restore(ownerA);
  mockEvents.length = 0;
  await act(async () => { await latest?.signIn('signin' as PasskeyAction); await flush(); });
  expect(mockEvents.indexOf('cache.clear')).toBeGreaterThan(-1);
  expect(mockEvents.indexOf('cache.clear')).toBeLessThan(mockEvents.indexOf(`commit:authenticated:${ownerB}`));
  expect(latest?.ownerAddress).toBe(ownerB);
  await act(async () => renderer.unmount());
});

test('logout clears owner query data before committing signed-out state without changing preference or journal storage', async () => {
  const renderer = await restore(ownerA);
  mockEvents.length = 0;
  await act(async () => { await latest?.signOut(); await flush(); });
  expect(mockEvents.indexOf('cache.clear')).toBeGreaterThan(-1);
  expect(mockEvents.indexOf('cache.clear')).toBeLessThan(mockEvents.indexOf('commit:signed-out:none'));
  expect(mockClearSession).toHaveBeenCalledTimes(1);
  expect(latest?.ownerAddress).toBeNull();
  await act(async () => renderer.unmount());
});

test('entering preview clears authenticated query data before dropping the owner', async () => {
  const renderer = await restore(ownerA);
  mockEvents.length = 0;
  act(() => latest?.enterPreview());
  expect(mockEvents.indexOf('cache.clear')).toBeGreaterThan(-1);
  expect(mockEvents.indexOf('cache.clear')).toBeLessThan(mockEvents.indexOf('commit:preview:none'));
  expect(latest?.ownerAddress).toBeNull();
  await act(async () => renderer.unmount());
});
