import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {StyleSheet, Text} from 'react-native';

let mockMode = 'user';
let mockConnected: boolean | null = false;
let mockInsetTop = 24;
jest.mock('@react-native-community/netinfo', () => ({useNetInfo: () => ({isConnected: mockConnected})}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: mockInsetTop, right: 0, bottom: 0, left: 0})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({
  presentationMode: mockMode, effectiveTheme: mockMode === 'user' ? 'candy-riot' : 'original',
})}));

import {ConnectivityBanner} from '../src/components/ConnectivityBanner';

test('User offline banner respects status-bar safe area and active theme', () => {
  mockMode = 'user'; mockConnected = false; mockInsetTop = 24;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => { renderer = ReactTestRenderer.create(<ConnectivityBanner />); });
  const text = renderer.root.findByType(Text);
  const style = StyleSheet.flatten(text.props.style);
  expect(text.props.children).toBe('Offline · showing last known data');
  expect(text.props.accessibilityRole).toBe('alert');
  expect(style.paddingTop).toBe(28);
  expect(style.backgroundColor).toBe('#FFEADB');
  expect(style.color).toBe('#4C214A');
  act(() => renderer.unmount());
});

test('Developer offline banner keeps its original copy and style', () => {
  mockMode = 'developer'; mockConnected = false;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => { renderer = ReactTestRenderer.create(<ConnectivityBanner />); });
  const text = renderer.root.findByType(Text);
  const style = StyleSheet.flatten(text.props.style);
  expect(text.props.children).toBe('You are offline. Displayed information may be out of date.');
  expect(style.paddingTop).toBeUndefined();
  expect(style.backgroundColor).toBe('#FFA552');
  act(() => renderer.unmount());
});

test('connected or unknown connectivity does not show a stale-data notice', () => {
  mockMode = 'user'; mockConnected = null;
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => { renderer = ReactTestRenderer.create(<ConnectivityBanner />); });
  expect(renderer.toJSON()).toBeNull();
  act(() => renderer.unmount());
  mockConnected = true;
  let connected!: ReactTestRenderer.ReactTestRenderer;
  act(() => { connected = ReactTestRenderer.create(<ConnectivityBanner />); });
  expect(connected.toJSON()).toBeNull();
  act(() => connected.unmount());
});
