import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Dimensions, StyleSheet, Text} from 'react-native';

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
import {contrastRatio, USER_THEME_CATALOG, userThemeTokens} from '../src/theme/userThemes';

function setViewport(width: number, fontScale: number) {
  const metrics = {width, height: 800, scale: 1, fontScale};
  Dimensions.set({window: metrics, screen: metrics} as any);
}

beforeEach(() => setViewport(393, 1));

const candles = [
  {t: 1_800_000_000_000, o: 1, h: 2, l: 1, c: 1.2, v: 4},
  {t: 1_800_000_060_000, o: 1.2, h: 4, l: 1, c: 3, v: 6},
  {t: 1_800_000_120_000, o: 3, h: 5, l: 2, c: 4.8, v: 8},
];
const overlays = (themeSurface: string) => [
  {id: 'entry', label: 'Entry line', kind: 'entry' as const, price: 2, color: themeSurface},
  {id: 'liquidation', label: 'Liquidation line', kind: 'liquidation' as const, price: 2.2},
  {id: 'take-profit', label: 'Target line', kind: 'take_profit' as const, price: 2.4},
  {id: 'stop-loss', label: 'Stop line', kind: 'stop_loss' as const, price: 2.6},
  {id: 'pending', label: 'Pending line', kind: 'pending' as const, price: 2.8},
  {id: 'fill-entry', label: 'Entry fill', kind: 'fill_entry' as const, price: 3},
  {id: 'fill-exit', label: 'Exit fill', kind: 'fill_exit' as const, price: 3.2},
];

it.each(USER_THEME_CATALOG.map(theme => theme.id))('keeps chart labels and marked lines readable in %s', async themeId => {
  const theme = userThemeTokens(themeId);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<MarketChart candles={candles} candleTimeUnit="milliseconds"
    range="1D" onRangeChange={jest.fn()} markPrice={3} liveUpdatedAt={1_800_000_120_000} theme={theme}
    overlays={overlays(theme.surface)} />); });

  const svgLabels = renderer.root.findAll(node => typeof node.props.fill === 'string' && node.props.children != null);
  expect(svgLabels.length).toBeGreaterThan(0);
  for (const label of svgLabels) {
    const ratio = contrastRatio(label.props.fill, theme.surface);
    if (ratio < 4.5) throw new Error(`SVG label ${String(label.props.children)} uses ${label.props.fill} at ${ratio}:1 on ${theme.surface}`);
  }
  const markedLines = renderer.root.findAll(node => node.props.x1 !== undefined && node.props.y1 !== undefined
    && typeof node.props.stroke === 'string' && Number(node.props.strokeWidth) >= 1.4);
  expect(markedLines.length).toBeGreaterThan(0);
  for (const line of markedLines) {
    const ratio = contrastRatio(line.props.stroke, theme.surface);
    if (ratio < 3) throw new Error(`SVG line uses ${line.props.stroke} at ${ratio}:1 on ${theme.surface}`);
  }

  const entryLabel = svgLabels.find(node => JSON.stringify(node.props.children).includes('Entry line'));
  expect(entryLabel).toBeTruthy();
  expect(entryLabel?.props.fill).not.toBe(theme.surface);
  await act(async () => renderer.unmount());
});

it('keeps all User chart controls at least 48 dp and leaves Developer controls unchanged', async () => {
  let userRenderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { userRenderer = ReactTestRenderer.create(<MarketChart candles={candles} candleTimeUnit="milliseconds"
    range="1D" onRangeChange={jest.fn()} connectionStatus="connected" liveUpdatedAt={1_800_000_120_000}
    theme={userThemeTokens('original')} />); });
  const optionsText = userRenderer.root.findAllByType(Text).find(node => node.props.children === 'Chart options ▾');
  await act(async () => optionsText?.parent?.props.onPress());
  const userControls = userRenderer.root.findAll(node => node.props.accessibilityRole === 'button');
  expect(userControls.length).toBeGreaterThan(10);
  expect(userControls.every(node => (StyleSheet.flatten(node.props.style)?.minHeight ?? 0) >= 48)).toBe(true);
  await act(async () => userRenderer.unmount());

  let developerRenderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { developerRenderer = ReactTestRenderer.create(<MarketChart candles={candles} candleTimeUnit="milliseconds"
    range="1D" onRangeChange={jest.fn()} />); });
  const developerSelectedHeights = developerRenderer.root.findAll(node => node.props.accessibilityRole === 'button'
    && node.props.accessibilityState?.selected).map(node => StyleSheet.flatten(node.props.style)?.minHeight);
  expect(developerSelectedHeights).toContain(36);
  await act(async () => developerRenderer.unmount());
});

