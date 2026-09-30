import React, {useCallback, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Field, FlowScreen, LoadingBlock, Notice, PageHeader, TextLink} from '../components/Ui';
import {connectorsApi} from '../services/connectorsApi';
import {openHostedCheckout} from '../services/hostedCheckout';
import {previewOptions, previewPurchase} from '../fixtures/connectors';
import {useApp} from '../state/AppContext';
import type {FundingOptions, Purchase} from '../types/connectors';
import {colors, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {FundingEstimate} from '../components/FundingEstimate';
import {useFundingQuote} from '../services/useFundingQuote';
import {quoteBlocksCheckout, validFiatAmount} from '../services/fundingQuote';

export function BuyUsdcScreen() {
  const {mode, ownerAddress} = useApp(), navigation = useNavigation<any>();
  const [options, setOptions] = useState<FundingOptions | null>(null), [pending, setPending] = useState<Purchase[]>([]);
  const [provider, setProvider] = useState(''), [currency, setCurrency] = useState('USD'), [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = useRef<string | null>(null);
  const selected = options?.providers.find(p => p.id === provider);
  const estimate = useFundingQuote({provider, amount, fiatCurrency: currency}, ownerAddress, mode === 'preview', Boolean(selected?.available), selected?.version);
  const load = useCallback(async () => {
    if (mode === 'preview') {setOptions(previewOptions); return;}
    try {const [catalog, rows] = await Promise.all([connectorsApi.options(), connectorsApi.pending()]); setOptions(catalog); setPending(rows);}
    catch (reason) {setError(reason instanceof Error ? reason.message : 'Purchase options could not be loaded.');}
  }, [mode]);
  useFocusEffect(useCallback(() => {load().catch(() => undefined);}, [load]));
  async function buy() {
    if (!validFiatAmount(amount)) {setError('Enter a positive money amount with at most two decimals.'); return;}
    if (quoteBlocksCheckout(estimate.quote) || estimate.loading) return;
    if (estimate.quote?.status === 'ready' && estimate.quote.expiresAt <= Date.now()) {setError('This estimate expired. Review fresh pricing before continuing.'); estimate.retry(); return;}
    if (!provider || !options?.providers.find(p => p.id === provider)?.available) return;
    setBusy(true); setError('');
    const idempotencyKey = key.current ?? `purchase-${Date.now()}-${Math.random().toString(36).slice(2)}`; key.current = idempotencyKey;
    try {
      const quoteReference = estimate.quote?.status === 'ready' && estimate.quote.expiresAt > Date.now() ? estimate.quote.quoteReference : undefined;
      const purchase = mode === 'preview' ? previewPurchase(provider, amount, currency) : await connectorsApi.purchase({provider, amount, fiatCurrency: currency, idempotencyKey, ...(quoteReference ? {quoteReference} : {})});
      navigation.replace('PurchaseStatus', {purchaseId: purchase.purchaseId, preview: mode === 'preview', fixture: mode === 'preview' ? purchase : undefined});
      if (mode !== 'preview' && purchase.checkoutUrl) await openHostedCheckout(purchase.checkoutUrl, purchase.checkoutHosts);
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Check your pending purchase before trying again.');}
    finally {setBusy(false);}
  }
  const changed = () => {key.current = null; setError('');};
  const sandbox = mode !== 'preview' && options?.providers.some(p => p.id === provider && p.environment === 'sandbox');
  return <FlowScreen>
    <PageHeader kicker="Funding" title="Buy USDC" copy="Delivered to your wallet on Arbitrum. The provider handles your payment and identity checks." />
    {mode === 'preview' ? <Notice title="Local preview" message="No checkout opens, no payment is collected, and no balance is credited." /> : null}
    {sandbox ? <Notice title="Test checkout" message="Use the provider's test payment details only. No real Arbitrum USDC will arrive in your wallet." /> : null}
    {error ? <Notice live tone="rose" title="Purchase update" message={error} actionLabel="Reload" onAction={() => {load().catch(() => undefined);}} /> : null}
    {pending.map(p => <TextLink key={p.purchaseId} label={`Check pending purchase · ${p.amount} ${p.fiatCurrency}`} onPress={() => navigation.navigate('PurchaseStatus', {purchaseId: p.purchaseId})} />)}
    {!options ? <LoadingBlock label="Loading payment options" /> : <>
      <Field label="Total budget" keyboardType="decimal-pad" value={amount} placeholder="0.00" onChangeText={v => {changed(); setAmount(v.replace(',', '.'));}} />
      <View style={styles.choices}>{options.currencyCodes.map(code => <Pressable key={code} accessibilityRole="radio" accessibilityState={{checked: currency === code}} style={[styles.currency, currency === code && styles.selected]} onPress={() => {changed(); setCurrency(code);}}><Text style={s.strong}>{code}</Text></Pressable>)}</View>
      <FundingEstimate quote={estimate.quote} loading={estimate.loading} retry={estimate.retry} preview={mode === 'preview'} />
      <Text style={s.strong}>Choose a payment provider</Text>
      {options.providers.map(option => <Pressable key={`${option.id}@${option.version}`} accessibilityRole="radio" accessibilityState={{checked: provider === option.id, disabled: !option.available}} disabled={!option.available} style={[styles.row, provider === option.id && styles.selected]} onPress={() => {changed(); setProvider(option.id);}}>
        <Text style={s.strong}>{option.name}</Text><Text style={s.body}>{option.available ? option.environment === 'sandbox' ? 'Test checkout · No real payment' : 'Fees and eligibility shown in checkout' : option.reason}</Text>
      </Pressable>)}
      <Text style={styles.note}>Moeazi adds no purchase commission. Provider fees are shown before payment. Buying USDC never starts the AI automatically.</Text>
      <Button label={mode === 'preview' ? 'Preview purchase journey' : estimate.quote?.status === 'ready' ? 'Continue to secure checkout' : 'Continue to check amount'} loading={busy} disabled={!validFiatAmount(amount) || !selected?.available || estimate.loading || quoteBlocksCheckout(estimate.quote)} onPress={() => {buy().catch(() => undefined);}} />
    </>}
    <TextLink label="Transfer USDC instead" onPress={() => navigation.replace('FundingGuide')} />
  </FlowScreen>;
}
const styles = StyleSheet.create({choices: {flexDirection: 'row', flexWrap: 'wrap', gap: 8}, currency: {minHeight: 48, minWidth: 64, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: colors.ink}, selected: {backgroundColor: colors.yellow}, row: {minHeight: 72, padding: 12, gap: 4, borderWidth: 2, borderColor: colors.ink}, note: {...type.body, color: colors.muted, fontSize: 13, lineHeight: 19}});
