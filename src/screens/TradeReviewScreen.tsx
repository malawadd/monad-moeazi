import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, Field, FlowScreen, Notice, PageHeader} from '../components/Ui';
import {createMonadIdempotencyKey, getMonadApprovalRequirement, monadApi} from '../services/monadApi';
import {formatMonadTimestamp, formatMonadUnits, monadTimestampMillis, parseMonadAmount} from '../services/monadFormatting';
import {validatePreparedMonadOperation} from '../services/monadValidation';
import type {MonadAccountScope, MonadMarketAsset, MonadQuote, MonadVenueId} from '../types/monad';
import {useApp} from '../state/AppContext';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

export function TradeReviewScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const {marketId, accountScope, baseAsset, quoteAsset} = route.params ?? {};
  const venue = route.params?.venue as MonadVenueId | undefined;
  const [side, setSide] = useState<'buy' | 'sell'>(route.params?.side === 'sell' ? 'sell' : 'buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('50');
  const [quote, setQuote] = useState<MonadQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const tokenIn = (side === 'buy' ? quoteAsset : baseAsset) as MonadMarketAsset | undefined;
  const tokenOut = (side === 'buy' ? baseAsset : quoteAsset) as MonadMarketAsset | undefined;
  const scope = accountScope as MonadAccountScope | undefined;
  const scopeLabel = scope === 'vault' ? 'Managed vault' : 'Mera wallet';
  const venueLabel = venue === 'uniswap_v4_testnet' ? 'Uniswap v4 Testnet'
    : venue === 'moeazi_test_amm' ? 'Moeazi Test AMM' : String(venue ?? 'Unavailable venue');
  const quoteFresh = quote ? monadTimestampMillis(quote.expiresAt) > Date.now() : false;
  const quoteMatches = Boolean(quote && tokenIn && tokenOut && quote.accountScope === scope
    && quote.venue === venue && quote.tokenIn.toLowerCase() === tokenIn.address.toLowerCase()
    && quote.tokenOut.toLowerCase() === tokenOut.address.toLowerCase());
  const quoteReady = Boolean(quote && quoteFresh && quoteMatches);
  const prepareLabel = useMemo(() => `Prepare ${side} review`, [side]);
  const feeDecimals = quote?.feeAsset === 'MON' ? 18
    : tokenIn && quote?.feeAsset === tokenIn.symbol ? tokenIn.decimals
      : tokenOut && quote?.feeAsset === tokenOut.symbol ? tokenOut.decimals : undefined;
  const feeLabel = quote?.feeAmountUnits && quote.feeAsset
    ? `${feeDecimals === undefined ? `${quote.feeAmountUnits} base units` : formatMonadUnits(quote.feeAmountUnits, feeDecimals)} ${quote.feeAsset}`
    : null;
  useFocusEffect(useCallback(() => { setQuote(null); }, []));

  async function getQuote() {
    setLoading(true); setError(''); setQuote(null);
    try {
      if (!ownerAddress || !marketId || !venue || !scope || !tokenIn || !tokenOut) throw new Error('The market, venue, and account scope are incomplete.');
      const slippageBps = Number(slippage);
      if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) throw new Error('Enter slippage from 1 to 500 basis points.');
      const amountUnits = parseMonadAmount(amount, tokenIn.decimals);
      const result = await monadApi.quote({accountScope: scope, venue, tokenIn: tokenIn.address, tokenOut: tokenOut.address, amountIn: amount.trim(), slippageBps});
      if (result.venue !== venue || result.accountScope !== scope
          || result.tokenIn.toLowerCase() !== tokenIn.address.toLowerCase()
          || result.tokenOut.toLowerCase() !== tokenOut.address.toLowerCase()
          || BigInt(result.amountInUnits) !== BigInt(amountUnits)) throw new Error('The quote does not match the selected market, venue, scope, or input amount.');
      if (!Number.isFinite(monadTimestampMillis(result.expiresAt)) || monadTimestampMillis(result.expiresAt) <= Date.now()) throw new Error('The quote is expired. Request a new quote.');
      setQuote(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No verified quote is available.'); }
    finally { setLoading(false); }
  }

  async function prepareTrade() {
    if (!quote || !tokenIn || !tokenOut || !scope || !venue || !ownerAddress) return;
    setLoading(true); setError('');
    try {
      if (scope !== 'wallet') {
        setError('Vault trade quotes are read-only in mobile. A local operator must trigger any vault test trade.');
        return;
      }
      if (!quoteFresh || !quoteMatches) throw new Error('This quote is stale or incomplete. Request a new quote.');
      const kind = 'wallet_swap' as const;
      const expected = {
        ownerAddress, kind, venue, accountScope: scope, tokenIn: tokenIn.address, tokenOut: tokenOut.address,
        amountInUnits: quote.amountInUnits, minAmountOutUnits: quote.minimumAmountOutUnits,
        inputDecimals: tokenIn.decimals, outputDecimals: tokenOut.decimals, quoteId: quote.quoteId,
      } as const;
      const prepared = await monadApi.prepare({
        kind, idempotencyKey: createMonadIdempotencyKey(), amountIn: amount.trim(),
        accountScope: scope, venue, tokenIn: tokenIn.address, tokenOut: tokenOut.address, slippageBps: Number(slippage), quoteId: quote.quoteId,
      });
      validatePreparedMonadOperation(prepared, expected);
      navigation.navigate('OperationReview', {prepared, expected, asset: `${tokenIn.symbol} → ${tokenOut.symbol}`,
        inputSymbol: tokenIn.symbol, outputSymbol: tokenOut.symbol});
    } catch (reason) {
      const approval = getMonadApprovalRequirement(reason);
      if (approval) {
        navigation.navigate('TokenApprovalReview', {approval, tokenSymbol: tokenIn.symbol, tokenDecimals: tokenIn.decimals,
          returnRoute: 'TradeReview', returnParams: route.params});
      } else setError(reason instanceof Error ? reason.message : 'The trade could not be prepared.');
    }
    finally { setLoading(false); }
  }

  if (!tokenIn || !tokenOut || !scope || !venue) return <FlowScreen><PageHeader kicker="Trade review" title="Market route unavailable" copy="Return to Markets and choose a route supplied by the Monad service." /></FlowScreen>;

  return <FlowScreen>
    <PageHeader kicker="Trade review" title={`${tokenIn.symbol} → ${tokenOut.symbol}`}
      copy={scope === 'vault' ? 'Review a live vault quote. Only the local operator can prepare and submit a mandated test trade.'
        : 'A verified quote and gas estimate are required before Mera can sign the prepared Monad transaction.'} />
    {error ? <Notice live tone="rose" title="Trade is not ready" message={error} actionLabel={quote ? 'Get a fresh quote' : undefined} onAction={quote ? () => { void getQuote(); } : undefined} /> : null}
    <Card>
      <DataRow label="Market" value={`${baseAsset.symbol}/${quoteAsset.symbol} · ${marketId}`} />
      <DataRow label="Account" value={scopeLabel} />
      <DataRow label="Venue" value={venueLabel} />
      <View style={styles.sides}>{(['buy', 'sell'] as const).map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{selected: side === item}} onPress={() => { setSide(item); setQuote(null); }} style={[styles.side, side === item && styles.selected]}><Text style={styles.sideLabel}>{item}</Text></Pressable>)}</View>
      <Field label={`Amount in ${tokenIn.symbol}`} value={amount} onChangeText={value => { setAmount(value); setQuote(null); }} placeholder="0" keyboardType="decimal-pad" />
      <Field label="Maximum slippage (basis points)" value={slippage} onChangeText={value => { setSlippage(value); setQuote(null); }} keyboardType="number-pad" />
      <Button label="Get verified quote" onPress={() => { void getQuote(); }} loading={loading} />
    </Card>
    {quote ? <Card>
      <Text style={s.strong}>Quote review</Text>
      <DataRow label="Input" value={`${formatMonadUnits(quote.amountInUnits, tokenIn.decimals)} ${tokenIn.symbol}`} />
      <DataRow label="Expected output" value={`${formatMonadUnits(quote.amountOutUnits, tokenOut.decimals)} ${tokenOut.symbol}`} />
      <DataRow label="Minimum output" value={`${formatMonadUnits(quote.minimumAmountOutUnits, tokenOut.decimals)} ${tokenOut.symbol}`} />
      {feeLabel ? <DataRow label="Venue fee" value={feeLabel} /> : null}
      <DataRow label="Fee source" value={quote.feeProvenance} />
      {quote.gas ? <>
        <DataRow label="Gas limit" value={quote.gas.gasLimit} />
        <DataRow label="Max fee per gas" value={`${formatMonadUnits(quote.gas.maxFeePerGas, 9)} gwei`} />
        <DataRow label="Maximum network fee" value={`${formatMonadUnits(quote.gas.maxCostWei, 18)} MON`} />
      </> : <Text style={s.body}>{scope === 'vault' ? 'Operator gas is estimated when a vault order is prepared.' : 'No gas estimate returned.'}</Text>}
      <DataRow label="Quote expires" value={formatMonadTimestamp(quote.expiresAt)} />
      {scope === 'wallet' ? <Button label={prepareLabel} onPress={() => { void prepareTrade(); }} loading={loading} disabled={!quoteReady} />
        : <Text style={s.body}>Operator-run test trade: this quote is read-only in mobile. No vault transaction can be prepared or broadcast here.</Text>}
    </Card> : null}
    <Text style={s.body}>You can lose tokens when a trade executes. Review minimum output, venue, and maximum network fee before signing.</Text>
  </FlowScreen>;
}

const styles = StyleSheet.create({
  sides: {flexDirection: 'row', gap: spacing.sm},
  side: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper},
  selected: {backgroundColor: colors.pink},
  sideLabel: {...type.meta, color: colors.ink, textTransform: 'uppercase'},
});
