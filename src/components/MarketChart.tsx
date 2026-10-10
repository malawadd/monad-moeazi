import React from 'react';
import {Pressable, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Svg, {Line, Path} from 'react-native-svg';
import type {MarketCandle} from '../types/marketDirectory';
import {colors, spacing, type} from '../theme/tokens';

export type ChartRange = '1H' | '6H' | '1D' | '1W';

export function MarketChart({candles, priceDecimals = 0, resolutionSeconds, range, onRangeChange}: {
  candles: MarketCandle[]; priceDecimals?: number; resolutionSeconds?: number; range: ChartRange; onRangeChange: (range: ChartRange) => void;
}) {
  const {width: screenWidth} = useWindowDimensions();
  const width = Math.max(220, Math.min(screenWidth - 62, 520));
  const height = 168;
  const points = candles.map(candle => ({time: candle.t, value: scaled(candle.c, priceDecimals)}))
    .filter(point => Number.isFinite(point.value) && point.value > 0);
  const values = points.map(point => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = Math.max(high - low, Math.max(high * 0.001, 0.000001));
  const inset = 10;
  const chartWidth = width - inset * 2;
  const chartHeight = height - inset * 2;
  const coordinates = points.map((point, index) => ({
    x: inset + (points.length <= 1 ? chartWidth : index * chartWidth / (points.length - 1)),
    y: inset + (high - point.value) * chartHeight / spread,
  }));
  const path = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const latest = points.at(-1)?.value;
  const first = points[0]?.value;
  const latestCandle = candles.at(-1);
  const candleTime = latestCandle ? Number(latestCandle.t) : Number.NaN;
  const candleAge = Number.isFinite(candleTime) ? Date.now() - candleTime : Number.NaN;
  const stale = Number.isFinite(candleAge) && resolutionSeconds !== undefined
    && candleAge > Math.max(180_000, resolutionSeconds * 3_000);
  const rising = first !== undefined && latest !== undefined && latest >= first;
  const lineColor = rising ? '#267A42' : '#B42332';
  const fillPath = path && coordinates.length > 1
    ? `${path} L ${coordinates[coordinates.length - 1].x} ${height - inset} L ${coordinates[0].x} ${height - inset} Z`
    : '';

  return <View style={styles.wrap}>
    <View style={styles.ranges}>{(['1H', '6H', '1D', '1W'] as const).map(item => <Pressable
      key={item} accessibilityRole="button" accessibilityState={{selected: item === range}}
      onPress={() => onRangeChange(item)} style={[styles.range, item === range && styles.rangeSelected]}>
      <Text style={styles.rangeLabel}>{item}</Text>
    </Pressable>)}</View>
    {coordinates.length > 1 ? <Svg width={width} height={height} accessibilityRole="image"
      accessibilityLabel={`Price chart for ${range}, from ${formatPrice(first)} to ${formatPrice(latest)}`}>
      <Line x1={inset} x2={width - inset} y1={height - inset} y2={height - inset} stroke={colors.ink} strokeWidth={1} opacity={0.25} />
      <Path d={fillPath} fill={rising ? '#E3F3E5' : '#FBE3E6'} />
      <Path d={path} fill="none" stroke={lineColor} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
    </Svg> : <View style={[styles.empty, {width, height}]}><Text style={styles.emptyText}>No candle history returned for this range.</Text></View>}
    <View style={styles.labels}><Text style={styles.label}>{candles.length ? new Date(candles[0].t).toLocaleString() : '—'}</Text>
      <Text style={styles.label}>Latest · {formatPrice(latest)}</Text></View>
    {latestCandle ? <Text style={[styles.label, stale && styles.stale]}>{stale ? 'Stale candle data' : 'Latest candle'} · {new Date(latestCandle.t).toLocaleString()}</Text> : null}
  </View>;
}

function scaled(value: number | string, decimals: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / (10 ** decimals) : Number.NaN;
}
function formatPrice(value?: number) { return value === undefined || !Number.isFinite(value) ? 'Unavailable' : value.toLocaleString(undefined, {maximumFractionDigits: 6}); }

const styles = StyleSheet.create({
  wrap: {alignItems: 'center', gap: spacing.sm},
  ranges: {flexDirection: 'row', alignSelf: 'stretch', gap: 6},
  range: {flex: 1, minHeight: 40, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center'},
  rangeSelected: {backgroundColor: colors.yellow},
  rangeLabel: {...type.meta, color: colors.ink, fontSize: 10},
  empty: {borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: spacing.md},
  emptyText: {...type.body, color: colors.muted, textAlign: 'center'},
  labels: {flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-between', gap: spacing.sm},
  label: {...type.meta, color: colors.muted, fontSize: 8, flexShrink: 1},
  stale: {color: '#9B352C'},
});
