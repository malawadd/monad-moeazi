import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Svg, {Circle, Line, Path, Rect, Text as SvgText} from 'react-native-svg';
import type {MarketCandle, MarketTradeSummary} from '../types/marketDirectory';
import type {ChartLivePnl, ChartOverlay, ChartRange} from '../types/marketChart';
import {useChartSettings} from '../services/chartSettings';
import {colors, spacing, type} from '../theme/tokens';
import {mapTimeToX, nearestIndex, normalizeCandleTimestamp, priceTicks, visiblePriceRange} from '../services/marketChartMath';

export type {ChartRange} from '../types/marketChart';
export type MarketChartProps = {
  candles: MarketCandle[]; priceDecimals?: number; sizeDecimals?: number; resolutionSeconds?: number; candleTimeUnit?: 'milliseconds' | 'seconds';
  range: ChartRange; onRangeChange: (range: ChartRange) => void; observationLabel?: string;
  livePrice?: number | string | null; markPrice?: number | string | null; liveUpdatedAt?: number | null;
  connectionStatus?: 'connected' | 'reconnecting' | 'disconnected'; overlays?: ChartOverlay[]; trades?: MarketTradeSummary[];
  livePnl?: ChartLivePnl[];
};

type Point = {time: number; value: number; raw: MarketCandle};
const OVERLAY_COLORS: Record<ChartOverlay['kind'], string> = {
  entry: '#6B49C8', liquidation: '#C62836', take_profit: '#168348', stop_loss: '#E25368',
  pending: '#66636D', fill_entry: '#19878B', fill_exit: '#AB65A5',
};

