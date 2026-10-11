import React, {useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Svg, {Circle, Line, Path, Text as SvgText} from 'react-native-svg';
import type {MarketCandle} from '../types/marketDirectory';
import {colors, spacing, type} from '../theme/tokens';
import {mapTimeToX, nearestIndex, normalizeCandleTimestamp, priceTicks} from '../services/marketChartMath';

export type ChartRange = '1H' | '6H' | '1D' | '1W';

export function MarketChart({candles, priceDecimals = 0, resolutionSeconds, candleTimeUnit, range, onRangeChange, observationLabel = 'Market observations'}: {
  candles: MarketCandle[]; priceDecimals?: number; resolutionSeconds?: number; candleTimeUnit?: 'milliseconds' | 'seconds';
  range: ChartRange; onRangeChange: (range: ChartRange) => void; observationLabel?: string;
}) {
  const {width: screenWidth} = useWindowDimensions();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const width = Math.max(260, Math.min(screenWidth - 62, 520));
  const height = 204;
  const axisLeft = 56;
  const axisBottom = 24;
  const insetTop = 10;
  const insetRight = 8;
  const plotWidth = width - axisLeft - insetRight;
  const plotHeight = height - insetTop - axisBottom;
  const points = useMemo(() => candles.map(candle => ({
    time: normalizeCandleTimestamp(candle.t, candleTimeUnit),
    value: scaled(candle.c, priceDecimals),
    source: candle,
  })).filter(point => Number.isFinite(point.value) && point.value > 0 && Number.isFinite(point.time))
    .sort((left, right) => left.time - right.time), [candles, candleTimeUnit, priceDecimals]);
  const hasPoints = points.length > 0;
  const rawLow = hasPoints ? Math.min(...points.map(point => point.value)) : 0;
  const rawHigh = hasPoints ? Math.max(...points.map(point => point.value)) : 1;
  const rawSpread = rawHigh - rawLow;
  const spread = rawSpread > 0 ? rawSpread : Math.max(Math.abs(rawHigh) * 0.01, Number.EPSILON);
  const low = rawSpread > 0 ? rawLow : rawLow - spread / 2;
  const high = rawSpread > 0 ? rawHigh : rawHigh + spread / 2;
  const xPositions = mapTimeToX(points.map(point => point.time), plotWidth);
  const coordinates = points.map((point, index) => ({
    x: axisLeft + xPositions[index],
    y: insetTop + (high - point.value) * plotHeight / (high - low),
  }));
  const path = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const latest = points.at(-1)?.value;
  const first = points[0]?.value;
  const rising = first !== undefined && latest !== undefined && latest >= first;
  const lineColor = rising ? '#267A42' : '#B42332';
  const fillPath = path && coordinates.length > 1
    ? `${path} L ${coordinates[coordinates.length - 1].x} ${height - axisBottom} L ${coordinates[0].x} ${height - axisBottom} Z`
    : '';
  const ticks = hasPoints ? priceTicks(low, high) : [];
  const latestCandle = points.at(-1)?.source;
  const candleAge = latestCandle ? Date.now() - points.at(-1)!.time : Number.NaN;
  const stale = Number.isFinite(candleAge) && resolutionSeconds !== undefined
    && candleAge > Math.max(180_000, resolutionSeconds * 3_000);
  const inspection = selectedIndex === null ? points.at(-1) : points[Math.min(selectedIndex, points.length - 1)];
  const selection = selectedIndex === null ? null : coordinates[Math.min(selectedIndex, coordinates.length - 1)];

  function selectAt(locationX: number) {
    if (!coordinates.length) return;
    const relativeX = Math.max(0, Math.min(plotWidth, locationX - axisLeft));
    const index = nearestIndex(relativeX, xPositions);
    setSelectedIndex(index);
  }

  return <View style={styles.wrap}>
    <View style={styles.ranges}>{(['1H', '6H', '1D', '1W'] as const).map(item => <Pressable
      key={item} accessibilityRole="button" accessibilityState={{selected: item === range}}
      onPress={() => { setSelectedIndex(null); onRangeChange(item); }} style={[styles.range, item === range && styles.rangeSelected]}>
      <Text style={styles.rangeLabel}>{item}</Text>
    </Pressable>)}</View>
    {hasPoints ? <View style={{width, height}} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
      onResponderGrant={event => selectAt(event.nativeEvent.locationX)} onResponderMove={event => selectAt(event.nativeEvent.locationX)}
      accessibilityRole="image" accessibilityLabel={`${observationLabel} price chart for ${range}`}>
      <Svg width={width} height={height} pointerEvents="none">
        {ticks.map((tick, index) => {
          const y = insetTop + (high - tick) * plotHeight / (high - low);
          return <React.Fragment key={`y-${index}`}>
            <Line x1={axisLeft} x2={width - insetRight} y1={y} y2={y} stroke={colors.ink} strokeWidth={1} opacity={0.13} />
            <SvgText x={axisLeft - 6} y={y + 3} fontSize={9} fill={colors.muted} textAnchor="end">{formatPrice(tick)}</SvgText>
          </React.Fragment>;
        })}
        <Line x1={axisLeft} x2={axisLeft} y1={insetTop} y2={height - axisBottom} stroke={colors.ink} strokeWidth={1} opacity={0.25} />
        <Line x1={axisLeft} x2={width - insetRight} y1={height - axisBottom} y2={height - axisBottom} stroke={colors.ink} strokeWidth={1} opacity={0.25} />
        <Path d={fillPath} fill={rising ? '#E3F3E5' : '#FBE3E6'} />
        <Path d={path} fill="none" stroke={lineColor} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {selection ? <>
          <Line x1={selection.x} x2={selection.x} y1={insetTop} y2={height - axisBottom} stroke={colors.ink} strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
          <Circle cx={selection.x} cy={selection.y} r={5} fill={lineColor} stroke={colors.paper} strokeWidth={2} />
        </> : null}
        {ticks.length ? <>
          <SvgText x={axisLeft} y={height - 6} fontSize={9} fill={colors.muted}>{formatTime(points[0].time, range)}</SvgText>
          <SvgText x={width - insetRight} y={height - 6} fontSize={9} fill={colors.muted} textAnchor="end">{formatTime(points.at(-1)!.time, range)}</SvgText>
        </> : null}
      </Svg>
    </View> : <View style={[styles.empty, {width, height}]}><Text style={styles.emptyText}>No {observationLabel.toLowerCase()} returned for this range.</Text></View>}
    {inspection ? <View accessible accessibilityRole="text" accessibilityLabel={`Selected candle ${new Date(inspection.time).toLocaleString()}, price ${formatPrice(inspection.value)}`} style={styles.inspection}>
      <Text style={styles.inspectionTitle}>{selectedIndex === null ? 'Latest candle' : 'Selected candle'}</Text>
      <Text style={styles.inspectionValue}>{formatPrice(inspection.value)}</Text>
      <Text style={styles.label}>{new Date(inspection.time).toLocaleString()}</Text>
    </View> : null}
    <View style={styles.axisLabels}><Text style={styles.label}>Time · {range}</Text><Text style={[styles.label, stale && styles.stale]}>{stale ? 'Stale data' : observationLabel}</Text></View>
    {latestCandle ? <Text style={[styles.label, stale && styles.stale]}>{stale ? 'Last candle' : 'Latest candle'} · {new Date(points.at(-1)!.time).toLocaleString()}</Text> : null}
  </View>;
}

function scaled(value: number | string, decimals: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / (10 ** decimals) : Number.NaN;
}

function formatPrice(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'Unavailable';
  const digits = value !== 0 && Math.abs(value) < 0.0001 ? Math.min(10, Math.max(4, -Math.floor(Math.log10(Math.abs(value))) + 2)) : 6;
  return value.toLocaleString(undefined, {maximumFractionDigits: digits});
}

function formatTime(time: number, range: ChartRange) {
  const date = new Date(time);
  return range === '1H' || range === '6H'
    ? date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})
    : date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

const styles = StyleSheet.create({
  wrap: {alignItems: 'center', gap: spacing.sm},
  ranges: {flexDirection: 'row', alignSelf: 'stretch', gap: 6},
  range: {flex: 1, minHeight: 40, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center'},
  rangeSelected: {backgroundColor: colors.yellow},
  rangeLabel: {...type.meta, color: colors.ink, fontSize: 10},
  empty: {borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: spacing.md},
  emptyText: {...type.body, color: colors.muted, textAlign: 'center'},
  axisLabels: {flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-between', gap: spacing.sm},
  label: {...type.meta, color: colors.muted, fontSize: 9, flexShrink: 1},
  inspection: {alignSelf: 'stretch', borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, padding: spacing.sm, gap: 2},
  inspectionTitle: {...type.meta, color: colors.muted, fontSize: 9},
  inspectionValue: {...type.display, color: colors.ink, fontSize: 19},
  stale: {color: '#9B352C'},
});
