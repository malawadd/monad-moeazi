import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import type {MonadAccountScope, MonadMarketAsset, MonadQuote, MonadVenueId} from '../types/monad';
import type {V4PoolKey} from '../types/marketDirectory';
import type {UserThemeTokens} from '../theme/userThemes';

export function UserSpotTradeReviewView({theme, marketId, accountScope, baseAsset, quoteAsset, venue, venueLabel, poolId, poolKey,
  side, amount, inputBalance, slippage, quote, quoteReady, needsUnverifiedWarning, unverifiedAcknowledged, approvalCheckQuote, feeLabel,
  loading, error, onBack, onSideChange, onAmountChange, onSlippageChange, onGetQuote, onAcknowledge, onPrepare}: {
  theme: UserThemeTokens; marketId: string; accountScope: MonadAccountScope; baseAsset: MonadMarketAsset; quoteAsset: MonadMarketAsset;
  venue: MonadVenueId; venueLabel: string; poolId?: string; poolKey?: V4PoolKey; side: 'buy' | 'sell'; amount: string;
  inputBalance?: {amountUnits: string; decimals: number}; slippage: string;
  quote: MonadQuote | null; quoteReady: boolean; needsUnverifiedWarning: boolean; unverifiedAcknowledged: boolean;
  approvalCheckQuote: boolean; feeLabel: string | null; loading: boolean; error: string;
  onBack(): void; onSideChange(value: 'buy' | 'sell'): void; onAmountChange(value: string): void; onSlippageChange(value: string): void;
  onGetQuote(): void; onAcknowledge(): void; onPrepare(): void;
}) {
  const [slippageOpen, setSlippageOpen] = useState(false);
  const [amountOpen, setAmountOpen] = useState(false);
  const [poolDetailsOpen, setPoolDetailsOpen] = useState(false);
  const tokenIn = (side === 'buy' ? quoteAsset : baseAsset) as MonadMarketAsset;
  const tokenOut = (side === 'buy' ? baseAsset : quoteAsset) as MonadMarketAsset;
  if (!baseAsset || !quoteAsset) return <UserPage theme={theme}><UserButton label="Back to market" onPress={onBack} theme={theme} secondary />
    <UserHeading theme={theme} kicker="Spot swap" title="Market route unavailable" copy="Return to Markets and choose an available wallet route." /></UserPage>;
  return <UserPage theme={theme}>
    <UserButton label="Back to market" onPress={onBack} theme={theme} secondary />
    <UserHeading theme={theme} kicker="SPOT · MONAD TESTNET" title={`Swap ${tokenIn.symbol}`} copy="Spot swaps exchange one asset for another. They do not open a leveraged position." />
    {error ? <UserCard theme={theme}><UserText theme={theme} kind="title">Quote needs attention</UserText><UserText theme={theme}>{error}</UserText></UserCard> : null}
    <UserCard theme={theme} texture>
      <UserText theme={theme} kind="meta">{accountScope === 'wallet' ? 'MERA WALLET' : 'MANAGED VAULT · READ ONLY'}</UserText>
      <UserValueRow theme={theme} label="Market" value={`${baseAsset.symbol} / ${quoteAsset.symbol}`} detail={venueLabel} />
      <View accessibilityRole="radiogroup" accessibilityLabel="Swap direction" style={styles.directions}>
        {(['buy', 'sell'] as const).map(option => <Pressable key={option} accessibilityRole="radio" accessibilityLabel={`${option} ${baseAsset.symbol}`}
          accessibilityState={{selected: side === option}} onPress={() => onSideChange(option)}
          style={[styles.direction, {borderColor: side === option ? theme.accent : theme.border,
            backgroundColor: side === option ? theme.accentSoft : theme.raised}]}>
          <Text style={[styles.directionText, {color: theme.ink}]}>{option === 'buy' ? `Buy ${baseAsset.symbol}` : `Sell ${baseAsset.symbol}`}</Text>
        </Pressable>)}
      </View>
      <Text style={[styles.fieldLabel, {color: theme.muted}]}>You send · {tokenIn.symbol}</Text>
      {inputBalance && inputBalance.decimals === tokenIn.decimals && validUnits(inputBalance.amountUnits) ? <View accessibilityRole="radiogroup"
        accessibilityLabel={`Amount from available ${tokenIn.symbol}`} style={styles.presets}>
        {[25, 50, 75, 100].map(percent => {
          const units = (BigInt(inputBalance.amountUnits) * BigInt(percent) / 100n).toString();
          const formatted = formatMonadUnits(units, inputBalance.decimals);
          const selected = amount === formatted;
          return <Pressable key={percent} accessibilityRole="radio" accessibilityLabel={`${percent} percent · ${formatted} ${tokenIn.symbol}`}
            accessibilityState={{selected}} onPress={() => onAmountChange(formatted)}
            style={[styles.preset, {borderColor: selected ? theme.accent : theme.border,
              backgroundColor: selected ? theme.accentSoft : theme.raised}]}>
            <Text style={[styles.presetText, {color: theme.ink}]}>{percent}%</Text>
            <Text style={[styles.presetAmount, {color: theme.muted}]}>{formatted} {tokenIn.symbol}</Text>
          </Pressable>;
        })}
      </View> : <UserText theme={theme} kind="meta">Available balance is not current for this wallet. Enter an amount to request a fresh quote.</UserText>}
      <UserDisclosure theme={theme} label="Custom amount" value={amount || `Enter ${tokenIn.symbol}`} expanded={amountOpen}
        onPress={() => setAmountOpen(value => !value)}>
        {amountOpen ? <TextInput accessibilityLabel={`Amount in ${tokenIn.symbol}`} value={amount} onChangeText={onAmountChange} keyboardType="decimal-pad"
          placeholder="0" placeholderTextColor={theme.muted} style={[styles.input, {borderColor: theme.border, backgroundColor: theme.raised, color: theme.ink}]} /> : null}
      </UserDisclosure>
      <Text style={[styles.fieldLabel, {color: theme.muted}]}>Maximum slippage</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Maximum slippage" style={styles.presets}>
        {[{bps: '10', label: '0.1%'}, {bps: '50', label: '0.5%'}, {bps: '100', label: '1%'}].map(option => <Pressable key={option.bps}
          accessibilityRole="radio" accessibilityLabel={`${option.label} slippage`} accessibilityState={{selected: slippage === option.bps}}
          onPress={() => onSlippageChange(option.bps)} style={[styles.slippagePreset, {borderColor: slippage === option.bps ? theme.accent : theme.border,
            backgroundColor: slippage === option.bps ? theme.accentSoft : theme.raised}]}>
          <Text style={[styles.presetText, {color: theme.ink}]}>{option.label}</Text>
        </Pressable>)}
      </View>
      <UserDisclosure theme={theme} label="Custom slippage" value={`${slippage} bps`} expanded={slippageOpen}
        onPress={() => setSlippageOpen(value => !value)}>
        <UserText theme={theme} kind="meta">Choose from 1 to 500 basis points.</UserText>
        {slippageOpen ? <TextInput accessibilityLabel="Maximum slippage (basis points)" value={slippage} onChangeText={onSlippageChange} keyboardType="number-pad"
          style={[styles.input, {borderColor: theme.border, backgroundColor: theme.raised, color: theme.ink}]} /> : null}
      </UserDisclosure>
      {accountScope === 'wallet' ? <UserButton label="Get verified quote" onPress={onGetQuote} theme={theme} loading={loading} />
        : <UserText theme={theme}>A vault quote is available for review only. The local operator controls vault execution.</UserText>}
    </UserCard>
    {quote ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Check this swap</UserText>
      <UserValueRow theme={theme} label="From" value={`${formatMonadUnits(quote.amountInUnits, tokenIn.decimals)} ${tokenIn.symbol}`} />
      <UserValueRow theme={theme} label="Expected" value={`${formatMonadUnits(quote.amountOutUnits, tokenOut.decimals)} ${tokenOut.symbol}`} />
      <UserValueRow theme={theme} label="Minimum received" value={`${formatMonadUnits(quote.minimumAmountOutUnits, tokenOut.decimals)} ${tokenOut.symbol}`} />
      {feeLabel ? <UserValueRow theme={theme} label="Venue fee" value={feeLabel} /> : null}
      <UserValueRow theme={theme} label="Maximum network fee" value={quote.gasCap
        ? `${formatMonadUnits(quote.gasCap.maxCostWei, 18)} MON`
        : quote.gas ? `${formatMonadUnits(quote.gas.maxCostWei, 18)} MON` : 'Unavailable'} />
      <UserValueRow theme={theme} label="Quote expires" value={formatMonadTimestamp(quote.expiresAt)} />
      {needsUnverifiedWarning ? <View style={[styles.warning, {borderColor: theme.border, backgroundColor: theme.warning}]}>
        <UserText theme={theme} kind="title">Pool not verified</UserText>
        <UserText theme={theme}>Check the pool and minimum received before continuing.</UserText>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked: unverifiedAcknowledged}} onPress={onAcknowledge}
          style={[styles.acknowledge, {borderColor: theme.border}]}>
          <Text style={[styles.check, {color: theme.ink}]}>{unverifiedAcknowledged ? '☑' : '□'}</Text>
          <UserText theme={theme} style={{flex: 1}}>I checked this pool and want to continue.</UserText>
        </Pressable>
      </View> : null}
      <UserDisclosure theme={theme} label="Pool and quote details" value="Network details" expanded={poolDetailsOpen}
        onPress={() => setPoolDetailsOpen(value => !value)}>
        <UserValueRow theme={theme} label="Market ID" value={marketId} />
        <UserValueRow theme={theme} label="Venue" value={`${venue} · ${venueLabel}`} />
        {poolId ? <UserValueRow theme={theme} label="Pool ID" value={poolId} /> : null}
        {poolKey ? <UserValueRow theme={theme} label="Pool tokens" value={`${poolKey.currency0} / ${poolKey.currency1}`} /> : null}
        {poolKey ? <UserValueRow theme={theme} label="Pool fee · tick · hooks" value={`${poolKey.fee} · ${poolKey.tickSpacing} · ${poolKey.hooks}`} /> : null}
        <UserValueRow theme={theme} label="Fee source" value={quote.feeProvenance} />
        <UserValueRow theme={theme} label="Quote ID" value={quote.quoteId} />
        {quote.gasCap ? <UserValueRow theme={theme} label="Gas limit cap" value={quote.gasCap.gasLimit} /> : null}
      </UserDisclosure>
      {accountScope === 'wallet' ? <UserButton label={approvalCheckQuote ? 'Check approval' : 'Review exact swap'} theme={theme}
        onPress={onPrepare} loading={loading} disabled={!quoteReady} /> : null}
    </UserCard> : null}
    <UserText theme={theme} kind="meta">A swap can lose value. Check the minimum received and network fee before signing.</UserText>
  </UserPage>;
}

const styles = StyleSheet.create({
  presets: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  preset: {flexGrow: 1, minWidth: 110, minHeight: 48, borderWidth: 2, padding: 8, justifyContent: 'center'},
  slippagePreset: {flexGrow: 1, minWidth: 72, minHeight: 48, borderWidth: 2, padding: 8, justifyContent: 'center', alignItems: 'center'},
  presetText: {fontSize: 14, lineHeight: 19, fontWeight: '800', textAlign: 'center'},
  presetAmount: {fontSize: 11, lineHeight: 15, fontWeight: '700', textAlign: 'center'},
  directions: {flexDirection: 'row', gap: 10},
  direction: {flex: 1, minHeight: 50, borderWidth: 3, alignItems: 'center', justifyContent: 'center', padding: 8},
  directionText: {fontWeight: '800', textAlign: 'center'},
  fieldLabel: {fontSize: 13, fontWeight: '700'},
  input: {minHeight: 52, borderWidth: 2, paddingHorizontal: 12, fontSize: 17, fontWeight: '700'},
  warning: {borderWidth: 3, padding: 12, gap: 8},
  acknowledge: {minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingTop: 8},
  check: {fontSize: 21},
});
function validUnits(value: string) { return /^(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n; }
