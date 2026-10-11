import React from 'react';
import {Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {FlowScreen, Panel, StatusBadge} from '../components/Ui';
import {useChartSettings} from '../services/chartSettings';
import type {ChartRange} from '../types/marketChart';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

const rows: Array<{key: 'showMarkPrice' | 'showVolume' | 'showOrderBook' | 'showTradeMarkers' | 'showManualPositions' | 'showAutonomousPositions' | 'showPnl' | 'showRiskLevels'; title: string; detail: string}> = [
  {key: 'showMarkPrice', title: 'Perpl mark price', detail: 'Show the mark price used to value open positions.'},
  {key: 'showVolume', title: 'Volume bars', detail: 'Show traded volume beneath the chart.'},
  {key: 'showOrderBook', title: 'Order book section', detail: 'Keep live bids and asks under the chart.'},
  {key: 'showTradeMarkers', title: 'Finalized trade markers', detail: 'Mark confirmed entries and exits from your history.'},
  {key: 'showManualPositions', title: 'Manual position overlays', detail: 'Show entry and risk levels for your manual account.'},
  {key: 'showAutonomousPositions', title: 'Autonomous position overlays', detail: 'Show entry and risk levels for your autonomous run.'},
  {key: 'showPnl', title: 'Open position PnL', detail: 'Show indicative unrealized PnL beside each open position.'},
  {key: 'showRiskLevels', title: 'Take profit, stop, liquidation', detail: 'Show configured exits and estimated liquidation levels.'},
];

export function ChartSettingsScreen() {
  const {settings, update, loading} = useChartSettings();
  return <FlowScreen>
    <View style={styles.header}><StatusBadge label="MARKET DISPLAY" tone="sky" />
      <Text accessibilityRole="header" style={styles.title}>Chart settings</Text>
      <Text style={s.body}>Display preferences are saved on this device. Risk prices are estimates; Perpl account state remains authoritative.</Text>
    </View>
    <Panel tone="yellow">
      <Text style={s.subheading}>Chart style</Text>
      <View style={styles.choices}>{(['candles', 'line'] as const).map(value => <Pressable key={value}
        accessibilityRole="button" accessibilityState={{selected: settings.display === value, disabled: loading}} disabled={loading}
        onPress={() => update({display: value})} style={[styles.choice, settings.display === value && styles.selected]}><Text style={styles.choiceText}>{value === 'candles' ? 'Candlesticks' : 'Price line'}</Text></Pressable>)}</View>
      <Text style={s.subheading}>Default time range</Text>
      <View style={styles.choices}>{(['1H', '6H', '1D', '1W'] as ChartRange[]).map(value => <Pressable key={value}
        accessibilityRole="button" accessibilityState={{selected: settings.defaultRange === value, disabled: loading}} disabled={loading}
        onPress={() => update({defaultRange: value})} style={[styles.choice, settings.defaultRange === value && styles.selected]}><Text style={styles.choiceText}>{value}</Text></Pressable>)}</View>
    </Panel>
    <Panel tone="mint">
      <Text style={s.subheading}>Market details</Text>
      {rows.map(item => <View key={item.key} style={styles.row}>
        <View style={styles.copy}><Text style={styles.settingTitle}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text></View>
        <Switch accessibilityLabel={item.title} accessibilityHint={item.detail} value={settings[item.key]}
          onValueChange={value => update({[item.key]: value})} disabled={loading}
          trackColor={{false: colors.cream, true: colors.mint}} thumbColor={colors.ink} />
      </View>)}
    </Panel>
  </FlowScreen>;
}

const styles = StyleSheet.create({
  header: {gap: spacing.sm}, title: {...s.heading, fontSize: 34, lineHeight: 37},
  row: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 2, borderColor: colors.ink, paddingVertical: spacing.sm},
  copy: {flex: 1, gap: 4}, settingTitle: {...s.strong, fontSize: 14}, detail: {...s.body, fontSize: 12, lineHeight: 17},
  choices: {flexDirection: 'row', gap: 7}, choice: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 5, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paper}, choiceText: {...s.meta, color: colors.ink, fontSize: 9, textAlign: 'center'}, selected: {backgroundColor: colors.yellow},
});
