import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

jest.mock('react-native-svg', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Shape = ({children, ...props}: {children?: React.ReactNode; [key: string]: unknown}) =>
    ReactRuntime.createElement(Native.View, props, children);
  const Label = ({children, ...props}: {children?: React.ReactNode; [key: string]: unknown}) =>
    ReactRuntime.createElement(Native.Text, props, children);
  return {__esModule: true, default: Shape, Circle: Shape, Line: Shape, Path: Shape, Text: Label};
});

import {MarketChart} from '../src/components/MarketChart';

const candles = [
  {t: 1_700_000_000_000, o: 1, h: 1, l: 1, c: 1},
  {t: 1_700_000_001_000, o: 2, h: 2, l: 2, c: 2},
  {t: 1_700_000_004_000, o: 5, h: 5, l: 5, c: 5},
];

it('updates the accessible candle time and price when tapped and dragged', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<MarketChart candles={candles} candleTimeUnit="milliseconds" range="1D" onRangeChange={() => undefined} />);
  });

  const plot = renderer.root.find(node => node.props.accessibilityRole === 'image');
  const plotWidth = plot.props.style.width - 56 - 8;
  await act(async () => plot.props.onResponderGrant({nativeEvent: {locationX: 56 + plotWidth * 0.25}}));
  let readout = renderer.root.find(node => node.props.accessibilityRole === 'text');
  expect(readout.props.accessibilityLabel).toContain(`price 2`);
  expect(readout.props.accessibilityLabel).toContain(new Date(1_700_000_001_000).toLocaleString());

  await act(async () => plot.props.onResponderMove({nativeEvent: {locationX: 56 + plotWidth}}));
  readout = renderer.root.find(node => node.props.accessibilityRole === 'text');
  expect(readout.props.accessibilityLabel).toContain(`price 5`);
  expect(readout.props.accessibilityLabel).toContain(new Date(1_700_000_004_000).toLocaleString());

  await act(async () => renderer.unmount());
});