export function MarketChart({candles, priceDecimals = 0, sizeDecimals = 0, resolutionSeconds, candleTimeUnit, range, onRangeChange,
  observationLabel = 'Market observations', livePrice, markPrice, liveUpdatedAt, connectionStatus, overlays = [], trades = [], livePnl = []}: MarketChartProps) {
  const {width: screenWidth} = useWindowDimensions();
  const {settings, update: updateSettings, loading: settingsLoading} = useChartSettings();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [quickOptions, setQuickOptions] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [browsingHistory, setBrowsingHistory] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrolledAway = useRef(false);
  const displayedRange = useRef(range);
  const syncedRange = useRef(false);
  const viewportWidth = Math.max(260, Math.min(screenWidth - 62, 520));
  const height = 236, axisLeft = 61, axisBottom = 25, insetTop = 12, insetRight = 6, volumeHeight = settings.showVolume ? 35 : 0;
  const plotHeight = height - insetTop - axisBottom - volumeHeight;
  const spacingX = 13;
  const points = useMemo<Point[]>(() => candles.map(raw => ({time: normalizeCandleTimestamp(raw.t, candleTimeUnit), value: scaled(raw.c, priceDecimals), raw}))
    .filter(item => Number.isFinite(item.time) && item.value > 0).sort((a, b) => a.time - b.time), [candles, candleTimeUnit, priceDecimals]);
  const historyMarkers = useMemo(() => trades.flatMap(item => {
    if (!hasVerifiedReference(item)) return [];
    const markers: Array<{id: string; label: string; price: number; time: number; kind: 'entry' | 'exit'; source: string}> = [];
    if (item.weightedEntryPrice != null && item.entryAt != null) markers.push({id: `${item.summaryId}:entry`, label: 'Entry', price: scaled(item.weightedEntryPrice, item.priceDecimals ?? priceDecimals), time: toMillis(item.entryAt), kind: 'entry', source: item.source});
    if (isFinalizedClose(item.status) && item.weightedExitPrice != null && item.exitAt != null) markers.push({id: `${item.summaryId}:exit`, label: 'Exit', price: scaled(item.weightedExitPrice, item.priceDecimals ?? priceDecimals), time: toMillis(item.exitAt), kind: 'exit', source: item.source});
    return markers;
  }).filter(marker => Number.isFinite(marker.price) && marker.price > 0), [trades, priceDecimals]);
  const visibleOverlays = overlays.filter(item => item.source !== 'manual' || settings.showManualPositions)
    .filter(item => item.source !== 'autonomous' || settings.showAutonomousPositions)
    .filter(item => settings.showRiskLevels || !['liquidation', 'take_profit', 'stop_loss'].includes(item.kind));
  const currentLast = validPrice(livePrice) ? scaled(livePrice!, priceDecimals) : points.at(-1)?.value;
  const currentMark = validPrice(markPrice) ? scaled(markPrice!, priceDecimals) : undefined;
  const firstTime = points[0]?.time ?? 0, lastTime = points.at(-1)?.time ?? 0;
  const visibleHistory = settings.showTradeMarkers ? historyMarkers.filter(marker => marker.time >= firstTime && marker.time <= lastTime + (resolutionSeconds ?? 60) * 1000) : [];
  const plotViewportWidth = Math.max(150, viewportWidth - axisLeft);
  const chartWidth = Math.max(plotViewportWidth, Math.max(1, points.length - 1) * spacingX + 25);
  const plotWidth = chartWidth - insetRight;
  const xPositions = mapTimeToX(points.map(item => item.time), plotWidth);
  const latestOffset = Math.max(0, chartWidth - plotViewportWidth);
  const atLatest = !browsingHistory || scrollOffset >= latestOffset - 24;
  const visibleOffset = browsingHistory ? scrollOffset : latestOffset;
  const priceRange = visiblePriceRange(points.map(point => ({o: scaled(point.raw.o, priceDecimals),
    h: scaled(point.raw.h, priceDecimals), l: scaled(point.raw.l, priceDecimals), c: point.value})),
  xPositions, visibleOffset, plotViewportWidth, atLatest ? [currentLast ?? Number.NaN, settings.showMarkPrice ? currentMark ?? Number.NaN : Number.NaN] : []);
  const {low, high} = priceRange;
  const coords = points.map((point, index) => ({x: xPositions[index], y: insetTop + (high - point.value) * plotHeight / (high - low)}));
  const chartPath = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const isRising = (points.at(-1)?.value ?? 0) >= (points[0]?.value ?? 0), stroke = isRising ? '#168348' : '#C62836';
  const ticks = points.length ? priceTicks(low, high) : [];
  const maxVolume = Math.max(1, ...points.map(point => Number(point.raw.v) || 0));
  const selected = selectedIndex === null ? points.at(-1) : points[Math.min(selectedIndex, points.length - 1)];
  const selectedAt = selectedIndex === null ? coords.at(-1) : coords[Math.min(selectedIndex, coords.length - 1)];
  const latestAge = liveUpdatedAt ? Date.now() - liveUpdatedAt : selected ? Date.now() - selected.time : Number.NaN;
  const stale = connectionStatus === 'disconnected' || connectionStatus === 'reconnecting'
    || (Number.isFinite(latestAge) && latestAge > Math.max(60_000, (resolutionSeconds ?? 60) * 3_000));
  const visiblePnl = !stale && settings.showPnl ? livePnl.filter(item => item.status === 'estimate'
    && /^-?\d+$/.test(item.amountUnits)
    && (item.source === 'manual' ? settings.showManualPositions : settings.showAutonomousPositions)) : [];

  useEffect(() => {
    if (!settingsLoading && !syncedRange.current) { syncedRange.current = true; if (range !== settings.defaultRange) onRangeChange(settings.defaultRange); }
  }, [settingsLoading, settings.defaultRange, range, onRangeChange]);
  useEffect(() => {
    if (displayedRange.current !== range) { displayedRange.current = range; scrolledAway.current = false; setBrowsingHistory(false); setSelectedIndex(null); }
    if (!scrolledAway.current) {
      setScrollOffset(latestOffset);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({x: latestOffset, animated: false}));
    }
  }, [range, latestOffset, points.length, liveUpdatedAt]);
  const yFor = (price: number) => insetTop + (high - price) * plotHeight / (high - low);
  const selectAt = (x: number) => { if (!points.length) return; setSelectedIndex(nearestIndex(Math.max(0, Math.min(plotWidth, x)), xPositions)); };

  return <View style={styles.wrap}>
    <View style={styles.controls}>
      {(['candles', 'line'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{selected: settings.display === value}}
        onPress={() => updateSettings({display: value})} style={[styles.control, settings.display === value && styles.selected]}><Text style={styles.controlText}>{value === 'candles' ? 'Candles' : 'Line'}</Text></Pressable>)}
      <Pressable accessibilityRole="button" accessibilityState={{expanded: quickOptions}} onPress={() => setQuickOptions(value => !value)} style={styles.options}><Text style={styles.controlText}>{quickOptions ? 'Hide options' : 'Chart options'} ▾</Text></Pressable>
    </View>
    {quickOptions ? <View style={styles.quickRow}>{[
      {key: 'showMarkPrice' as const, label: 'Mark'}, {key: 'showVolume' as const, label: 'Volume'},
      {key: 'showManualPositions' as const, label: 'Manual'}, {key: 'showAutonomousPositions' as const, label: 'Auto'},
      {key: 'showRiskLevels' as const, label: 'Risk'}, {key: 'showTradeMarkers' as const, label: 'Fills'},
      {key: 'showPnl' as const, label: 'PnL'},
    ].map(option => <Pressable key={option.key} accessibilityRole="button" accessibilityState={{selected: settings[option.key]}}
      onPress={() => updateSettings({[option.key]: !settings[option.key]})} style={[styles.quickChip, settings[option.key] && styles.quickSelected]}><Text style={styles.quickText}>{option.label}</Text></Pressable>)}</View> : null}
    <View style={styles.ranges}>{(['1H', '6H', '1D', '1W'] as const).map(item => <Pressable key={item} accessibilityRole="button"
      accessibilityState={{selected: item === range}} onPress={() => {scrolledAway.current = false; setBrowsingHistory(false); setSelectedIndex(null); onRangeChange(item); updateSettings({defaultRange: item});}}
      style={[styles.range, item === range && styles.selected]}><Text style={styles.controlText}>{item}</Text></Pressable>)}</View>
    {points.length ? <View style={{width: viewportWidth, height, flexDirection: 'row'}}>
      <Svg width={axisLeft} height={height}>
        {ticks.map((tick, index) => { const y = yFor(tick); return <React.Fragment key={`axis-${index}`}>
          <Line x1={axisLeft - 5} x2={axisLeft - 1} y1={y} y2={y} stroke={colors.ink} opacity={0.3} />
          <SvgText x={axisLeft - 8} y={y + 3} fontSize={9} fill={colors.muted} textAnchor="end">{formatPrice(tick)}</SvgText>
        </React.Fragment>; })}
        <Line x1={axisLeft - 1} x2={axisLeft - 1} y1={insetTop} y2={height - axisBottom} stroke={colors.ink} opacity={0.3} />
      </Svg>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator onScrollBeginDrag={() => {
      scrolledAway.current = true; setBrowsingHistory(true);
    }} onScroll={event => {
      const x = event.nativeEvent.contentOffset.x;
      if (Math.abs(x - scrollOffset) > 4) setScrollOffset(x);
    }} onScrollEndDrag={event => {
      scrolledAway.current = event.nativeEvent.contentOffset.x < latestOffset - 24;
      setBrowsingHistory(scrolledAway.current);
      setScrollOffset(event.nativeEvent.contentOffset.x);
    }} onMomentumScrollEnd={event => {
      scrolledAway.current = event.nativeEvent.contentOffset.x < latestOffset - 24;
      setBrowsingHistory(scrolledAway.current);
      setScrollOffset(event.nativeEvent.contentOffset.x);
    }} scrollEventThrottle={120} style={{width: plotViewportWidth}} contentContainerStyle={{width: chartWidth}}>
      <Svg width={chartWidth} height={height} accessibilityRole="image" accessibilityLabel={`${observationLabel} ${settings.display} chart for ${range}`}>
        {ticks.map((tick, index) => <Line key={`grid-${index}`} x1={0} x2={chartWidth - insetRight} y1={yFor(tick)} y2={yFor(tick)} stroke={colors.ink} strokeWidth={1} opacity={0.12} />)}
        <Line x1={0} x2={chartWidth - insetRight} y1={height - axisBottom} y2={height - axisBottom} stroke={colors.ink} opacity={0.3} />
      {settings.showVolume && points.map((point, index) => { const x = xPositions[index], value = Number(point.raw.v) || 0;
          const barHeight = (value / maxVolume) * (volumeHeight - 4); return <Rect key={`vol-${point.time}`} x={x - 2} y={height - axisBottom - barHeight}
            width={4} height={barHeight} fill={(Number(point.raw.c) >= Number(point.raw.o)) ? '#168348' : '#C62836'} opacity={0.22} />; })}
        {settings.display === 'line' ? <>
          {coords.length > 1 ? <Path d={`${chartPath} L ${coords.at(-1)!.x} ${height - axisBottom - volumeHeight} L ${coords[0].x} ${height - axisBottom - volumeHeight} Z`} fill={isRising ? '#168348' : '#C62836'} opacity={0.1} /> : null}
          <Path d={chartPath} fill="none" stroke={stroke} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
        </> : points.map((point, index) => <Candle key={`candle-${point.time}`} candle={point.raw} x={xPositions[index]} yFor={yFor} priceDecimals={priceDecimals} />)}
        {points.map((point, index) => <Rect key={`inspect-${point.time}`} x={xPositions[index] - spacingX / 2} y={insetTop} width={spacingX} height={height - axisBottom - insetTop}
          fill="transparent" onPress={() => selectAt(xPositions[index])} />)}
        {visibleOverlays.map(overlay => { const price = scaled(overlay.price, priceDecimals); if (!(price > 0)) return null;
          const color = overlay.color ?? OVERLAY_COLORS[overlay.kind], rawY = yFor(price), y = Math.max(insetTop + 8, Math.min(height - axisBottom - volumeHeight - 3, rawY));
          const offRange = rawY < insetTop || rawY > height - axisBottom - volumeHeight, dash = overlay.kind === 'pending' || overlay.status === 'estimate' ? '5 3' : '2 2';
          if (offRange) return <SvgText key={overlay.id} x={4} y={y} fontSize={9} fill={color}>{rawY < insetTop ? '↑' : '↓'} {overlay.label} {formatPrice(price)}</SvgText>;
          return <React.Fragment key={overlay.id}><Line x1={0} x2={chartWidth - insetRight} y1={y} y2={y} stroke={color} strokeWidth={overlay.kind === 'liquidation' ? 2 : 1.5} strokeDasharray={dash} />
            <SvgText x={4} y={Math.max(insetTop + 8, y - 4)} fontSize={9} fill={color}>{overlay.label}{overlay.status === 'estimate' ? ' · est.' : ''}</SvgText></React.Fragment>;
        })}
        {visibleHistory.map(marker => { const x = timeToX(marker.time, points, xPositions); const rawY = yFor(marker.price); const color = marker.kind === 'entry' ? '#16878B' : '#AB65A5';
          if (rawY < insetTop || rawY > height - axisBottom - volumeHeight) return <SvgText key={marker.id} x={Math.max(4, x)} y={rawY < insetTop ? insetTop + 18 : height - axisBottom - volumeHeight - 6} fontSize={8} fill={color}>{marker.source === 'autonomous' ? 'AUTO ' : ''}{marker.label} {formatPrice(marker.price)}</SvgText>;
          const y = rawY;
          return <React.Fragment key={marker.id}><Line x1={x} x2={x} y1={insetTop} y2={height - axisBottom - volumeHeight} stroke={color} strokeDasharray="3 3" />
            <Circle cx={x} cy={y} r={4} fill={color} stroke={colors.paper} strokeWidth={1.5} /><SvgText x={x + 5} y={y - 5} fontSize={8} fill={color}>{marker.source === 'autonomous' ? 'AUTO ' : ''}{marker.label}</SvgText></React.Fragment>;
        })}
        {currentLast && currentLast > 0 ? <><Line x1={0} x2={chartWidth - insetRight} y1={yFor(currentLast)} y2={yFor(currentLast)} stroke={colors.ink} strokeWidth={1.2} strokeDasharray="6 3" />
          <Circle cx={coords.at(-1)?.x ?? chartWidth - insetRight} cy={yFor(currentLast)} r={4} fill={stroke} stroke={colors.paper} strokeWidth={2} /></> : null}
        {settings.showMarkPrice && currentMark ? <Line x1={0} x2={chartWidth - insetRight} y1={yFor(currentMark)} y2={yFor(currentMark)} stroke="#D99100" strokeWidth={1.4} strokeDasharray="3 4" /> : null}
        {selectedAt ? <Line x1={selectedAt.x} x2={selectedAt.x} y1={insetTop} y2={height - axisBottom} stroke={colors.ink} strokeDasharray="4 3" opacity={0.45} /> : null}
        <SvgText x={4} y={height - 6} fontSize={9} fill={colors.muted}>{formatTime(points[0].time, range)}</SvgText>
        <SvgText x={chartWidth - insetRight} y={height - 6} fontSize={9} fill={colors.muted} textAnchor="end">{formatTime(points.at(-1)!.time, range)}</SvgText>
      </Svg>
      </ScrollView>
    </View> : <View style={[styles.empty, {width: viewportWidth, height}]}><Text style={styles.emptyText}>No {observationLabel.toLowerCase()} returned for this range.</Text></View>}
    <View style={styles.legend}><Legend color={stroke} label="Last price" />{settings.showMarkPrice && currentMark ? <Legend color="#D99100" label="Mark price" /> : null}
      {visibleOverlays.filter(item => ['entry', 'liquidation', 'take_profit', 'stop_loss', 'pending'].includes(item.kind)).map(item => {
        const price = scaled(item.price, priceDecimals);
        const location = price < low ? ' · below chart' : price > high ? ' · above chart' : '';
        return <Legend key={item.id} color={item.color ?? OVERLAY_COLORS[item.kind]}
          label={`${item.label} ${formatPrice(price)}${location}`} />;
      })}</View>
    {visiblePnl.length ? <View accessibilityRole="text" style={styles.pnlEstimates}>
      <Text style={styles.pnlTitle}>Live PnL · estimate</Text>
      {visiblePnl.map(item => { const value = formatAUsdUnits(item.amountUnits); const positive = !item.amountUnits.startsWith('-');
        return <View key={item.id} style={[styles.pnlBadge, positive ? styles.pnlPositive : styles.pnlNegative]}>
          <Text style={styles.pnlText}>{item.source === 'manual' ? 'Manual' : 'Autonomous'} · {value} AUSD</Text>
        </View>;
      })}
    </View> : null}
    {selected ? <View accessible accessibilityRole="text" style={styles.inspection}>
      <View style={styles.inspectHead}><Text style={styles.inspectionTitle}>{selectedIndex === null ? 'Latest candle' : 'Selected candle'}</Text><Text style={styles.inspectionValue}>{formatPrice(selected.value)}</Text></View>
      <Text style={styles.time}>{new Date(selected.time).toLocaleString()}</Text>
      <View style={styles.ohlc}>{[['O', selected.raw.o], ['H', selected.raw.h], ['L', selected.raw.l], ['C', selected.raw.c]].map(([label, raw]) => <View key={String(label)} style={styles.ohlcCell}>
        <Text style={styles.ohlcLabel}>{label}</Text><Text style={styles.ohlcValue}>{raw === undefined ? '—' : formatPrice(scaled(raw, priceDecimals))}</Text></View>)}</View>
      {settings.showVolume && selected.raw.v !== undefined ? <Text style={styles.time}>Volume · {formatPrice(scaled(selected.raw.v, sizeDecimals))}</Text> : null}
      {settings.showMarkPrice && currentMark ? <Text style={styles.markLabel}>Mark {formatPrice(currentMark)} · used for position risk</Text> : null}
    </View> : null}
    <View style={styles.axisLabels}><Text style={styles.label}>Time · {range} · swipe to browse</Text>
      <Text style={[styles.label, stale && styles.stale]}>{connectionStatus ? connectionStatus === 'connected' && !stale ? 'LIVE' : connectionStatus.toUpperCase() : stale ? 'STALE SNAPSHOT' : observationLabel}</Text></View>
    {liveUpdatedAt || selected ? <Text style={[styles.label, stale && styles.stale]}>{stale ? 'Last update' : 'Updated'} · {new Date(liveUpdatedAt ?? selected!.time).toLocaleTimeString()}</Text> : null}
  </View>;
}

