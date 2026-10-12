import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {adjustLimitPriceByTick, type ManualPerplEntrySizing} from '../../services/manualPerplSizing';
import {formatMonadUnits} from '../../services/monadFormatting';
import type {ManualPerplOrder, ManualPerplPosition} from '../../types/manualPerpl';
import type {UserThemeTokens} from '../../theme/userThemes';
import {userFonts} from '../../theme/tokens';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../../components/user/UserPrimitives';

export type ManualOrderKind = 'market_entry' | 'limit_entry' | 'close_position' | 'reduce_size' | 'cancel_limit' | 'add_margin' | 'amend_limit';

export function UserPerplTradeView({theme, title, symbol, marketId, accountMode, accountStatus, accountAddress, freeAUsd,
  freeAUsdUnits, lockedAUsd, position, selectedOrder, kind, side, orderType, onSideChange, onOrderTypeChange, notionalAUsd, onNotionalChange,
  leverage, onLeverageChange, limitPrice, onLimitPriceChange, size, onSizeChange, marginAmount, onMarginChange, sizing,
  priceDecimals, sizeDecimals, pricePrecisionAvailable, sizePrecisionAvailable, allowed, busy, error, accountError, onRefresh, onBack, onPrepare, onOpenAccount}: {
  theme: UserThemeTokens; title: string; symbol: string; marketId: string; accountMode: 'direct_wallet' | 'legacy_delegated';
  accountStatus?: string; accountAddress: string | null; freeAUsd?: string; freeAUsdUnits?: string; lockedAUsd?: string;
  position: ManualPerplPosition | null; selectedOrder?: ManualPerplOrder; kind: ManualOrderKind;
  side: 'long' | 'short'; orderType: 'market' | 'limit'; onSideChange(value: 'long' | 'short'): void;
  onOrderTypeChange(value: 'market' | 'limit'): void; notionalAUsd: number; onNotionalChange(value: number): void;
  leverage: number; onLeverageChange(value: number): void; limitPrice: string; onLimitPriceChange(value: string): void;
  size: string; onSizeChange(value: string): void; marginAmount: string; onMarginChange(value: string): void;
  sizing: ManualPerplEntrySizing; priceDecimals: number; sizeDecimals: number; pricePrecisionAvailable: boolean; sizePrecisionAvailable: boolean; allowed: boolean; busy: boolean;
  error: string; accountError: string; onRefresh(): void; onBack(): void; onPrepare(): void; onOpenAccount(): void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [accountDetailsOpen, setAccountDetailsOpen] = useState(false);
  const [customSizeOpen, setCustomSizeOpen] = useState(false);
  const [customPriceOpen, setCustomPriceOpen] = useState(false);
  const entry = kind === 'market_entry' || kind === 'limit_entry';
  const reduce = kind === 'reduce_size';
  const margin = kind === 'add_margin';
  const amend = kind === 'amend_limit';
  const disabled = busy || !allowed || (entry && !sizing.canReview);
  const targets = notionalTargets(sizing.minNotionalAUsd, sizing.maxNotionalAUsd);
  const leverageChoices = [...new Set([1, 2, 3, sizing.maxLeverage].filter(value => value >= 1 && value <= sizing.maxLeverage))];
  const riskPrice = sizing.liquidationPrice === null || !pricePrecisionAvailable ? 'Unavailable' : price(sizing.liquidationPrice, priceDecimals);
  const actionLabel = entry ? `Review ${side} ${orderType} order`
    : kind === 'close_position' ? 'Review full close'
      : reduce ? 'Review position reduction' : kind === 'cancel_limit' ? 'Review order cancellation'
        : margin ? 'Review added margin' : 'Review price change';

  return <UserPage theme={theme}>
    <UserButton label="Back" onPress={onBack} theme={theme} secondary />
    <UserHeading theme={theme} kicker="Perpl · Monad Testnet" title={title}
      copy={accountMode === 'legacy_delegated' ? 'Recovery only. Each action uses a fresh Mera review.' : 'Choose an action; current account and market checks set the available limits.'} />
    {accountError ? <UserCard theme={theme}><UserText theme={theme} kind="title">Account needs a refresh</UserText>
      <UserText theme={theme}>{accountError}</UserText><UserButton label="Refresh account and market" onPress={onRefresh} theme={theme} secondary /></UserCard> : null}
    {error ? <UserCard theme={theme}><UserText theme={theme} kind="title">Review unavailable</UserText>
      <UserText theme={theme}>{error}</UserText><UserButton label="Refresh account" onPress={onRefresh} theme={theme} secondary /></UserCard> : null}
    {!entry ? <UserCard theme={theme}>
      <UserText theme={theme} kind="meta">{symbol}</UserText>
      {freeAUsd ? <UserValueRow theme={theme} label="Available collateral" value={`${freeAUsd} AUSD`} /> : null}
      {position ? <UserValueRow theme={theme} label="Position" value={`${humanize(position.side)} · ${scaled(position.sizeUnits, sizePrecisionAvailable ? sizeDecimals : null, `${symbol} size unavailable`)}`} /> : null}
      {selectedOrder ? <UserValueRow theme={theme} label="Open order" value={`${selectedOrder.side} · ${scaled(selectedOrder.sizeUnits, sizePrecisionAvailable ? sizeDecimals : null, 'Size unavailable')} · ${orderPrice(selectedOrder, priceDecimals, pricePrecisionAvailable)}`} /> : null}
      <UserDisclosure theme={theme} label="Account details" value="Owner and status" expanded={accountDetailsOpen} onPress={() => setAccountDetailsOpen(value => !value)}>
        <UserValueRow theme={theme} label="Account" value={accountMode === 'direct_wallet' ? 'Mera wallet' : 'Legacy recovery'} />
        {accountStatus ? <UserValueRow theme={theme} label="Status" value={humanize(accountStatus)} /> : null}
        {accountAddress ? <UserValueRow theme={theme} label="Perpl account" value={shortAddress(accountAddress)} /> : null}
        {lockedAUsd ? <UserValueRow theme={theme} label="Locked AUSD" value={`${lockedAUsd} AUSD`} /> : null}
        <UserValueRow theme={theme} label="Market ID" value={marketId} />
      </UserDisclosure>
    </UserCard> : null}

    {entry ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Choose order terms</UserText>
      <ChoiceGroup label="Direction">
        {(['long', 'short'] as const).map(value => <Choice key={value} label={humanize(value)} selected={side === value}
          onPress={() => onSideChange(value)} theme={theme} />)}
      </ChoiceGroup>
      <ChoiceGroup label="Order type">
        {(['market', 'limit'] as const).map(value => <Choice key={value} label={humanize(value)} selected={orderType === value}
          onPress={() => onOrderTypeChange(value)} theme={theme} />)}
      </ChoiceGroup>
      <UserText theme={theme} kind="meta">AUSD trade size · {money(notionalAUsd)} AUSD</UserText>
      <ChoiceGroup label="Trade size presets">
        {targets.map(target => <Choice key={target.label} label={target.label} selected={Math.abs(notionalAUsd - target.value) < 0.000001}
          disabled={sizing.maxNotionalAUsd < sizing.minNotionalAUsd || sizing.maxNotionalAUsd <= 0}
          onPress={() => onNotionalChange(target.value)} theme={theme} />)}
      </ChoiceGroup>
      <UserDisclosure theme={theme} label="Custom trade size" value="Enter AUSD" expanded={customSizeOpen} onPress={() => setCustomSizeOpen(value => !value)}>
        <TextInput accessibilityLabel="Custom AUSD trade size" keyboardType="decimal-pad" value={notionalAUsd ? String(Number(notionalAUsd.toFixed(6))) : ''}
          onChangeText={value => onNotionalChange(value.trim() ? Number(value) : 0)} style={[styles.input, {color: theme.ink, borderColor: theme.border, backgroundColor: theme.raised}]} />
      </UserDisclosure>
      <UserText theme={theme} kind="meta">Leverage · {leverage}×</UserText>
      {freeAUsd ? <UserValueRow theme={theme} label="Available AUSD collateral" value={`${freeAUsd} AUSD`} /> : null}
      <ChoiceGroup label="Leverage presets">
        {leverageChoices.map(value => <Choice key={value} label={`${value}×`} selected={leverage === value}
          onPress={() => onLeverageChange(value)} theme={theme} />)}
      </ChoiceGroup>
      {orderType === 'limit' ? <>
        <UserValueRow theme={theme} label="Limit price · AUSD" value={pricePrecisionAvailable ? limitPrice || 'Waiting for live quote' : 'Price precision unavailable'} />
        <View style={styles.choices}>
          <Choice label="− one tick" selected={false} disabled={!limitPrice} onPress={() => onLimitPriceChange(adjustLimitPriceByTick(limitPrice, priceDecimals, -1))} theme={theme} />
          <Choice label="+ one tick" selected={false} disabled={!limitPrice} onPress={() => onLimitPriceChange(adjustLimitPriceByTick(limitPrice, priceDecimals, 1))} theme={theme} />
        </View>
        <UserDisclosure theme={theme} label="Type a limit price" value="Advanced" expanded={customPriceOpen} onPress={() => setCustomPriceOpen(value => !value)}>
          <TextInput accessibilityLabel="Limit price · AUSD" keyboardType="decimal-pad" value={limitPrice}
            onChangeText={onLimitPriceChange} style={[styles.input, {color: theme.ink, borderColor: theme.border, backgroundColor: theme.raised}]} />
        </UserDisclosure>
      </> : null}
      <UserValueRow theme={theme} label="Leverage" value={`${leverage}×`} />
      <UserValueRow theme={theme} label="Estimated size" value={sizePrecisionAvailable ? `${sizing.size} ${symbol}` : 'Unavailable'} />
      <UserValueRow theme={theme} label="Estimated entry price" value={pricePrecisionAvailable ? price(sizing.entryPrice, priceDecimals) : 'Unavailable'} />
      <UserValueRow theme={theme} label="Estimated entry fee" value={`${money(sizing.entryFeeAUsd)} AUSD`} />
      <UserValueRow theme={theme} label="Estimated liquidation price" value={riskPrice}
        detail={sizing.liquidationDistancePct === null ? 'Risk estimate unavailable' : `About ${sizing.liquidationDistancePct.toFixed(2)}% from entry`} />
      <UserText theme={theme} kind="meta">Perpl may liquidate a position. Liquidation estimates can change with mark price, fees and funding.</UserText>
      {sizing.reason ? <UserText theme={theme} kind="meta">{sizing.reason}</UserText> : null}
      <UserButton label={actionLabel} onPress={onPrepare} theme={theme} loading={busy} disabled={disabled} />
      <UserDisclosure theme={theme} label="More estimate details" value="Fees and market depth" expanded={detailsOpen} onPress={() => setDetailsOpen(value => !value)}>
        <UserValueRow theme={theme} label="Estimated isolated margin" value={`${money(sizing.marginAUsd)} AUSD`} />
        <UserValueRow theme={theme} label="Estimated exit fee" value={`${money(sizing.exitFeeAUsd)} AUSD`} />
        <UserValueRow theme={theme} label="Estimated break-even price" value={price(sizing.breakEvenPrice, priceDecimals)} />
        <UserValueRow theme={theme} label="Spread" value={sizing.spreadBps === null ? 'Unavailable' : `${sizing.spreadBps.toFixed(1)} bps`} />
        <UserValueRow theme={theme} label={orderType === 'market' ? 'Estimated book impact' : 'Book depth within 100 bps'}
          value={orderType === 'market' ? sizing.impactBps === null ? 'Unavailable' : `${sizing.impactBps.toFixed(1)} bps`
            : sizing.executableDepthAUsd === null ? 'Unavailable' : `${money(sizing.executableDepthAUsd)} AUSD`} />
        <UserText theme={theme}>{sizing.liquidationCaveat}</UserText>
      </UserDisclosure>
    </UserCard> : null}

    {reduce ? <UserCard theme={theme}><UserText theme={theme} kind="title">Choose reduction size</UserText>
      {position ? <UserValueRow theme={theme} label="Current position" value={`${scaled(position.sizeUnits, sizePrecisionAvailable ? sizeDecimals : null, 'Size unavailable')} ${symbol}`} /> : null}
      <ChoiceGroup label="Reduction presets">
      {[25, 50].map(percent => <Choice key={percent} label={`${percent}%`} selected={false}
          disabled={!position || !sizePrecisionAvailable} onPress={() => position && sizePrecisionAvailable && onSizeChange(reductionAmount(position.sizeUnits, sizeDecimals, percent))} theme={theme} />)}
      </ChoiceGroup>
      <UserDisclosure theme={theme} label="Custom reduction" value="Enter position size" expanded={customSizeOpen} onPress={() => setCustomSizeOpen(value => !value)}>
        <TextInput accessibilityLabel="Size to reduce" keyboardType="decimal-pad" value={size} onChangeText={onSizeChange}
          placeholder="Enter partial size" placeholderTextColor={theme.muted} style={[styles.input, {color: theme.ink, borderColor: theme.border, backgroundColor: theme.raised}]} />
      </UserDisclosure>
      <UserText theme={theme}>The service will recheck the current position before preparing this partial reduction.</UserText>
    </UserCard> : null}
    {margin ? <UserCard theme={theme}><UserText theme={theme} kind="title">Add AUSD to this position</UserText>
      {freeAUsdUnits ? <ChoiceGroup label="AUSD margin presets">
        {marginTargets(freeAUsdUnits).map(target => <Choice key={target.units} label={`${target.label} · ${formatMonadUnits(target.units, 6)} AUSD`}
          selected={amountToUnits(marginAmount) === target.units} onPress={() => onMarginChange(formatMonadUnits(target.units, 6))} theme={theme} />)}
      </ChoiceGroup> : <UserText theme={theme}>Available AUSD is unavailable. Refresh before preparing margin.</UserText>}
      <UserDisclosure theme={theme} label="Custom margin" value="Enter AUSD" expanded={customSizeOpen} onPress={() => setCustomSizeOpen(value => !value)}>
        <TextInput accessibilityLabel="AUSD margin to add" keyboardType="decimal-pad" value={marginAmount} onChangeText={onMarginChange}
          placeholder="Enter AUSD amount" placeholderTextColor={theme.muted} style={[styles.input, {color: theme.ink, borderColor: theme.border, backgroundColor: theme.raised}]} />
      </UserDisclosure>
      <UserText theme={theme}>This uses free AUSD in the separate Perpl account. It does not move AUSD from your wallet.</UserText>
    </UserCard> : null}
    {amend ? <UserCard theme={theme}><UserText theme={theme} kind="title">Change limit price</UserText>
      {selectedOrder ? <UserValueRow theme={theme} label="Current price" value={orderPrice(selectedOrder, priceDecimals, pricePrecisionAvailable)} detail={`${selectedOrder.side} · ${scaled(selectedOrder.sizeUnits, sizePrecisionAvailable ? sizeDecimals : null, 'Size unavailable')} ${symbol}`} /> : null}
      <UserValueRow theme={theme} label="New limit price" value={limitPrice || 'Unavailable'} />
      <View style={styles.choices}>
        <Choice label="− one tick" selected={false} disabled={!pricePrecisionAvailable || !limitPrice} onPress={() => onLimitPriceChange(adjustLimitPriceByTick(limitPrice, priceDecimals, -1))} theme={theme} />
        <Choice label="+ one tick" selected={false} disabled={!pricePrecisionAvailable || !limitPrice} onPress={() => onLimitPriceChange(adjustLimitPriceByTick(limitPrice, priceDecimals, 1))} theme={theme} />
      </View>
      <UserDisclosure theme={theme} label="Type a limit price" value="Advanced" expanded={customPriceOpen} onPress={() => setCustomPriceOpen(value => !value)}>
        <TextInput accessibilityLabel="New limit price" keyboardType="decimal-pad" value={limitPrice} onChangeText={onLimitPriceChange}
          placeholder="Enter new price" placeholderTextColor={theme.muted} style={[styles.input, {color: theme.ink, borderColor: theme.border, backgroundColor: theme.raised}]} />
      </UserDisclosure>
      <UserText theme={theme}>Only the price changes. The service rechecks the open order and keeps its current side and size.</UserText>
    </UserCard> : null}
    {kind === 'cancel_limit' ? <UserCard theme={theme}><UserText theme={theme} kind="title">Cancel this order?</UserText>
      <UserText theme={theme}>The service will confirm this order is still open before preparing a Mera review.</UserText>
    </UserCard> : null}
    {kind === 'close_position' ? <UserCard theme={theme}><UserText theme={theme} kind="title">Close the full position?</UserText>
      <UserText theme={theme}>The close uses the current verified side and full position size. Perpl rechecks both before preparing.</UserText>
    </UserCard> : null}
    {!entry ? <UserButton label={actionLabel} onPress={onPrepare} theme={theme} loading={busy}
      disabled={disabled || (reduce && !sizePrecisionAvailable) || (margin && !freeAUsdUnits) || (amend && (!pricePrecisionAvailable || !sizePrecisionAvailable || !limitPrice))} /> : null}
    <UserButton label="Manual Perpl account" onPress={onOpenAccount} theme={theme} secondary />
  </UserPage>;
}

function ChoiceGroup({label, children}: React.PropsWithChildren<{label: string}>) {
  return <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>{children}</View>;
}
function Choice({label, selected, disabled = false, onPress, theme}: {label: string; selected: boolean; disabled?: boolean; onPress(): void; theme: UserThemeTokens}) {
  return <Pressable accessibilityRole="radio" accessibilityState={{selected, disabled}} accessibilityLabel={label} onPress={onPress} disabled={disabled}
    style={({pressed}) => [styles.choice, {backgroundColor: selected ? theme.accentSoft : theme.raised,
      borderColor: selected ? theme.accent : theme.border, opacity: disabled ? 0.45 : 1}, pressed && styles.pressed]}>
    <Text style={[styles.choiceText, {color: theme.ink}]}>{label}</Text>
  </Pressable>;
}
function notionalTargets(min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min || max <= 0) return [];
  if (Math.abs(max - min) < 0.000001) return [{label: `${money(max)} AUSD`, value: max}];
  const midpoint = Math.max(min, max * 0.5);
  const threeQuarter = Math.max(min, max * 0.75);
  return [{label: `${money(midpoint)} AUSD`, value: midpoint}, {label: `${money(threeQuarter)} AUSD`, value: threeQuarter}, {label: `Max · ${money(max)}`, value: max}];
}
function reductionAmount(units: string, decimals: number, percentage: number) {
  try { return formatMonadUnits((BigInt(units) * BigInt(percentage) / 100n).toString(), decimals); } catch { return ''; }
}
function marginTargets(units: string) {
  try {
    const maximum = BigInt(units);
    if (maximum <= 0n) return [];
    const values = [{label: '25%', units: maximum * 25n / 100n}, {label: '50%', units: maximum / 2n}, {label: 'Max', units: maximum}];
    return values.filter((value, index) => value.units > 0n && values.findIndex(item => item.units === value.units) === index)
      .map(value => ({label: value.label, units: value.units.toString()}));
  } catch { return []; }
}
function amountToUnits(value: string) {
  try { const [whole, fraction = ''] = value.split('.'); return (BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))).toString(); }
  catch { return null; }
}
function scaled(value: string | null | undefined, decimals: number | null, unavailable: string) {
  return !value || decimals === null ? unavailable : formatMonadUnits(value, decimals);
}
function orderPrice(order: ManualPerplOrder, decimals: number, available: boolean) {
  if (order.price == null) return 'Market';
  return available && typeof order.pricePNS === 'string' ? formatMonadUnits(order.pricePNS, decimals) : 'Price unavailable';
}
function price(value: number | null, decimals: number) { return value === null ? 'Unavailable' : value.toLocaleString(undefined, {maximumFractionDigits: Math.min(decimals, 8)}); }
function money(value: number) { return Number.isFinite(value) ? value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 4}) : 'Unavailable'; }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }

const styles = StyleSheet.create({
  choices: {flexDirection: 'row', gap: 8, flexWrap: 'wrap'},
  choice: {minHeight: 48, minWidth: 72, flexGrow: 1, borderWidth: 2, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8},
  choiceText: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 20, fontWeight: '800', textAlign: 'center'},
  input: {minHeight: 52, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 10, fontFamily: userFonts.body, fontSize: 16, lineHeight: 22, fontWeight: '700'},
  pressed: {transform: [{translateX: 2}, {translateY: 2}]},
});
