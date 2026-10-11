import React, {useEffect, useMemo, useRef, useState} from 'react';
import {PanResponder, Pressable, StyleSheet, Text, View} from 'react-native';
import {Button, Card, DataRow, Field, StatusBadge} from './Ui';
import type {MarketDirectoryRow} from '../types/marketDirectory';
import {adjustLimitPriceByTick, sliderProgress, sliderValueFromOffset, type ManualEntryOrderType,
  type ManualEntrySide, type ManualPerplEntrySizing} from '../services/manualPerplSizing';
import {formatMonadTimestamp} from '../services/monadFormatting';
import {screenStyles as s} from '../theme/screenStyles';

type Props = {
  market: MarketDirectoryRow;
  side: ManualEntrySide;
  onSideChange: (side: ManualEntrySide) => void;
  orderType: ManualEntryOrderType;
  onOrderTypeChange: (type: ManualEntryOrderType) => void;
  notionalAUsd: number;
  onNotionalChange: (value: number) => void;
  leverage: number;
  onLeverageChange: (value: number) => void;
  limitPrice: string;
  onLimitPriceChange: (value: string) => void;
  sizing: ManualPerplEntrySizing;
  quoteObservedAt?: number | string;
  bookObservedAt?: number | string;
};

export function ManualPerplEntrySizer(props: Props) {
  const [advancedPrice, setAdvancedPrice] = useState(false);
  const shownLimitPrice = props.limitPrice || props.sizing.limitPrice;
  const minNotional = props.sizing.minNotionalAUsd;
  const notionalStep = Math.max(0.01, (props.sizing.maxNotionalAUsd - minNotional) / 1_000);
  const entryIsLimit = props.orderType === 'limit';
  const targets = [0.25, 0.5, 0.75, 1];

  useEffect(() => {
    if (entryIsLimit && !props.limitPrice && props.sizing.limitPrice) props.onLimitPriceChange(props.sizing.limitPrice);
  }, [entryIsLimit, props.limitPrice, props.onLimitPriceChange, props.sizing.limitPrice]);

  return <Card tint="#F1EDFF">
    <Text style={s.strong}>Build your Perpl trade</Text>
    <View style={styles.toggleRow}>{(['long', 'short'] as const).map(item => <Button key={item} label={item.toUpperCase()}
      variant={props.side === item ? 'primary' : 'secondary'} onPress={() => props.onSideChange(item)} />)}</View>
    <View style={styles.toggleRow}>{(['market', 'limit'] as const).map(item => <Button key={item} label={`${item} order`}
      variant={props.orderType === item ? 'primary' : 'secondary'} onPress={() => props.onOrderTypeChange(item)} />)}</View>

    <View style={styles.valueHeader}><Text style={s.meta}>AUSD trade size</Text><Text accessibilityLiveRegion="polite" style={styles.amount}>${money(props.notionalAUsd)}</Text></View>
    <HorizontalSlider accessibilityLabel="AUSD trade size" value={props.notionalAUsd} min={minNotional}
      max={props.sizing.maxNotionalAUsd} step={notionalStep} disabled={props.sizing.maxNotionalAUsd <= minNotional}
      onValueChange={props.onNotionalChange} />
    <View style={styles.quickTargets}>{targets.map((fraction, index) => {
      const value = minNotional + (props.sizing.maxNotionalAUsd - minNotional) * fraction;
      const label = index === targets.length - 1 ? 'MAX' : `${Math.round(fraction * 100)}%`;
      return <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Set trade size to ${label}`}
        disabled={props.sizing.maxNotionalAUsd < minNotional || props.sizing.maxNotionalAUsd <= 0} onPress={() => props.onNotionalChange(index === targets.length - 1
          ? props.sizing.maxNotionalAUsd : Math.min(props.sizing.maxNotionalAUsd, Math.max(minNotional, floorCents(value))))}
        style={({pressed}) => [styles.target, pressed && styles.targetPressed, props.sizing.maxNotionalAUsd <= 0 && styles.disabled]}>
        <Text style={styles.targetText}>{label}</Text>
      </Pressable>;
    })}</View>

    <View style={styles.valueHeader}><Text style={s.meta}>Leverage</Text><Text style={styles.amount}>{props.leverage}×</Text></View>
    <HorizontalSlider accessibilityLabel="Leverage" value={props.leverage} min={1} max={Math.max(1, props.sizing.maxLeverage)}
      step={1} disabled={props.sizing.maxLeverage <= 1} onValueChange={props.onLeverageChange} />
    <DataRow label="Perpl exchange max leverage" value={`${props.sizing.exchangeMaxLeverage || 'Unavailable'}×`} />
    <DataRow label="Moeazi manual leverage cap" value={`${props.sizing.maxLeverage || 'Unavailable'}×`} />
    <DataRow label="Perpl initial margin rate" value={marginRate(props.market.initialMarginBps)} />
    <DataRow label="Perpl maintenance margin rate" value={marginRate(props.market.maintenanceMarginBps)} />
    <DataRow label="Moeazi manual AUSD cap" value={usd(props.sizing.manualCapAUsd)} />
    <DataRow label="Maximum selectable notional" value={usd(props.sizing.maxNotionalAUsd)} />

    {entryIsLimit ? <View style={styles.limitBlock}>
      <Text style={s.strong}>Limit price · AUSD</Text>
      <View style={styles.tickRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Decrease limit price by one tick" onPress={() =>
          props.onLimitPriceChange(adjustLimitPriceByTick(shownLimitPrice, props.market.priceDecimals ?? 0, -1))} style={styles.tickButton}>
          <Text style={styles.tickText}>− tick</Text>
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={styles.limitValue}>{shownLimitPrice || 'Waiting for live quote'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Increase limit price by one tick" onPress={() =>
          props.onLimitPriceChange(adjustLimitPriceByTick(shownLimitPrice, props.market.priceDecimals ?? 0, 1))} style={styles.tickButton}>
          <Text style={styles.tickText}>+ tick</Text>
        </Pressable>
      </View>
      <Button label={advancedPrice ? 'Hide keyboard price entry' : 'Advanced · type a limit price'} variant="secondary"
        onPress={() => setAdvancedPrice(value => !value)} />
      {advancedPrice ? <Field label="Limit price · AUSD" value={shownLimitPrice} onChangeText={props.onLimitPriceChange}
        keyboardType="decimal-pad" placeholder="Enter price" /> : null}
      <Text style={s.meta}>Prefilled from the live {props.side === 'long' ? 'ask' : 'bid'}. A limit may rest without filling.</Text>
    </View> : null}

    <View style={styles.summary}>
      <Text style={s.strong}>Trade preview</Text>
      <DataRow label="Selection" value={`${props.side.toUpperCase()} · ${entryIsLimit ? 'LIMIT' : 'MARKET'}`} />
      <DataRow label="Estimated base size" value={`${props.sizing.size} ${props.market.symbol}`} />
      <DataRow label="Estimated entry price" value={price(props.sizing.entryPrice)} />
      <DataRow label="Spread" value={bps(props.sizing.spreadBps)} />
      <DataRow label={entryIsLimit ? 'Book depth within 100 bps' : 'Estimated book impact'}
        value={entryIsLimit ? props.sizing.executableDepthAUsd === null ? 'Unavailable · may rest' : usd(props.sizing.executableDepthAUsd)
          : bps(props.sizing.impactBps)} />
      <DataRow label="Free AUSD collateral" value={usd(props.sizing.freeCollateralAUsd)} />
      <DataRow label="Locked AUSD collateral" value={props.sizing.lockedCollateralAUsd === null ? 'Unavailable' : usd(props.sizing.lockedCollateralAUsd)} />
      <DataRow label="Approximate isolated margin" value={usd(props.sizing.marginAUsd)} />
      <DataRow label={`Estimated entry fee · ${entryIsLimit ? 'maker' : 'taker'} base tier`} value={usd(props.sizing.entryFeeAUsd)} />
      {entryIsLimit ? <DataRow label="Opening fee reserve · taker base tier" value={usd(props.sizing.openingFeeReserveAUsd)} /> : null}
      <DataRow label="Estimated exit fee · taker base tier" value={usd(props.sizing.exitFeeAUsd)} />
      <DataRow label="Estimated break-even price" value={price(props.sizing.breakEvenPrice)} />
      <DataRow label="Estimated liquidation price" value={price(props.sizing.liquidationPrice)} />
      <DataRow label="Estimated adverse move to liquidation" value={percent(props.sizing.liquidationDistancePct)} />
      <DataRow label="PnL if price rises 1% · before costs" value={signedUsd(props.sizing.onePercentUpPnlAUsd)} />
      <DataRow label="PnL if price falls 1% · before costs" value={signedUsd(props.sizing.onePercentDownPnlAUsd)} />
      <Text style={styles.caveat}>{props.sizing.liquidationCaveat}</Text>
      <DataRow label="Ticker observed" value={timestamp(props.quoteObservedAt)} />
      <DataRow label="Book observed" value={props.sizing.bookFresh ? timestamp(props.bookObservedAt) : 'Stale or unavailable'} />
      <View style={styles.freshness}><StatusBadge label={props.sizing.quoteFresh ? 'Fresh ticker' : 'Stale ticker'} tone={props.sizing.quoteFresh ? 'mint' : 'orange'} />
        <StatusBadge label={props.sizing.bookFresh ? 'Fresh book' : 'Stale or missing book'} tone={props.sizing.bookFresh ? 'mint' : 'orange'} /></View>
      <Text style={s.meta}>Fee tier is an estimate; account-specific fees may differ. A limit crossing the spread may pay taker fees. Final fill price and fees can differ. Preparing review fetches a fresh quote and account snapshot.</Text>
    </View>
    {props.sizing.reason ? <Text accessibilityRole="alert" style={styles.blocked}>{props.sizing.reason}</Text> : null}
  </Card>;
}

function HorizontalSlider({accessibilityLabel, value, min, max, step, disabled, onValueChange}: {
  accessibilityLabel: string; value: number; min: number; max: number; step: number; disabled: boolean; onValueChange: (value: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const trackRef = useRef<View>(null);
  const originX = useRef(0);
  const latest = useRef({value, min, max, step, disabled, onValueChange, width});
  latest.current = {value, min, max, step, disabled, onValueChange, width};
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: event => setAt(event.nativeEvent.pageX),
    onPanResponderMove: event => setAt(event.nativeEvent.pageX),
  }), []);
  function setAt(pageX: number) {
    const state = latest.current;
    state.onValueChange(sliderValueFromOffset(pageX - originX.current, state.width, state.min, state.max, state.step));
  }
  function accessibilityAction(actionName: string) {
    const state = latest.current;
    if (state.disabled) return;
    const delta = actionName === 'increment' ? state.step : actionName === 'decrement' ? -state.step : 0;
    if (delta) state.onValueChange(Math.max(state.min, Math.min(state.max, state.value + delta)));
  }
  const progress = sliderProgress(value, min, max);
  return <View ref={trackRef} accessibilityRole="adjustable" accessibilityLabel={accessibilityLabel}
    accessibilityValue={{min, max, now: value}} accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
    onAccessibilityAction={event => accessibilityAction(event.nativeEvent.actionName)}
    style={[styles.slider, disabled && styles.disabled]} onLayout={event => {
      setWidth(event.nativeEvent.layout.width);
      trackRef.current?.measureInWindow(x => { originX.current = x; });
    }} {...pan.panHandlers}>
    <View style={styles.track}><View style={[styles.fill, {width: `${progress * 100}%`}]} /><View style={[styles.thumb, {left: `${progress * 100}%`}]} /></View>
    <View style={styles.sliderLabels}><Text style={s.meta}>{accessibilityLabel === 'Leverage' ? `${min}×` : `$${money(min)}`}</Text>
      <Text style={s.meta}>{accessibilityLabel === 'Leverage' ? `${max}×` : `$${money(max)}`}</Text></View>
  </View>;
}

function usd(value: number) { return `${money(value)} AUSD`; }
function money(value: number) { return Number.isFinite(value) ? value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : 'Unavailable'; }
function price(value: number | null) { return value === null ? 'Unavailable' : value.toLocaleString(undefined, {maximumFractionDigits: 8}); }
function bps(value: number | null) { return value === null ? 'Unavailable' : `${value.toFixed(1)} bps`; }
function percent(value: number | null) { return value === null ? 'Unavailable' : `${value.toFixed(2)}%`; }
function marginRate(value: number | undefined) { return Number.isFinite(value) && value! > 0 ? `${(value! / 100).toFixed(2)}%` : 'Unavailable'; }
function signedUsd(value: number) { return `${value >= 0 ? '+' : '−'}${usd(Math.abs(value))}`; }
function timestamp(value: number | string | undefined) { return value === undefined ? 'Unavailable' : formatMonadTimestamp(value); }
function floorCents(value: number) { return Math.floor(value * 100) / 100; }

const styles = StyleSheet.create({
  toggleRow: {flexDirection: 'row', gap: 10},
  valueHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline'},
  amount: {...s.heading, fontSize: 24, lineHeight: 28},
  slider: {paddingTop: 8, paddingBottom: 2}, track: {height: 28, justifyContent: 'center', position: 'relative'},
  fill: {height: 8, backgroundColor: '#6E56CF', borderWidth: 2, borderColor: '#171717'},
  thumb: {position: 'absolute', width: 24, height: 24, marginLeft: -12, borderRadius: 12, borderWidth: 3, borderColor: '#171717', backgroundColor: '#F8D84A'},
  sliderLabels: {flexDirection: 'row', justifyContent: 'space-between', paddingTop: 3},
  quickTargets: {flexDirection: 'row', justifyContent: 'space-between', gap: 8},
  target: {minWidth: 52, minHeight: 42, borderWidth: 2, borderColor: '#171717', backgroundColor: '#FFFDF7', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 9},
  targetPressed: {backgroundColor: '#F8D84A'}, targetText: {...s.meta, color: '#171717', fontWeight: '800'}, disabled: {opacity: 0.45},
  limitBlock: {gap: 8, borderTopWidth: 2, borderColor: '#171717', paddingTop: 12},
  tickRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  tickButton: {minHeight: 44, borderWidth: 2, borderColor: '#171717', backgroundColor: '#FFFDF7', justifyContent: 'center', paddingHorizontal: 12},
  tickText: {...s.meta, color: '#171717', fontWeight: '800'}, limitValue: {...s.strong, textAlign: 'center', flex: 1},
  summary: {gap: 4, borderTopWidth: 3, borderColor: '#171717', paddingTop: 12},
  caveat: {...s.body, fontSize: 12, lineHeight: 17, paddingVertical: 4}, freshness: {flexDirection: 'row', gap: 8, flexWrap: 'wrap'},
  blocked: {...s.body, color: '#8F2B25', fontWeight: '800', borderWidth: 2, borderColor: '#171717', padding: 10, backgroundColor: '#FFE0DC'},
});
