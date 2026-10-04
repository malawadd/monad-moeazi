import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {SlideToConfirm, shouldConfirmSlide} from '../src/components/SlideToConfirm';

jest.mock('../src/components/Motion', () => ({useReducedMotion: () => true}));

test('requires approximately 85 percent of available travel', () => {
  expect(shouldConfirmSlide(84, 100)).toBe(false);
  expect(shouldConfirmSlide(85, 100)).toBe(true);
  expect(shouldConfirmSlide(100, 0)).toBe(false);
});

test('TalkBack activation confirms without requiring a drag', async () => {
  const onConfirm = jest.fn(async () => undefined);
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<SlideToConfirm onConfirm={onConfirm} />);
  });
  const control = renderer!.root.findByProps({
    accessibilityLabel: 'Slide right to confirm safe USDC sending',
  });
  await act(async () => {
    control.props.onLayout({nativeEvent: {layout: {width: 300}}});
    control.props.onAccessibilityAction({nativeEvent: {actionName: 'activate'}});
    await Promise.resolve();
  });
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