function Candle({candle, x, yFor, priceDecimals}: {candle: MarketCandle; x: number; yFor: (price: number) => number; priceDecimals: number}) {
  const open = scaled(candle.o, priceDecimals), close = scaled(candle.c, priceDecimals), high = scaled(candle.h, priceDecimals), low = scaled(candle.l, priceDecimals), up = close >= open;
  const color = up ? '#168348' : '#C62836', top = Math.min(yFor(open), yFor(close)), body = Math.max(2, Math.abs(yFor(open) - yFor(close)));
  return <><Line x1={x} x2={x} y1={yFor(high)} y2={yFor(low)} stroke={color} strokeWidth={1.5} /><Rect x={x - 4} y={top} width={8} height={body} fill={color} /></>;
}
function Legend({color, label}: {color: string; label: string}) { return <View style={styles.legendItem}><View style={[styles.legendDot, {backgroundColor: color}]} /><Text style={styles.legendText}>{label}</Text></View>; }
function validPrice(value?: number | string | null) { return value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0; }
function scaled(value: number | string, decimals: number) { const numeric = Number(value); return Number.isFinite(numeric) ? numeric / (10 ** decimals) : Number.NaN; }
function toMillis(value: number | string) { const numeric = Number(value); return numeric < 10_000_000_000 ? numeric * 1000 : numeric; }
function hasVerifiedReference(item: MarketTradeSummary) { return item.transactionHashes.length > 0 || item.orderIds.length > 0; }
function isFinalizedClose(status: string) { return ['closed', 'finalized', 'complete', 'completed', 'settled'].includes(status.toLowerCase()); }
function timeToX(time: number, points: Point[], xPositions: number[]) {
  if (time <= points[0].time) return xPositions[0]; if (time >= points.at(-1)!.time) return xPositions.at(-1)!;
  let low = 0, high = points.length - 1; while (low < high) { const middle = Math.floor((low + high) / 2); if (points[middle].time < time) low = middle + 1; else high = middle; }
  return xPositions[low];
}
function formatPrice(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '—';
  const digits = Math.abs(value) < 0.0001 && value !== 0 ? Math.min(10, Math.max(4, -Math.floor(Math.log10(Math.abs(value))) + 2)) : 6;
  return value.toLocaleString(undefined, {maximumFractionDigits: digits});
}
function formatAUsdUnits(raw: string) {
  try {
    const units = BigInt(raw), negative = units < 0n, absolute = negative ? -units : units;
    const whole = absolute / 1_000_000n, remainder = (absolute % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
    return `${negative ? '−' : '+'}${whole.toLocaleString()}${remainder ? `.${remainder}` : '.00'}`;
  } catch { return 'unavailable'; }
}
function formatTime(time: number, range: ChartRange) { const date = new Date(time); return range === '1H' || range === '6H'
  ? date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) : date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}); }

