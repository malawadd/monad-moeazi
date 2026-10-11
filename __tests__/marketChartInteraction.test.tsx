import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

jest.mock('react-native-svg', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Shape = ({children, ...props}: {children?: React.ReactNode; [key: string]: unknown}) =>
    ReactRuntime.createElement(Native.View, props, children);
  const Label = ({children, ...props}: {children?: React.ReactNode; [key: string]: unknown}) =>
    ReactRuntime.createElement(Native.Text, props, children);
  return {__esModule: true, default: Shape, Circle: Shape, Line: Shape, Path: Shape, Rect: Shape, Text: Label};
});
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import {MarketChart} from '../src/components/MarketChart';

const candles = [
  {t: 1_700_000_000_000, o: 1, h: 1, l: 1, c: 1},
  {t: 1_700_000_001_000, o: 2, h: 2, l: 2, c: 2},
  {t: 1_700_000_004_000, o: 5, h: 5, l: 5, c: 5},
];

it('updates the inspected candle time and price when tapped', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<MarketChart candles={candles} candleTimeUnit="milliseconds" range="1D" onRangeChange={() => undefined} />);
  });

  const plot = renderer.root.find(node => node.props.accessibilityRole === 'image');
  expect(plot.props.accessibilityLabel).toContain('candles chart for 1D');
  const candleTargets = renderer.root.findAll(node => node.props.fill === 'transparent' && typeof node.props.onPress === 'function');
  const xPositions = [...new Set(candleTargets.map(node => node.props.x))].sort((a, b) => a - b);
  expect(xPositions).toHaveLength(3);
  const middleTarget = candleTargets.find(node => node.props.x === xPositions[1]);
  await act(async () => middleTarget?.props.onPress());
  const labels = renderer.root.findAll(node => typeof node.props.children === 'string').map(node => node.props.children);
  expect(labels).toContain('Selected candle');
  expect(labels).toContain('2');
  expect(labels).toContain(new Date(1_700_000_001_000).toLocaleString());

  await act(async () => renderer.unmount());
});
