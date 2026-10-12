import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import Svg, {Circle, Line, Path, Rect, Text as SvgText} from 'react-native-svg';
import type {MarketCandle, MarketTradeSummary} from '../types/marketDirectory';
import type {ChartLivePnl, ChartOverlay, ChartRange} from '../types/marketChart';
import {useChartSettings} from '../services/chartSettings';
import {colors, spacing, type, userFonts} from '../theme/tokens';
import {contrastRatio, type UserThemeTokens} from '../theme/userThemes';
import {mapTimeToX, nearestIndex, normalizeCandleTimestamp, priceTicks, visiblePriceRange} from '../services/marketChartMath';

export type {ChartRange} from '../types/marketChart';
export type MarketChartProps = {
  candles: MarketCandle[]; priceDecimals?: number; sizeDecimals?: number; resolutionSeconds?: number; candleTimeUnit?: 'milliseconds' | 'seconds';
  range: ChartRange; onRangeChange: (range: ChartRange) => void; observationLabel?: string;
  livePrice?: number | string | null; markPrice?: number | string | null; liveUpdatedAt?: number | null;
  connectionStatus?: 'connected' | 'reconnecting' | 'disconnected'; overlays?: ChartOverlay[]; trades?: MarketTradeSummary[];
  livePnl?: ChartLivePnl[]; theme?: UserThemeTokens;
};

type Point = {time: number; value: number; raw: MarketCandle};
const OVERLAY_COLORS: Record<ChartOverlay['kind'], string> = {
  entry: '#6B49C8', liquidation: '#C62836', take_profit: '#168348', stop_loss: '#E25368',
  pending: '#66636D', fill_entry: '#19878B', fill_exit: '#AB65A5',
};
type ChartPalette = {ink: string; paper: string; muted: string; border: string; accent: string; up: string; down: string; mark: string;
  overlay: Record<ChartOverlay['kind'], string>; markerEntry: string; markerExit: string; positiveSurface: string; negativeSurface: string};
const DEVELOPER_PALETTE: ChartPalette = {ink: colors.ink, paper: colors.paper, muted: colors.muted, border: colors.ink,
  accent: colors.yellow, up: '#168348', down: '#C62836', mark: '#D99100', overlay: OVERLAY_COLORS,
  markerEntry: '#16878B', markerExit: '#AB65A5', positiveSurface: '#E7F4EB', negativeSurface: '#FCE8E8'};
function userChartPalette(theme: UserThemeTokens): ChartPalette {
  const dark = theme.id === 'after-hours';
  return {ink: theme.ink, paper: theme.surface, muted: theme.muted, border: theme.border, accent: theme.accent,
    up: dark ? '#D9FF43' : '#176B3A', down: dark ? '#FF7BA5' : '#B42332', mark: dark ? '#FFD166' : '#8A5C00',
    overlay: {entry: theme.id === 'after-hours' ? '#A995FF' : '#6B49C8', liquidation: dark ? '#FF7BA5' : '#B42332',
      take_profit: dark ? '#D9FF43' : '#176B3A', stop_loss: dark ? '#FF7BA5' : '#B42332', pending: theme.muted,
      fill_entry: theme.id === 'after-hours' ? '#9EB8C8' : '#0B6268', fill_exit: dark ? '#FF7BA5' : '#A32454'},
    markerEntry: dark ? '#9EB8C8' : '#0B6268', markerExit: dark ? '#FF7BA5' : '#A32454',
    positiveSurface: dark ? '#28331F' : theme.success, negativeSurface: dark ? '#312129' : theme.danger};
}