const styles = StyleSheet.create({
  wrap: {alignItems: 'center', gap: spacing.sm}, controls: {alignSelf: 'stretch', flexDirection: 'row', gap: 6}, control: {minHeight: 38, minWidth: 72, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 9, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper}, options: {flex: 1, minHeight: 38, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 8}, controlText: {...type.meta, color: colors.ink, fontSize: 9, textTransform: 'uppercase'}, selected: {backgroundColor: colors.yellow},
  quickRow: {alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 5}, quickChip: {borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.paper, paddingVertical: 7, paddingHorizontal: 8}, quickSelected: {backgroundColor: colors.mint}, quickText: {...type.meta, color: colors.ink, fontSize: 8}, ranges: {flexDirection: 'row', alignSelf: 'stretch', gap: 6}, range: {flex: 1, minHeight: 36, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center'},
  empty: {borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: spacing.md}, emptyText: {...type.body, color: colors.muted, textAlign: 'center'}, axisLabels: {flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-between', gap: spacing.sm}, label: {...type.meta, color: colors.muted, fontSize: 8, flexShrink: 1}, stale: {color: '#9B352C'},
  legend: {alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 10}, legendItem: {flexDirection: 'row', alignItems: 'center', gap: 4}, legendDot: {width: 9, height: 9, borderRadius: 5}, legendText: {...type.meta, color: colors.ink, fontSize: 10, flexShrink: 1}, pnlEstimates: {alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6}, pnlTitle: {...type.meta, color: colors.muted, fontSize: 9}, pnlBadge: {borderWidth: 1.5, paddingHorizontal: 7, paddingVertical: 4}, pnlPositive: {backgroundColor: '#E7F4EB', borderColor: '#168348'}, pnlNegative: {backgroundColor: '#FCE8E8', borderColor: '#C62836'}, pnlText: {...type.meta, color: colors.ink, fontSize: 9}, inspection: {alignSelf: 'stretch', borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, padding: spacing.sm, gap: 4}, inspectHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, inspectionTitle: {...type.meta, color: colors.muted, fontSize: 9}, inspectionValue: {...type.display, color: colors.ink, fontSize: 17}, time: {...type.body, color: colors.muted, fontSize: 11}, ohlc: {flexDirection: 'row', justifyContent: 'space-between', gap: 4}, ohlcCell: {flex: 1, gap: 3}, ohlcLabel: {...type.meta, color: colors.muted, fontSize: 8}, ohlcValue: {...type.body, color: colors.ink, fontSize: 10, fontWeight: '800'}, markLabel: {...type.meta, color: '#996600', fontSize: 9},
});
