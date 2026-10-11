import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, Field, FlowScreen, Notice, PageHeader} from '../components/Ui';
import {createMonadIdempotencyKey, getMonadApprovalRequirement, monadApi} from '../services/monadApi';
import {formatMonadTimestamp, formatMonadUnits, monadTimestampMillis, parseMonadAmount} from '../services/monadFormatting';
import {validatePreparedMonadOperation, validateV4MarketQuote} from '../services/monadValidation';
import type {MonadAccountScope, MonadMarketAsset, MonadQuote, MonadVenueId} from '../types/monad';
import type {V4PoolKey} from '../types/marketDirectory';
import {useApp} from '../state/AppContext';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

export function TradeReviewScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const {marketId, accountScope, baseAsset, quoteAsset} = route.params ?? {};
  const venue = route.params?.venue as MonadVenueId | undefined;
  const poolId = route.params?.poolId as string | undefined;
  const poolKey = route.params?.poolKey as V4PoolKey | undefined;
  const verified = route.params?.verified === true;
  const poolReadOnly = route.params?.readOnly === true;
  const [side, setSide] = useState<'buy' | 'sell'>(route.params?.side === 'sell' ? 'sell' : 'buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('50');
  const [quote, setQuote] = useState<MonadQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unverifiedAcknowledged, setUnverifiedAcknowledged] = useState(false);
  const tokenIn = (side === 'buy' ? quoteAsset : baseAsset) as MonadMarketAsset | undefined;
  const tokenOut = (side === 'buy' ? baseAsset : quoteAsset) as MonadMarketAsset | undefined;
  const scope = accountScope as MonadAccountScope | undefined;
  const scopeLabel = scope === 'vault' ? 'Managed vault' : 'Mera wallet';
  const venueLabel = venue === 'uniswap_v4_testnet' ? 'Uniswap v4 Testnet'
    : venue === 'moeazi_test_amm' ? 'Moeazi Test AMM'
      : venue === 'moeazi_mock_pools_testnet' ? 'Moeazi mock pool · Testnet' : String(venue ?? 'Unavailable venue');
  const quoteFresh = quote ? monadTimestampMillis(quote.expiresAt) > Date.now() : false;
  const isV4 = venue === 'uniswap_v4_testnet';
  const quoteMatches = Boolean(quote && tokenIn && tokenOut && quote.accountScope === scope
    && quote.venue === venue && quote.tokenIn.toLowerCase() === tokenIn.address.toLowerCase()
    && quote.tokenOut.toLowerCase() === tokenOut.address.toLowerCase()
    && (!isV4 || (Boolean(poolId && poolKey) && quote.chainId === 10143
      && quote.ownerAddress?.toLowerCase() === ownerAddress?.toLowerCase()
      && quote.poolId?.toLowerCase() === poolId?.toLowerCase()
      && samePoolKey(quote.poolKey, poolKey))));
  const needsUnverifiedWarning = Boolean(isV4 && quote?.unverifiedPoolWarning);
  const approvalCheckQuote = Boolean(isV4 && quote?.gasEstimationAvailable === false);
  const quoteReady = Boolean(quote && quoteFresh && quoteMatches && (!needsUnverifiedWarning || unverifiedAcknowledged));
  const prepareLabel = useMemo(() => `Prepare ${side} review`, [side]);
  const feeDecimals = quote?.feeAsset === 'MON' ? 18
    : tokenIn && quote?.feeAsset === tokenIn.symbol ? tokenIn.decimals
      : tokenOut && quote?.feeAsset === tokenOut.symbol ? tokenOut.decimals : undefined;
  const feeLabel = quote?.feeAmountUnits && quote.feeAsset
    ? `${feeDecimals === undefined ? `${quote.feeAmountUnits} base units` : formatMonadUnits(quote.feeAmountUnits, feeDecimals)} ${quote.feeAsset}`
    : null;
  useFocusEffect(useCallback(() => { setQuote(null); setUnverifiedAcknowledged(false); }, []));

  async function getQuote() {
    setLoading(true); setError(''); setQuote(null); setUnverifiedAcknowledged(false);
    try {
      if (!ownerAddress || !marketId || !venue || !scope || !tokenIn || !tokenOut) throw new Error('The market, venue, and account scope are incomplete.');
      if (isV4 && (!poolId || !poolKey || poolReadOnly || (poolKey.hooks && !/^0x0{40}$/i.test(poolKey.hooks)))) {
        throw new Error('This v4 pool has no reviewed wallet route. Hook pools remain read only.');
      }
      const slippageBps = Number(slippage);
      if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) throw new Error('Enter slippage from 1 to 500 basis points.');
      const amountUnits = parseMonadAmount(amount, tokenIn.decimals);
      const result = await monadApi.quote({accountScope: scope, venue, tokenIn: tokenIn.address, tokenOut: tokenOut.address,
        amountIn: amount.trim(), slippageBps, ...(isV4 && poolId ? {poolId, poolKey} : {})});
      if (result.venue !== venue || result.accountScope !== scope
          || result.tokenIn.toLowerCase() !== tokenIn.address.toLowerCase()
          || result.tokenOut.toLowerCase() !== tokenOut.address.toLowerCase()
          || BigInt(result.amountInUnits) !== BigInt(amountUnits)) throw new Error('The quote does not match the selected market, venue, scope, or input amount.');
      if (isV4) validateV4MarketQuote(result, {ownerAddress, poolId: poolId!, poolKey: poolKey!, verified,
        tokenIn: tokenIn.address, tokenOut: tokenOut.address});
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
      if (poolReadOnly) throw new Error('Hook pools remain read only until their route is reviewed.');
      if (needsUnverifiedWarning && !unverifiedAcknowledged) throw new Error('Acknowledge the unverified pool warning before preparing this swap.');
      if (!quoteFresh || !quoteMatches) throw new Error('This quote is stale or incomplete. Request a new quote.');
      const kind = 'wallet_swap' as const;
      const expected = {
        ownerAddress, kind, venue, accountScope: scope, tokenIn: tokenIn.address, tokenOut: tokenOut.address,
        amountInUnits: quote.amountInUnits, minAmountOutUnits: quote.minimumAmountOutUnits,
        inputDecimals: tokenIn.decimals, outputDecimals: tokenOut.decimals, quoteId: quote.quoteId,
        ...(isV4 ? {poolId, poolKey, gasCap: quote.gasCap!, unverifiedPoolWarning: quote.unverifiedPoolWarning} : {}),
      } as const;
      const prepared = await monadApi.prepare({
        kind, idempotencyKey: createMonadIdempotencyKey(), amountIn: amount.trim(),
        accountScope: scope, venue, tokenIn: tokenIn.address, tokenOut: tokenOut.address, slippageBps: Number(slippage), quoteId: quote.quoteId,
        ...(isV4 ? {poolId, poolKey} : {}),
      });
      if (monadTimestampMillis(quote.expiresAt) <= Date.now()) throw new Error('The quote expired while preparing. Request a new quote before signing.');
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
        : 'A fresh quote, exact pool, and gas cap are required before Mera can sign the prepared Monad transaction.'} />
    {error ? <Notice live tone="rose" title="Trade is not ready" message={error} actionLabel={quote ? 'Get a fresh quote' : undefined} onAction={quote ? () => { void getQuote(); } : undefined} /> : null}
    <Card>
      <DataRow label="Market" value={`${baseAsset.symbol}/${quoteAsset.symbol} · ${marketId}`} />
      <DataRow label="Account" value={scopeLabel} />
      <DataRow label="Venue" value={venueLabel} />
      {isV4 && poolId ? <DataRow label="Exact v4 Pool ID" value={poolId} /> : null}
      <View style={styles.sides}>{(['buy', 'sell'] as const).map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{selected: side === item}} onPress={() => { setSide(item); setQuote(null); setUnverifiedAcknowledged(false); }} style={[styles.side, side === item && styles.selected]}><Text style={styles.sideLabel}>{item}</Text></Pressable>)}</View>
      <Field label={`Amount in ${tokenIn.symbol}`} value={amount} onChangeText={value => { setAmount(value); setQuote(null); setUnverifiedAcknowledged(false); }} placeholder="0" keyboardType="decimal-pad" />
      <Field label="Maximum slippage (basis points)" value={slippage} onChangeText={value => { setSlippage(value); setQuote(null); setUnverifiedAcknowledged(false); }} keyboardType="number-pad" />
      <Button label="Get verified quote" onPress={() => { void getQuote(); }} loading={loading} />
    </Card>
    {quote ? <Card>
      <Text style={s.strong}>Quote review</Text>
      <DataRow label="Input" value={`${formatMonadUnits(quote.amountInUnits, tokenIn.decimals)} ${tokenIn.symbol}`} />
      <DataRow label="Expected output" value={`${formatMonadUnits(quote.amountOutUnits, tokenOut.decimals)} ${tokenOut.symbol}`} />
      <DataRow label="Minimum output" value={`${formatMonadUnits(quote.minimumAmountOutUnits, tokenOut.decimals)} ${tokenOut.symbol}`} />
      {feeLabel ? <DataRow label="Venue fee" value={feeLabel} /> : null}
      <DataRow label="Fee source" value={quote.feeProvenance} />
      {isV4 ? <>
        <DataRow label="Quoted Pool ID" value={quote.poolId ?? 'Missing Pool ID'} />
        <DataRow label="Quoted PoolKey" value={poolKey ? `${poolKey.currency0} / ${poolKey.currency1} · fee ${poolKey.fee} · tick ${poolKey.tickSpacing} · hooks ${poolKey.hooks}` : 'Missing PoolKey'} />
        <DataRow label="Quote owner and chain" value={`${quote.ownerAddress ?? 'Missing owner'} · ${quote.chainId ?? 'Missing chain'}`} />
        <DataRow label="Verification" value={quote.unverifiedPoolWarning ? 'Unverified pool · review carefully' : 'Operator verified'} />
      </> : null}
      {quote.gas ? <DataRow label="Estimated gas limit" value={quote.gas.gasLimit} /> : null}
      {isV4 && quote.gasCap ? <>
        <DataRow label="Gas limit cap" value={quote.gasCap.gasLimit} />
        <DataRow label="Maximum network fee at cap" value={`${formatMonadUnits(quote.gasCap.maxCostWei, 18)} MON`} />
        {approvalCheckQuote ? <Text style={s.body}>Gas estimation is unavailable before approval. This 3,000,000 gas cap is informational; use Check approval, then return and request a fresh executable quote.</Text> : null}
      </> : quote.gas ? <>
        <DataRow label="Max fee per gas" value={`${formatMonadUnits(quote.gas.maxFeePerGas, 9)} gwei`} />
        <DataRow label="Maximum network fee" value={`${formatMonadUnits(quote.gas.maxCostWei, 18)} MON`} />
      </> : <Text style={s.body}>{scope === 'vault' ? 'Operator gas is estimated when a vault order is prepared.' : 'No gas estimate returned.'}</Text>}
      <DataRow label="Quote expires" value={formatMonadTimestamp(quote.expiresAt)} />
      {needsUnverifiedWarning ? <Card tint="#FFF0D2">
        <Text style={s.strong}>Unverified pool warning</Text>
        <Text style={s.body}>This pool is outside the operator verified list. Confirm its exact Pool ID, token contracts, fee, hooks, quote, and minimum output before continuing.</Text>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked: unverifiedAcknowledged}} onPress={() => setUnverifiedAcknowledged(value => !value)} style={styles.acknowledgement}>
          <Text style={styles.checkbox}>{unverifiedAcknowledged ? '☑' : '□'}</Text><Text style={s.body}>I reviewed this unverified pool and want to continue.</Text>
        </Pressable>
      </Card> : null}
      {scope === 'wallet' ? <Button label={approvalCheckQuote ? 'Check approval' : prepareLabel} onPress={() => { void prepareTrade(); }} loading={loading} disabled={!quoteReady} />
        : <Text style={s.body}>Operator-run test trade: this quote is read-only in mobile. No vault transaction can be prepared or broadcast here.</Text>}
    </Card> : null}
    <Text style={s.body}>You can lose tokens when a trade executes. Review minimum output, venue, and maximum network fee before signing.</Text>
  </FlowScreen>;
}

const styles = StyleSheet.create({
  sides: {flexDirection: 'row', gap: spacing.sm},
  acknowledgement: {flexDirection: 'row', gap: spacing.sm, alignItems: 'center', minHeight: 48},
  checkbox: {...type.display, color: colors.ink, fontSize: 22},
  side: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper},
  selected: {backgroundColor: colors.pink},
  sideLabel: {...type.meta, color: colors.ink, textTransform: 'uppercase'},
});

function samePoolKey(actual: MonadQuote['poolKey'], expected?: V4PoolKey) {
  return Boolean(actual && expected && actual.currency0.toLowerCase() === expected.currency0.toLowerCase()
    && actual.currency1.toLowerCase() === expected.currency1.toLowerCase() && actual.fee === expected.fee
    && actual.tickSpacing === expected.tickSpacing && actual.hooks.toLowerCase() === expected.hooks.toLowerCase());
}
