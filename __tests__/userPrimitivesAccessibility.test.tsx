import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import * as Native from 'react-native';
import {UserPage, UserValueRow} from '../src/components/user/UserPrimitives';
import {userThemeTokens} from '../src/theme/userThemes';

jest.mock('react-native-safe-area-context', () => ({SafeAreaView: jest.requireActual('react-native').View}));

test.each([1, 1.5, 2])('value rows stack only when font scale %s needs more room', async fontScale => {
  const dimensions = jest.spyOn(jest.requireActual('react-native'), 'useWindowDimensions')
    .mockReturnValue({width: 320, height: 640, scale: 2, fontScale});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserValueRow theme={userThemeTokens('original')} label="Updated" value="12 Oct 2026, 9:45 PM" />); });
  const row = renderer.root.findByType(Native.View);
  expect(Native.StyleSheet.flatten(row.props.style).flexDirection).toBe(fontScale >= 1.35 ? 'column' : 'row');
  const value = renderer.root.findAllByType(Native.Text).find(node => node.props.children === '12 Oct 2026, 9:45 PM');
  expect(Native.StyleSheet.flatten(value!.props.style).textAlign).toBe(fontScale >= 1.35 ? 'left' : 'right');
  await act(async () => renderer.unmount());
  dimensions.mockRestore();
});

test('long technical values retain their label above a bounded, full-width value', async () => {
  jest.spyOn(jest.requireActual('react-native'), 'useWindowDimensions').mockReturnValue({width: 320, height: 640, scale: 2, fontScale: 1});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserValueRow theme={userThemeTokens('original')}
    label="Original operation ID" value="0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" />); });
  const value = renderer.root.findAllByType(Native.Text).find(node => String(node.props.children).startsWith('0x1234'))!;
  expect(Native.StyleSheet.flatten(value.props.style).alignSelf).toBe('stretch');
  expect(Native.StyleSheet.flatten(value.props.style).maxWidth).toBe('100%');
  const copy = renderer.root.findAllByType(Native.View).map(node => Native.StyleSheet.flatten(node.props.style))
    .find(style => style.minWidth === 0 && style.flex === 0);
  expect(copy).toBeDefined();
  await act(async () => renderer.unmount());
});

test('changing a selected run resets the existing UserPage scroll to the top', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserPage theme={userThemeTokens('original')} scrollResetKey="run-history"><Native.Text>History</Native.Text></UserPage>); });
  const scrollView = renderer.root.findByType(Native.ScrollView).instance as {scrollTo?: (options: {y: number; animated: boolean}) => void};
  const scrollTo = jest.fn();
  scrollView.scrollTo = scrollTo;
  await act(async () => { renderer.update(<UserPage theme={userThemeTokens('original')} scrollResetKey="selected-run-7"><Native.Text>Run 7</Native.Text></UserPage>); });
  expect(scrollTo).toHaveBeenCalledWith({y: 0, animated: false});
  await act(async () => renderer.unmount());
});
