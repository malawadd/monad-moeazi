import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockNavigation = {goBack: jest.fn()};
const mockClipboardSetString = jest.fn();
const mockConfirm = jest.fn();
const mockReject = jest.fn();
let mockApp: {mode: string; ownerAddress: string | null; busy: boolean; signIn: jest.Mock};
let mockPresentation: {effectiveTheme: string};

jest.mock('@react-navigation/native', () => ({useNavigation: () => mockNavigation}));
jest.mock('@react-native-clipboard/clipboard', () => ({__esModule: true, default: {setString: (...args: unknown[]) => mockClipboardSetString(...args)}}));
jest.mock('react-native-qrcode-svg', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  return ({value, size, color, backgroundColor}: {value: string; size: number; color: string; backgroundColor: string}) =>
    ReactRuntime.createElement(Native.View, {testID: 'mock-qr', value, size, color, backgroundColor});
});
jest.mock('../src/services/haptics', () => ({haptics: {confirm: () => mockConfirm(), reject: () => mockReject()}}));
jest.mock('../src/state/AppContext', () => ({useApp: () => mockApp}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => mockPresentation}));

import {UserReceiveScreen} from '../src/screens/UserReceiveScreen';
import {UserWelcomeScreen} from '../src/screens/UserWelcomeScreen';

const OWNER_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function button(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.find(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label);
}
function press(node: ReactTestRenderer.ReactTestInstance) {
  if (node.props.disabled) return;
  return node.props.onPress?.();
}
function content(renderer: ReactTestRenderer.ReactTestRenderer) { return JSON.stringify(renderer.toJSON()); }
async function flushPromises() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }

beforeEach(() => {
  jest.clearAllMocks();
  mockApp = {mode: 'unauthenticated', ownerAddress: null, busy: false, signIn: jest.fn().mockResolvedValue(undefined)};
  mockPresentation = {effectiveTheme: 'original'};
});

test('welcome routes sign-in and passkey creation through the existing Mera actions', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserWelcomeScreen />); });
  await act(async () => { button(renderer, 'Sign in with passkey').props.onPress(); await flushPromises(); });
  expect(mockApp.signIn).toHaveBeenNthCalledWith(1, 'signin');
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  await act(async () => { button(renderer, 'Create passkey').props.onPress(); await flushPromises(); });
  expect(mockApp.signIn).toHaveBeenNthCalledWith(2, 'create');
  expect(mockConfirm).toHaveBeenCalledTimes(2);
  await act(async () => renderer.unmount());
});

test('pending Mera sign-in marks both actions disabled, preventing repeat taps', async () => {
  let resolveSignIn!: () => void;
  mockApp.signIn = jest.fn(() => new Promise<void>(resolve => { resolveSignIn = resolve; }));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserWelcomeScreen />); });
  let pending!: Promise<void>;
  await act(async () => { pending = press(button(renderer, 'Sign in with passkey')); });
  mockApp.busy = true;
  await act(async () => renderer.update(<UserWelcomeScreen />));
  expect(button(renderer, 'Sign in with passkey').props.accessibilityState).toMatchObject({disabled: true, busy: true});
  expect(button(renderer, 'Create passkey').props.accessibilityState).toMatchObject({disabled: true, busy: false});
  await act(async () => {
    press(button(renderer, 'Sign in with passkey'));
    press(button(renderer, 'Create passkey'));
  });
  expect(mockApp.signIn).toHaveBeenCalledTimes(1);
  resolveSignIn();
  await act(async () => { await pending; });
  await act(async () => renderer.unmount());
});

test('provider disclosure stays open when the User theme changes', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserWelcomeScreen />); });
  await act(async () => button(renderer, 'Passkey provider help: Optional').props.onPress());
  expect(content(renderer)).toContain('WebAuthn PRF extension');
  mockPresentation.effectiveTheme = 'blueprint';
  await act(async () => renderer.update(<UserWelcomeScreen />));
  expect(content(renderer)).toContain('WebAuthn PRF extension');
  expect(content(renderer)).toContain('Google Password Manager or 1Password');
  await act(async () => renderer.unmount());
});

test('Receive requires an authenticated valid owner and copies only the displayed address', async () => {
  mockApp = {...mockApp, mode: 'authenticated', ownerAddress: OWNER_A};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserReceiveScreen />); });
  expect(renderer.root.findByProps({testID: 'mock-qr'}).props.value).toBe(OWNER_A);
  expect(content(renderer)).toContain(OWNER_A);
  await act(async () => button(renderer, 'Copy wallet address').props.onPress());
  expect(mockClipboardSetString).toHaveBeenCalledTimes(1);
  expect(mockClipboardSetString).toHaveBeenCalledWith(OWNER_A);
  expect(content(renderer)).toContain('Address copied. Select Monad Testnet before sending test tokens.');
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  mockPresentation.effectiveTheme = 'blueprint';
  await act(async () => renderer.update(<UserReceiveScreen />));
  expect(content(renderer)).toContain('Address copied. Select Monad Testnet before sending test tokens.');
  await act(async () => renderer.unmount());
});

test('owner changes clear copy feedback and never leave the previous QR or address visible', async () => {
  mockApp = {...mockApp, mode: 'authenticated', ownerAddress: OWNER_A};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserReceiveScreen />); });
  await act(async () => button(renderer, 'Copy wallet address').props.onPress());
  mockApp = {...mockApp, ownerAddress: OWNER_B};
  await act(async () => renderer.update(<UserReceiveScreen />));
  expect(renderer.root.findByProps({testID: 'mock-qr'}).props.value).toBe(OWNER_B);
  expect(content(renderer)).toContain(OWNER_B);
  expect(content(renderer)).not.toContain(OWNER_A);
  expect(content(renderer)).not.toContain('Address copied.');
  mockApp = {...mockApp, mode: 'unauthenticated'};
  await act(async () => renderer.update(<UserReceiveScreen />));
  expect(renderer.root.findAllByProps({testID: 'mock-qr'})).toHaveLength(0);
  expect(content(renderer)).toContain('Your wallet address is unavailable. Sign in again.');
  expect(content(renderer)).not.toContain(OWNER_B);
  await act(async () => renderer.unmount());
});

test('malformed authenticated owner addresses are not encoded or copied', async () => {
  mockApp = {...mockApp, mode: 'authenticated', ownerAddress: '0x1234'};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserReceiveScreen />); });
  expect(renderer.root.findAllByProps({testID: 'mock-qr'})).toHaveLength(0);
  expect(content(renderer)).toContain('Your wallet address is unavailable. Sign in again.');
  await act(async () => renderer.unmount());
});
