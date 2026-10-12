import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {UserCard, UserHeading, UserPage, UserText} from '../components/user/UserPrimitives';
import type {ChartRange, ChartSettings} from '../types/marketChart';
import type {UserThemeTokens} from '../theme/userThemes';
import {userFonts} from '../theme/tokens';

const rows: Array<{key: keyof Pick<ChartSettings, 'showMarkPrice' | 'showVolume' | 'showOrderBook' | 'showTradeMarkers' | 'showManualPositions' | 'showAutonomousPositions' | 'showPnl' | 'showRiskLevels'>; title: string; detail: string}> = [
  {key: 'showMarkPrice', title: 'Perpl mark price', detail: 'Show the mark used to value open positions.'},
  {key: 'showVolume', title: 'Volume bars', detail: 'Show volume beneath price history.'},
  {key: 'showOrderBook', title: 'Order book', detail: 'Show bids and asks below the chart.'},
  {key: 'showTradeMarkers', title: 'Finalized trade markers', detail: 'Mark confirmed entries and exits.'},
  {key: 'showManualPositions', title: 'Manual positions', detail: 'Show manual entry and risk levels.'},
  {key: 'showAutonomousPositions', title: 'Autonomous positions', detail: 'Show autonomous entry and risk levels.'},
  {key: 'showPnl', title: 'Open position PnL', detail: 'Show estimated unrealized PnL.'},
  {key: 'showRiskLevels', title: 'Exit and liquidation levels', detail: 'Show configured exits and estimated liquidation.'},
];

export function UserChartSettingsView({theme, settings, update, loading}: {theme: UserThemeTokens; settings: ChartSettings;
  update: (patch: Partial<ChartSettings>) => void; loading: boolean}) {
  return <UserPage theme={theme}>
    <UserHeading kicker="MARKET DISPLAY" title="Chart settings" copy="Display preferences are saved on this device. Risk levels are estimates." theme={theme} />
    <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Chart style</UserText>
      <View style={styles.choices}>{(['candles', 'line'] as const).map(value => <Choice key={value}
        label={value === 'candles' ? 'Candlesticks' : 'Price line'} selected={settings.display === value} disabled={loading}
        theme={theme} onPress={() => update({display: value})} />)}</View>
      <UserText theme={theme} kind="title">Default time range</UserText>
      <View style={styles.choices}>{(['1H', '6H', '1D', '1W'] as ChartRange[]).map(value => <Choice key={value}
        label={value} selected={settings.defaultRange === value} disabled={loading} theme={theme}
        onPress={() => update({defaultRange: value})} />)}</View>
    </UserCard>
    <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Market details</UserText>
      {rows.map(item => <Pressable key={item.key} accessibilityRole="switch" accessibilityLabel={item.title}
        accessibilityHint={item.detail} accessibilityState={{checked: settings[item.key] as boolean, disabled: loading}}
        disabled={loading} onPress={() => update({[item.key]: !settings[item.key]})}
        style={[styles.toggle, {borderColor: theme.border}, loading && styles.disabled]}>
        <View style={styles.toggleCopy}><Text style={[styles.toggleTitle, {color: theme.ink, fontFamily: userFonts.body}]}>{item.title}</Text>
          <Text style={[styles.detail, {color: theme.muted, fontFamily: userFonts.body}]}>{item.detail}</Text></View>
        <View style={[styles.track, {backgroundColor: settings[item.key] ? theme.accent : theme.neutralSurface,
          borderColor: theme.border}]}><View style={[styles.thumb, {backgroundColor: settings[item.key] ? theme.accentText : theme.muted,
            alignSelf: settings[item.key] ? 'flex-end' : 'flex-start'}]} /></View>
      </Pressable>)}
    </UserCard>
  </UserPage>;
}

function Choice({label, selected, disabled, theme, onPress}: {label: string; selected: boolean; disabled: boolean;
  theme: UserThemeTokens; onPress: () => void}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{selected, disabled}}
    disabled={disabled} onPress={onPress} style={[styles.choice, {borderColor: theme.border,
      backgroundColor: selected ? theme.accent : theme.raised}, disabled && styles.disabled]}>
    <Text style={[styles.choiceLabel, {color: selected ? theme.accentText : theme.ink, fontFamily: userFonts.body}]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  choices: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  choice: {minHeight: 50, minWidth: 70, flexGrow: 1, borderWidth: 2, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10},
  choiceLabel: {fontSize: 14, lineHeight: 20, fontWeight: '800'},
  toggle: {minHeight: 64, borderTopWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8},
  toggleCopy: {flex: 1, gap: 3}, toggleTitle: {fontSize: 15, lineHeight: 20, fontWeight: '800'},
  detail: {fontSize: 13, lineHeight: 18}, track: {width: 48, height: 28, borderRadius: 14, borderWidth: 1.5, padding: 3, justifyContent: 'center'},
  thumb: {width: 18, height: 18, borderRadius: 9}, disabled: {opacity: 0.55},
});