export function MarketChart({candles, priceDecimals = 0, sizeDecimals = 0, resolutionSeconds, candleTimeUnit, range, onRangeChange,
  observationLabel = 'Market observations', livePrice, markPrice, liveUpdatedAt, connectionStatus, overlays = [], trades = [], livePnl = [], theme}: MarketChartProps) {
  const {width: screenWidth, fontScale} = useWindowDimensions();
  const {settings, update: updateSettings, loading: settingsLoading} = useChartSettings();
  const palette = theme ? userChartPalette(theme) : DEVELOPER_PALETTE;
  const themedText = theme ? {color: palette.ink, fontFamily: userFonts.body} : undefined;
  const themedMeta = theme ? {color: palette.muted, fontFamily: userFonts.mono, fontSize: 11} : undefined;
  const themedControl = theme ? {minHeight: 48, borderColor: palette.border, backgroundColor: palette.paper} : undefined;
  const themedSelected = theme ? {backgroundColor: palette.accent} : undefined;
  const compactUserLayout = Boolean(theme && (screenWidth < 380 || fontScale >= 1.35));
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [quickOptions, setQuickOptions] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [browsingHistory, setBrowsingHistory] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrolledAway = useRef(false);
  const displayedRange = useRef(range);
  const syncedRange = useRef(false);
  const viewportWidth = theme ? Math.max(1, measuredWidth || screenWidth - 75)
    : Math.max(260, Math.min(screenWidth - 62, 520));
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
  const isRising = (points.at(-1)?.value ?? 0) >= (points[0]?.value ?? 0), stroke = isRising ? palette.up : palette.down;
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

  return <View style={[styles.wrap, theme && {alignSelf: 'stretch'}]}
    onLayout={theme ? event => setMeasuredWidth(event.nativeEvent.layout.width) : undefined}>
    <View testID={theme ? 'market-chart-controls' : undefined} style={[styles.controls, compactUserLayout && styles.userControlsCompact]}>
      {(['candles', 'line'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{selected: settings.display === value}}
        onPress={() => updateSettings({display: value})} style={[styles.control, themedControl, settings.display === value && styles.selected, settings.display === value && themedSelected]}><Text style={[styles.controlText, themedText, settings.display === value && theme && {color: theme.accentText}]}>{value === 'candles' ? 'Candles' : 'Line'}</Text></Pressable>)}
      <Pressable testID={theme ? 'market-chart-options' : undefined} accessibilityRole="button" accessibilityState={{expanded: quickOptions}} onPress={() => setQuickOptions(value => !value)} style={[styles.options, theme && {minHeight: 48}, compactUserLayout && styles.userOptionsCompact]}><Text style={[styles.controlText, themedText]}>{quickOptions ? 'Hide options' : 'Chart options'} ▾</Text></Pressable>
    </View>
    {quickOptions ? <View style={styles.quickRow}>{[
      {key: 'showMarkPrice' as const, label: 'Mark'}, {key: 'showVolume' as const, label: 'Volume'},
      {key: 'showManualPositions' as const, label: 'Manual'}, {key: 'showAutonomousPositions' as const, label: 'Auto'},
      {key: 'showRiskLevels' as const, label: 'Risk'}, {key: 'showTradeMarkers' as const, label: 'Fills'},
      {key: 'showPnl' as const, label: 'PnL'},
    ].map(option => <Pressable key={option.key} accessibilityRole="button" accessibilityState={{selected: settings[option.key]}}
      onPress={() => updateSettings({[option.key]: !settings[option.key]})} style={[styles.quickChip, theme && themedControl, theme && {minHeight: 48, justifyContent: 'center'}, settings[option.key] && styles.quickSelected, settings[option.key] && themedSelected]}><Text style={[styles.quickText, themedMeta, settings[option.key] && theme && {color: theme.accentText}]}>{option.label}</Text></Pressable>)}</View> : null}
    <View style={styles.ranges}>{(['1H', '6H', '1D', '1W'] as const).map(item => <Pressable key={item} accessibilityRole="button"
      accessibilityState={{selected: item === range}} onPress={() => {scrolledAway.current = false; setBrowsingHistory(false); setSelectedIndex(null); onRangeChange(item); updateSettings({defaultRange: item});}}
      style={[styles.range, theme && themedControl, item === range && styles.selected, item === range && themedSelected]}><Text style={[styles.controlText, themedText, item === range && theme && {color: theme.accentText}]}>{item}</Text></Pressable>)}</View>
    {points.length ? <View style={{width: viewportWidth, height, flexDirection: 'row'}}>
      <Svg width={axisLeft} height={height}>
        {ticks.map((tick, index) => { const y = yFor(tick); return <React.Fragment key={`axis-${index}`}>
          <Line x1={axisLeft - 5} x2={axisLeft - 1} y1={y} y2={y} stroke={palette.ink} opacity={0.3} />
          <SvgText x={axisLeft - 8} y={y + 3} fontSize={theme ? 10 : 9} fill={palette.muted} textAnchor="end">{formatPrice(tick)}</SvgText>
        </React.Fragment>; })}
        <Line x1={axisLeft - 1} x2={axisLeft - 1} y1={insetTop} y2={height - axisBottom} stroke={palette.ink} opacity={0.3} />
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
        {ticks.map((tick, index) => <Line key={`grid-${index}`} x1={0} x2={chartWidth - insetRight} y1={yFor(tick)} y2={yFor(tick)} stroke={palette.ink} strokeWidth={1} opacity={0.12} />)}
        <Line x1={0} x2={chartWidth - insetRight} y1={height - axisBottom} y2={height - axisBottom} stroke={palette.ink} opacity={0.3} />
      {settings.showVolume && points.map((point, index) => { const x = xPositions[index], value = Number(point.raw.v) || 0;
          const barHeight = (value / maxVolume) * (volumeHeight - 4); return <Rect key={`vol-${point.time}`} x={x - 2} y={height - axisBottom - barHeight}
            width={4} height={barHeight} fill={(Number(point.raw.c) >= Number(point.raw.o)) ? palette.up : palette.down} opacity={0.22} />; })}
        {settings.display === 'line' ? <>
          {coords.length > 1 ? <Path d={`${chartPath} L ${coords.at(-1)!.x} ${height - axisBottom - volumeHeight} L ${coords[0].x} ${height - axisBottom - volumeHeight} Z`} fill={stroke} opacity={0.1} /> : null}
          <Path d={chartPath} fill="none" stroke={stroke} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
        </> : points.map((point, index) => <Candle key={`candle-${point.time}`} candle={point.raw} x={xPositions[index]} yFor={yFor} priceDecimals={priceDecimals} rising={palette.up} falling={palette.down} />)}
        {points.map((point, index) => <Rect key={`inspect-${point.time}`} x={xPositions[index] - spacingX / 2} y={insetTop} width={spacingX} height={height - axisBottom - insetTop}
          fill="transparent" onPress={() => selectAt(xPositions[index])} />)}
        {visibleOverlays.map(overlay => { const price = scaled(overlay.price, priceDecimals); if (!(price > 0)) return null;
          const fallbackColor = palette.overlay[overlay.kind];
          const color = theme ? overlay.color && contrastRatio(overlay.color, theme.surface) >= 4.5 ? overlay.color : fallbackColor
            : overlay.color ?? fallbackColor;
          const rawY = yFor(price), y = Math.max(insetTop + 8, Math.min(height - axisBottom - volumeHeight - 3, rawY));
          const offRange = rawY < insetTop || rawY > height - axisBottom - volumeHeight, dash = overlay.kind === 'pending' || overlay.status === 'estimate' ? '5 3' : '2 2';
          if (offRange) return <SvgText key={overlay.id} x={4} y={y} fontSize={9} fill={color}>{rawY < insetTop ? '↑' : '↓'} {overlay.label} {formatPrice(price)}</SvgText>;
          return <React.Fragment key={overlay.id}><Line x1={0} x2={chartWidth - insetRight} y1={y} y2={y} stroke={color} strokeWidth={overlay.kind === 'liquidation' ? 2 : 1.5} strokeDasharray={dash} />
            <SvgText x={4} y={Math.max(insetTop + 8, y - 4)} fontSize={9} fill={color}>{overlay.label}{overlay.status === 'estimate' ? ' · est.' : ''}</SvgText></React.Fragment>;
        })}
        {visibleHistory.map(marker => { const x = timeToX(marker.time, points, xPositions); const rawY = yFor(marker.price); const color = marker.kind === 'entry' ? palette.markerEntry : palette.markerExit;
          if (rawY < insetTop || rawY > height - axisBottom - volumeHeight) return <SvgText key={marker.id} x={Math.max(4, x)} y={rawY < insetTop ? insetTop + 18 : height - axisBottom - volumeHeight - 6} fontSize={8} fill={color}>{marker.source === 'autonomous' ? 'AUTO ' : ''}{marker.label} {formatPrice(marker.price)}</SvgText>;
          const y = rawY;
          return <React.Fragment key={marker.id}><Line x1={x} x2={x} y1={insetTop} y2={height - axisBottom - volumeHeight} stroke={color} strokeDasharray="3 3" />
            <Circle cx={x} cy={y} r={4} fill={color} stroke={palette.paper} strokeWidth={1.5} /><SvgText x={x + 5} y={y - 5} fontSize={8} fill={color}>{marker.source === 'autonomous' ? 'AUTO ' : ''}{marker.label}</SvgText></React.Fragment>;
        })}
        {currentLast && currentLast > 0 ? <><Line x1={0} x2={chartWidth - insetRight} y1={yFor(currentLast)} y2={yFor(currentLast)} stroke={palette.ink} strokeWidth={1.2} strokeDasharray="6 3" />
          <Circle cx={coords.at(-1)?.x ?? chartWidth - insetRight} cy={yFor(currentLast)} r={4} fill={stroke} stroke={palette.paper} strokeWidth={2} /></> : null}
        {settings.showMarkPrice && currentMark ? <Line x1={0} x2={chartWidth - insetRight} y1={yFor(currentMark)} y2={yFor(currentMark)} stroke={palette.mark} strokeWidth={1.4} strokeDasharray="3 4" /> : null}
        {selectedAt ? <Line x1={selectedAt.x} x2={selectedAt.x} y1={insetTop} y2={height - axisBottom} stroke={palette.ink} strokeDasharray="4 3" opacity={0.45} /> : null}
        <SvgText x={4} y={height - 6} fontSize={theme ? 10 : 9} fill={palette.muted}>{formatTime(points[0].time, range)}</SvgText>
        <SvgText x={chartWidth - insetRight} y={height - 6} fontSize={theme ? 10 : 9} fill={palette.muted} textAnchor="end">{formatTime(points.at(-1)!.time, range)}</SvgText>
      </Svg>
      </ScrollView>
    </View> : <View style={[styles.empty, theme && {borderColor: palette.border, backgroundColor: palette.paper}, {width: viewportWidth, height}]}><Text style={[styles.emptyText, themedMeta]}>No {observationLabel.toLowerCase()} returned for this range.</Text></View>}
    <View testID={theme ? 'market-chart-legend' : undefined} style={[styles.legend, theme && styles.userLegend]}><Legend color={stroke} label="Last price" textColor={palette.ink} theme={theme} />{settings.showMarkPrice && currentMark ? <Legend color={palette.mark} label="Mark price" textColor={palette.ink} theme={theme} /> : null}
      {visibleOverlays.filter(item => ['entry', 'liquidation', 'take_profit', 'stop_loss', 'pending'].includes(item.kind)).map(item => {
        const price = scaled(item.price, priceDecimals);
        const location = price < low ? ' · below chart' : price > high ? ' · above chart' : '';
        const customColor = item.color && (!theme || contrastRatio(item.color, theme.surface) >= 4.5) ? item.color : undefined;
        return <Legend key={item.id} color={customColor ?? palette.overlay[item.kind]} textColor={palette.ink} theme={theme}
          label={`${item.label} ${formatPrice(price)}${location}`} />;
      })}</View>
    {visiblePnl.length ? <View accessibilityRole="text" style={styles.pnlEstimates}>
      <Text style={[styles.pnlTitle, themedMeta]}>Live PnL · estimate</Text>
      {visiblePnl.map(item => { const value = formatAUsdUnits(item.amountUnits); const positive = !item.amountUnits.startsWith('-');
        return <View key={item.id} style={[styles.pnlBadge, positive ? styles.pnlPositive : styles.pnlNegative, theme && {
          backgroundColor: positive ? palette.positiveSurface : palette.negativeSurface, borderColor: positive ? palette.up : palette.down}]}>
          <Text style={[styles.pnlText, themedText]}>{item.source === 'manual' ? 'Manual' : 'Autonomous'} · {value} AUSD</Text>
        </View>;
      })}
    </View> : null}
    {selected ? <View accessible accessibilityRole="text" style={[styles.inspection, theme && {borderColor: palette.border, backgroundColor: palette.paper}]}>
      <View testID={theme ? 'market-chart-inspection-header' : undefined} style={[styles.inspectHead, compactUserLayout && styles.userInspectionHeadCompact]}><Text style={[styles.inspectionTitle, themedMeta]}>{selectedIndex === null ? 'Latest candle' : 'Selected candle'}</Text><Text style={[styles.inspectionValue, theme && {color: palette.ink, fontFamily: userFonts.display}]}>{formatPrice(selected.value)}</Text></View>
      <Text style={[styles.time, themedMeta]}>{new Date(selected.time).toLocaleString()}</Text>
      <View testID={theme ? 'market-chart-ohlc' : undefined} style={[styles.ohlc, compactUserLayout && styles.userOhlcCompact]}>{[['O', selected.raw.o], ['H', selected.raw.h], ['L', selected.raw.l], ['C', selected.raw.c]].map(([label, raw]) => <View key={String(label)} testID={theme ? 'market-chart-ohlc-cell' : undefined} style={[styles.ohlcCell, compactUserLayout && styles.userOhlcCellCompact]}>
        <Text style={[styles.ohlcLabel, themedMeta]}>{label}</Text><Text style={[styles.ohlcValue, themedText]}>{raw === undefined ? '—' : formatPrice(scaled(raw, priceDecimals))}</Text></View>)}</View>
      {settings.showVolume && selected.raw.v !== undefined ? <Text style={[styles.time, themedMeta]}>Volume · {formatPrice(scaled(selected.raw.v, sizeDecimals))}</Text> : null}
      {settings.showMarkPrice && currentMark ? <Text style={[styles.markLabel, themedMeta, theme && {color: palette.mark}]}>Mark {formatPrice(currentMark)} · used for position risk</Text> : null}
    </View> : null}
    <View testID={theme ? 'market-chart-footer-axis' : undefined}
      style={[styles.axisLabels, compactUserLayout && styles.userFooterCompact]}>
      <Text testID={theme ? 'market-chart-footer-context' : undefined}
        style={[styles.label, themedMeta, theme && {fontSize: 10}, compactUserLayout && styles.userFooterLabel]}>
        Time · {range} · swipe to browse
      </Text>
      <Text testID={theme ? 'market-chart-footer-status' : undefined}
        style={[styles.label, themedMeta, theme && {fontSize: 10}, stale && styles.stale,
          stale && theme && {color: palette.down}, compactUserLayout && styles.userFooterLabel]}>
        {connectionStatus ? connectionStatus === 'connected' && !stale ? 'LIVE' : connectionStatus.toUpperCase() : stale ? 'STALE SNAPSHOT' : observationLabel}
      </Text>
    </View>
    {liveUpdatedAt || selected ? <Text testID={theme ? 'market-chart-footer-updated' : undefined}
      style={[styles.label, themedMeta, theme && {fontSize: 10}, stale && styles.stale, stale && theme && {color: palette.down},
        compactUserLayout && styles.userFooterLabel]}>
      {stale ? 'Last update' : 'Updated'} · {new Date(liveUpdatedAt ?? selected!.time).toLocaleTimeString()}
    </Text> : null}
  </View>;
}