it('sizes User chart to the measured 320 dp card content width', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<MarketChart candles={candles} candleTimeUnit="milliseconds"
    range="1D" onRangeChange={jest.fn()} theme={userThemeTokens('original')} />); });
  const chartFrame = renderer.root.find(node => typeof node.props.onLayout === 'function');
  await act(async () => chartFrame.props.onLayout({nativeEvent: {layout: {width: 245}}}));
  expect(renderer.root.findAll(node => node.props.style?.width === 245).length).toBeGreaterThan(0);
  await act(async () => renderer.unmount());
});

it('wraps long User legend entries inside the measured small-phone chart width', async () => {
  const label = 'Manual liquidation estimate';
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<MarketChart candles={candles} candleTimeUnit="milliseconds"
    range="1D" onRangeChange={jest.fn()} theme={userThemeTokens('original')}
    overlays={[{id: 'manual-liquidation', label, kind: 'liquidation', price: 2.2, source: 'manual'}]} />); });
  const chartFrame = renderer.root.find(node => typeof node.props.onLayout === 'function');
  await act(async () => chartFrame.props.onLayout({nativeEvent: {layout: {width: 245}}}));
  const legendItem = renderer.root.findAllByProps({testID: 'market-chart-legend-item'})
    .find(node => String(node.props.accessibilityLabel).startsWith(label));
  expect(legendItem).toBeTruthy();
  const itemStyle = StyleSheet.flatten(legendItem!.props.style);
  expect(itemStyle?.maxWidth).toBe('100%');
  expect(itemStyle?.flexShrink).toBe(1);
  const text = legendItem!.find(node => typeof node.props.children === 'string');
  const textStyle = StyleSheet.flatten(text.props.style);
  expect(textStyle?.flexShrink).toBe(1);
  expect(textStyle?.maxWidth).toBe('100%');
  const legend = renderer.root.findByProps({testID: 'market-chart-legend'});
  expect(StyleSheet.flatten(legend.props.style)?.width).toBe('100%');
  await act(async () => renderer.unmount());
});

it('stacks User controls and candle details at 320 dp and font scale 2 without changing Developer layout', async () => {
  setViewport(320, 2);
  let userRenderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { userRenderer = ReactTestRenderer.create(<MarketChart candles={candles} candleTimeUnit="milliseconds"
    range="1D" onRangeChange={jest.fn()} connectionStatus="connected" liveUpdatedAt={1_800_000_120_000}
    theme={userThemeTokens('original')} />); });
  const userControls = StyleSheet.flatten(userRenderer.root.findByProps({testID: 'market-chart-controls'}).props.style);
  const options = StyleSheet.flatten(userRenderer.root.findByProps({testID: 'market-chart-options'}).props.style);
  const inspectionHeader = StyleSheet.flatten(userRenderer.root.findByProps({testID: 'market-chart-inspection-header'}).props.style);
  const ohlc = StyleSheet.flatten(userRenderer.root.findByProps({testID: 'market-chart-ohlc'}).props.style);
  const ohlcCells = userRenderer.root.findAllByProps({testID: 'market-chart-ohlc-cell'});
  const footer = StyleSheet.flatten(userRenderer.root.findByProps({testID: 'market-chart-footer-axis'}).props.style);
  const liveStatus = userRenderer.root.findByProps({testID: 'market-chart-footer-status'});
  const updated = StyleSheet.flatten(userRenderer.root.findByProps({testID: 'market-chart-footer-updated'}).props.style);
  expect(userControls?.flexWrap).toBe('wrap');
  expect(options?.width).toBe('100%');
  expect(inspectionHeader?.flexDirection).toBe('column');
  expect(ohlc?.flexWrap).toBe('wrap');
  expect(footer?.flexDirection).toBe('column');
  expect(liveStatus.props.children).toBe('LIVE');
  expect(StyleSheet.flatten(liveStatus.props.style)?.flexShrink).toBe(0);
  expect(updated?.flexShrink).toBe(0);
  expect(ohlcCells.length).toBeGreaterThanOrEqual(4);
  expect(ohlcCells.every(node => node.props.testID === 'market-chart-ohlc-cell'
    && StyleSheet.flatten(node.props.style)?.flexBasis === '48%')).toBe(true);
  await act(async () => userRenderer.unmount());

  let developerRenderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { developerRenderer = ReactTestRenderer.create(<MarketChart candles={candles} candleTimeUnit="milliseconds"
    range="1D" onRangeChange={jest.fn()} />); });
  expect(developerRenderer.root.findAllByProps({testID: 'market-chart-controls'})).toHaveLength(0);
  expect(developerRenderer.root.findAllByProps({testID: 'market-chart-inspection-header'})).toHaveLength(0);
  expect(developerRenderer.root.findAllByProps({testID: 'market-chart-footer-axis'})).toHaveLength(0);
  await act(async () => developerRenderer.unmount());
});
