import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {Card, DataRow, StatusBadge} from './Ui';
import type {MarketTradeSummary} from '../types/marketDirectory';
import {formatMonadUnits} from '../services/monadFormatting';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

export function MarketTradeSummaryCard({summary, symbol, priceDecimals, sizeDecimals, onOpen}: {
  summary: MarketTradeSummary; symbol?: string; priceDecimals?: number; sizeDecimals?: number; onOpen?: () => void;
}) {
  const isPerpl = summary.venueId.startsWith('perpl-');
  const displaySymbol = symbol ?? summary.symbol;
  const quoteSymbol = isPerpl ? 'AUSD' : displaySymbol.split('/')[1] ?? 'quote asset';
  const baseSymbol = displaySymbol.split(/[/-]/)[0] || displaySymbol;
  const pnl = summary.netRealizedPnlUnits == null ? 'Not verified' : signedUnits(summary.netRealizedPnlUnits, 6);
  const resolvedPriceDecimals = summary.priceDecimals ?? priceDecimals;
  const resolvedSizeDecimals = summary.sizeDecimals ?? sizeDecimals;
  const entrySize = summary.entrySizeUnits ?? summary.sizeUnits;
  return <Card tint={summary.status === 'finalized' || summary.status === 'closed' ? colors.mintTint : colors.paperAlt}>
    <View style={styles.top}>
      <Text style={s.strong}>{displaySymbol} · {humanize(summary.direction)} · {formatScaled(entrySize, resolvedSizeDecimals)} {baseSymbol}</Text>
      <StatusBadge label={`${summary.source} · ${humanize(summary.status)}`} tone={summary.source === 'manual' ? 'sky' : 'lilac'} />
    </View>
    <DataRow label="Weighted entry" value={formatScaled(summary.weightedEntryPrice, resolvedPriceDecimals)} />
    <DataRow label="Weighted exit" value={formatScaled(summary.weightedExitPrice, resolvedPriceDecimals)} />
    {summary.remainingSizeUnits != null ? <DataRow label={`Remaining · ${baseSymbol}`} value={formatScaled(summary.remainingSizeUnits, resolvedSizeDecimals)} /> : null}
    {summary.realizedPricePnlUnits != null && !isPerpl ? <DataRow label={`Gross price movement · ${quoteSymbol}`} value={signedUnits(summary.realizedPricePnlUnits, 6)} /> : null}
    {summary.feesKnown === false && !isPerpl
      ? <DataRow label="Fees" value="Pool fee is reflected in execution output; MON gas is separate." />
      : <DataRow label="Fees" value={formatFee(summary.feesUnits, quoteSymbol)} />}
    {isPerpl ? <DataRow label="Funding · AUSD" value={formatSignedOrUnavailable(summary.fundingUnits)} /> : null}
    <DataRow label={`Net realized PnL · ${quoteSymbol}`} value={pnl} />
    {onOpen ? <Pressable accessibilityRole="button" onPress={onOpen} style={styles.link}>
      <Text style={styles.linkText}>Open market detail and Activity →</Text>
    </Pressable> : null}
  </Card>;
}

function formatScaled(value: number | string | null | undefined, decimals?: number) {
  if (value === null || value === undefined || value === '') return 'Not recorded';
  if (decimals === undefined) return 'Decimals unavailable';
  try {
    const [whole, rawFraction = ''] = formatMonadUnits(String(value), decimals).split('.');
    let fraction = rawFraction.slice(0, 6);
    if (whole === '0' && !/[1-9]/.test(fraction) && /[1-9]/.test(rawFraction.slice(6))) fraction = rawFraction;
    const trimmed = fraction.replace(/0+$/, '');
    const groupedWhole = whole.length < 16 ? Number(whole).toLocaleString() : whole;
    return trimmed ? `${groupedWhole}.${trimmed}` : groupedWhole;
  } catch { return 'Unavailable'; }
}
function formatSignedOrUnavailable(value?: string | null) { return value == null ? 'Not recorded' : signedUnits(value, 6); }
function formatFee(value: string | null | undefined, unit: string) {
  if (value == null) return 'Not recorded';
  try {
    const amount = BigInt(value);
    const display = formatMonadUnits((amount < 0n ? -amount : amount).toString(), 6);
    return amount < 0n ? `${display} ${unit} rebate` : `${display} ${unit} paid`;
  } catch { return 'Unavailable'; }
}
function signedUnits(value?: string | null, decimals = 6) {
  if (value == null) return 'Not recorded';
  try { const amount = BigInt(value); const sign = amount > 0n ? '+' : amount < 0n ? '−' : '';
    return `${sign}${formatMonadUnits((amount < 0n ? -amount : amount).toString(), decimals)}`;
  } catch { return 'Unavailable'; }
}
function humanize(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }

const styles = StyleSheet.create({
  top: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap'},
  link: {minHeight: 44, borderTopWidth: 2, borderColor: colors.ink, justifyContent: 'center'},
  linkText: {...s.strong, textDecorationLine: 'underline'},
});