function Candle({candle, x, yFor, priceDecimals, rising, falling}: {candle: MarketCandle; x: number; yFor: (price: number) => number; priceDecimals: number; rising: string; falling: string}) {
  const open = scaled(candle.o, priceDecimals), close = scaled(candle.c, priceDecimals), high = scaled(candle.h, priceDecimals), low = scaled(candle.l, priceDecimals), up = close >= open;
  const color = up ? rising : falling, top = Math.min(yFor(open), yFor(close)), body = Math.max(2, Math.abs(yFor(open) - yFor(close)));
  return <><Line x1={x} x2={x} y1={yFor(high)} y2={yFor(low)} stroke={color} strokeWidth={1.5} /><Rect x={x - 4} y={top} width={8} height={body} fill={color} /></>;
}
function Legend({color, label, textColor, theme}: {color: string; label: string; textColor: string; theme?: UserThemeTokens}) {
  return <View testID="market-chart-legend-item" accessibilityRole={theme ? 'text' : undefined} accessibilityLabel={theme ? label : undefined}
    style={[styles.legendItem, theme && styles.userLegendItem]}><View style={[styles.legendDot, {backgroundColor: color}]} />
    <Text style={[styles.legendText, theme && styles.userLegendText, theme && {color: textColor, fontFamily: userFonts.body, fontSize: 12}]}>{label}</Text></View>;
}
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
  wrap: {alignItems: 'center', gap: spacing.sm}, controls: {alignSelf: 'stretch', flexDirection: 'row', gap: 6},
  userControlsCompact: {flexWrap: 'wrap', justifyContent: 'flex-start'}, userOptionsCompact: {width: '100%', flex: 0, alignItems: 'center'},
  userFooterCompact: {flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 4},
  userFooterLabel: {alignSelf: 'flex-start', maxWidth: '100%', flexShrink: 0},
  control: {minHeight: 38, minWidth: 72, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 9, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper}, options: {flex: 1, minHeight: 38, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 8}, controlText: {...type.meta, color: colors.ink, fontSize: 9, textTransform: 'uppercase'}, selected: {backgroundColor: colors.yellow},
  quickRow: {alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 5}, quickChip: {borderWidth: 1.5, borderColor: colors.ink, backgroundColor: colors.paper, paddingVertical: 7, paddingHorizontal: 8}, quickSelected: {backgroundColor: colors.mint}, quickText: {...type.meta, color: colors.ink, fontSize: 8}, ranges: {flexDirection: 'row', alignSelf: 'stretch', gap: 6}, range: {flex: 1, minHeight: 36, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center'},
  empty: {borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', padding: spacing.md}, emptyText: {...type.body, color: colors.muted, textAlign: 'center'}, axisLabels: {flexDirection: 'row', alignSelf: 'stretch', justifyContent: 'space-between', gap: spacing.sm}, label: {...type.meta, color: colors.muted, fontSize: 8, flexShrink: 1}, stale: {color: '#9B352C'},
  legend: {alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 10}, userLegend: {width: '100%', minWidth: 0}, legendItem: {flexDirection: 'row', alignItems: 'center', gap: 4},
  userLegendItem: {maxWidth: '100%', minWidth: 0, flexShrink: 1}, userLegendText: {maxWidth: '100%', minWidth: 0, flexShrink: 1}, legendDot: {width: 9, height: 9, borderRadius: 5}, legendText: {...type.meta, color: colors.ink, fontSize: 10, flexShrink: 1}, pnlEstimates: {alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6}, pnlTitle: {...type.meta, color: colors.muted, fontSize: 9}, pnlBadge: {borderWidth: 1.5, paddingHorizontal: 7, paddingVertical: 4}, pnlPositive: {backgroundColor: '#E7F4EB', borderColor: '#168348'}, pnlNegative: {backgroundColor: '#FCE8E8', borderColor: '#C62836'}, pnlText: {...type.meta, color: colors.ink, fontSize: 9}, inspection: {alignSelf: 'stretch', borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper, padding: spacing.sm, gap: 4}, inspectHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, userInspectionHeadCompact: {flexDirection: 'column', alignItems: 'stretch', gap: 3}, inspectionTitle: {...type.meta, color: colors.muted, fontSize: 9}, inspectionValue: {...type.display, color: colors.ink, fontSize: 17, flexShrink: 1}, time: {...type.body, color: colors.muted, fontSize: 11}, ohlc: {flexDirection: 'row', justifyContent: 'space-between', gap: 4}, userOhlcCompact: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 4}, ohlcCell: {flex: 1, gap: 3}, userOhlcCellCompact: {flexBasis: '48%', flexGrow: 0, flexShrink: 0, minWidth: 0}, ohlcLabel: {...type.meta, color: colors.muted, fontSize: 8}, ohlcValue: {...type.body, color: colors.ink, fontSize: 10, fontWeight: '800'}, markLabel: {...type.meta, color: '#996600', fontSize: 9},
});
