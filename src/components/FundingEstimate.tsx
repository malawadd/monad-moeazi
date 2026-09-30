import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, useWindowDimensions, View} from 'react-native';
import {DataRow, DisclosureRow, TextLink} from './Ui';
import {CalmReveal} from './Motion';
import type {FundingQuote} from '../types/fundingQuote';
import {colors, type} from '../theme/tokens';

export function FundingEstimate({quote, loading, retry, preview}: {quote: FundingQuote | null; loading: boolean; retry: () => void; preview: boolean}) {
  const [expanded, setExpanded] = useState(false);
  const {fontScale} = useWindowDimensions();
  useEffect(() => setExpanded(false), [quote]);
  return <View style={[styles.section, {minHeight: 250 * fontScale}]} accessibilityLiveRegion="polite">
    <Text style={styles.label}>Estimated USDC received</Text>
    {loading ? <View accessibilityRole="progressbar" accessibilityLabel="Checking provider pricing" style={styles.loading}>
      <Text style={styles.placeholder}>Checking provider pricing…</Text>
      <View importantForAccessibility="no-hide-descendants" style={styles.loadingLine} />
      <View importantForAccessibility="no-hide-descendants" style={styles.loadingLine} />
      <View importantForAccessibility="no-hide-descendants" style={styles.loadingFees} />
    </View> : quote?.status === 'ready' ? <>
      <Text style={styles.amount}>{quote.estimatedUsdc} USDC</Text>
      <Text style={styles.copy}>Estimated total payment · {quote.estimatedTotal} {quote.fiatCurrency}</Text>
      <Text style={styles.copy}>{preview ? 'Illustrative local fixture' : quote.environment === 'sandbox' ? 'Sandbox card estimate · No real USDC' : 'Card payment estimate'} · USDC on Arbitrum</Text>
      <DisclosureRow label="Fee breakdown" meta="Included in the estimated total" expanded={expanded} onPress={() => setExpanded(v => !v)} />
      {expanded ? <CalmReveal>{quote.fees.map((fee, i) => <DataRow key={`${fee.label}-${i}`} label={fee.label} value={fee.amount === null ? 'Not disclosed' : `${fee.amount} ${quote.fiatCurrency}`} />)}</CalmReveal> : null}
    </> : <>
      <Text style={styles.placeholder}>{quote?.status === 'unavailable' ? quote.message : 'Enter an amount and choose a provider.'}</Text>
      {quote?.status === 'unavailable' && !['MINIMUM_AMOUNT', 'MAXIMUM_AMOUNT', 'INVALID'].includes(quote.code) ? <Text style={styles.copy}>Continue without an estimate to check the total payment and USDC amount before paying.</Text> : null}
      {quote ? <TextLink label="Check estimate again" onPress={retry} /> : null}
    </>}
    <Text style={styles.note}>Your amount is a total budget. The provider confirms the final payment and USDC amount in checkout; another payment method may change fees.</Text>
  </View>;
}
const styles = StyleSheet.create({
  section: {minHeight: 154, gap: 8, paddingVertical: 12, borderTopWidth: 2, borderBottomWidth: 2, borderColor: colors.ink},
  label: {...type.body, color: colors.muted, fontSize: 14}, amount: {...type.display, color: colors.ink, fontSize: 30, lineHeight: 34},
  copy: {...type.body, color: colors.ink, fontSize: 14, lineHeight: 20}, placeholder: {...type.body, color: colors.muted, fontSize: 15, lineHeight: 22, minHeight: 42},
  note: {...type.body, color: colors.muted, fontSize: 12, lineHeight: 18},
  loading: {gap: 8}, loadingLine: {height: 20, width: '72%', backgroundColor: colors.cream}, loadingFees: {height: 56, backgroundColor: colors.cream},
});
