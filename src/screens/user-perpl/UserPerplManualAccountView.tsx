import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../../components/user/UserPrimitives';
import {formatMonadTimestamp, formatMonadUnits} from '../../services/monadFormatting';
import type {ManualPerplAccount, ManualPerplLegacyRecovery, ManualPerplOrder, ManualPerplPosition} from '../../types/manualPerpl';
import type {UserThemeTokens} from '../../theme/userThemes';
import {userFonts} from '../../theme/tokens';

export type ManualAccountAction = 'approve' | 'open' | 'deposit' | 'withdraw' | 'legacy_withdraw' | 'legacy_rescue';
export type ManualTradeAction = 'close_position' | 'reduce_size' | 'cancel_limit' | 'amend_limit';
export type UserMarketPrecision = {marketId: string; symbol?: string; priceDecimals?: number; sizeDecimals?: number};

export function UserPerplManualAccountView({theme, account, markets, loading, readError, contextError, contextLoading,
  minimumOpenUnits, minimumDepositUnits, minimumWithdrawalUnits, amount, setAmount, legacyAmount, setLegacyAmount, directUnits, directCanApprove, directCanOpen,
  directCanDeposit, directCanWithdraw, allowanceMatches, openDisabledReason, busy, error, manualGateOff,
  onBack, onRefresh, onPrepare, onManagePosition, onPositionAction, onOrderAction}: {
  theme: UserThemeTokens; account: ManualPerplAccount | null; markets: UserMarketPrecision[]; loading: boolean;
  readError: string; contextError: string; contextLoading: boolean; minimumOpenUnits: string | null; minimumDepositUnits: string | null;
  minimumWithdrawalUnits: string | null;
  amount: string; setAmount(value: string): void; legacyAmount: string; setLegacyAmount(value: string): void;
  directUnits: string | null; directCanApprove: boolean; directCanOpen: boolean; directCanDeposit: boolean; directCanWithdraw: boolean;
  allowanceMatches: boolean; openDisabledReason: string | null; busy: boolean; error: string; manualGateOff: boolean;
  onBack(): void; onRefresh(): void; onPrepare(action: ManualAccountAction): void; onManagePosition(position: ManualPerplPosition): void;
  onPositionAction(position: ManualPerplPosition, action: 'close_position' | 'reduce_size', legacy: boolean): void;
  onOrderAction(order: ManualPerplOrder, market: UserMarketPrecision | undefined, action: 'cancel_limit' | 'amend_limit', legacy: boolean): void;
}) {
  const [accountDetailsOpen, setAccountDetailsOpen] = useState(false);
  const [moveDirection, setMoveDirection] = useState<'deposit' | 'withdraw'>('deposit');
  return <UserPage theme={theme}>
    <UserButton label="Back" onPress={onBack} theme={theme} secondary />
    <UserHeading theme={theme} kicker="Perpl · Monad Testnet" title="Perpl account" copy="Manage AUSD and orders in your Mera-owned account. Every change gets a fresh review." />
    {readError ? <UserCard theme={theme}><UserText theme={theme} kind="title">Account needs attention</UserText>
      <UserText theme={theme}>{readError}</UserText><UserButton label="Refresh account" onPress={onRefresh} theme={theme} secondary /></UserCard> : null}
    {contextError ? <UserCard theme={theme}><UserText theme={theme} kind="title">Account setup limits unavailable</UserText>
      <UserText theme={theme}>Refresh before reviewing a deposit or opening your account.</UserText>
      <UserButton label="Refresh limits" onPress={onRefresh} theme={theme} secondary /></UserCard> : null}
    {error ? <UserCard theme={theme}><UserText theme={theme} kind="title">Action could not be prepared</UserText>
      <UserText theme={theme}>{error}</UserText><UserButton label="Refresh account" onPress={onRefresh} theme={theme} secondary /></UserCard> : null}
    {manualGateOff ? <UserCard theme={theme}><UserText theme={theme} kind="title">Manual Perpl actions unavailable</UserText>
      <UserText theme={theme}>The Testnet service has not enabled account changes for this session.</UserText></UserCard> : null}
    {!account && loading ? <UserCard theme={theme}><UserText theme={theme}>Checking your Perpl account…</UserText></UserCard> : null}
    {!account && !loading && !readError ? <UserCard theme={theme}><UserText theme={theme} kind="title">Account details unavailable</UserText>
      <UserButton label="Try again" onPress={onRefresh} theme={theme} secondary /></UserCard> : null}
    {account ? <>
      <UserCard theme={theme} texture>
        <UserText theme={theme} kind="meta">{account.status === 'open' ? 'ACCOUNT OPEN' : humanize(account.status)}</UserText>
        <UserValueRow theme={theme} label="Mera wallet" value={account.status === 'unavailable' ? 'Unavailable' : amountUnits(account.collateral.walletBalanceUnits, 6)} />
        {account.status === 'open' ? <>
          <UserValueRow theme={theme} label="Perpl balance" value={amountUnits(account.collateral.balanceUnits, 6)} />
          <UserValueRow theme={theme} label="Free to withdraw" value={amountUnits(freeUnits(account.collateral.balanceUnits, account.collateral.lockedUnits), 6)} />
        </> : null}
        <UserDisclosure theme={theme} label="Account details" value="Allowance and owner" expanded={accountDetailsOpen}
          onPress={() => setAccountDetailsOpen(value => !value)}>
          <UserValueRow theme={theme} label="AUSD allowance" value={account.status === 'unavailable' ? 'Unavailable' : amountUnits(account.collateral.allowanceUnits, 6)} detail="Allowance for Perpl" />
          <UserValueRow theme={theme} label="Locked in Perpl" value={account.status === 'unavailable' ? 'Unavailable' : amountUnits(account.collateral.lockedUnits, 6)} />
          <UserValueRow theme={theme} label="Account owner" value={account.status === 'unavailable' ? 'Unavailable' : account.accountAddress ? shortAddress(account.accountAddress) : 'Not open'} />
          <UserValueRow theme={theme} label="Last checked" value={formatMonadTimestamp(account.observedAt)} />
        </UserDisclosure>
      </UserCard>
      {account.status === 'not_created' ? <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Open your Perpl account</UserText>
        {minimumOpenUnits ? <UserValueRow theme={theme} label="Live minimum" value={amountUnits(minimumOpenUnits, 6)} /> : null}
        <AmountEntry accessibilityLabel="AUSD amount" amount={amount} setAmount={setAmount} theme={theme}
          groups={[{label: 'From Mera wallet', maximum: account.collateral.walletBalanceUnits, minimum: minimumOpenUnits}]} />
        {directCanApprove ? <UserButton label="Review exact AUSD approval with Mera" onPress={() => onPrepare('approve')} theme={theme} secondary loading={busy} /> : null}
        <UserButton label="Review account opening with Mera" onPress={() => onPrepare('open')} theme={theme} loading={busy}
          disabled={!directCanOpen || contextLoading || Boolean(contextError)} />
        <UserText theme={theme} kind="meta">Approval and account opening are separate reviews.</UserText>
        {!directCanOpen && openDisabledReason ? <UserText theme={theme} kind="meta">{openDisabledReason}</UserText> : null}
      </UserCard> : null}
      {account.status === 'open' ? <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Move AUSD</UserText>
        <DirectionChoice selected={moveDirection} onChange={setMoveDirection} theme={theme} />
        {moveDirection === 'deposit' ? <UserValueRow theme={theme} label="Live deposit minimum"
          value={minimumDepositUnits ? amountUnits(minimumDepositUnits, 6) : contextLoading ? 'Loading' : 'Unavailable'} /> : null}
        {moveDirection === 'withdraw' ? <UserValueRow theme={theme} label="Live withdrawal minimum"
          value={minimumWithdrawalUnits ? amountUnits(minimumWithdrawalUnits, 6) : contextLoading ? 'Loading' : 'Unavailable'} /> : null}
        <AmountEntry accessibilityLabel="AUSD amount" amount={amount} setAmount={setAmount} theme={theme} groups={[
          moveDirection === 'deposit'
            ? {label: 'From Mera wallet', maximum: account.collateral.walletBalanceUnits, minimum: minimumDepositUnits}
            : {label: 'From free Perpl balance', maximum: freeUnits(account.collateral.balanceUnits, account.collateral.lockedUnits), minimum: minimumWithdrawalUnits},
        ]} />
        {error ? <UserText theme={theme} kind="title">{error}</UserText> : null}
        {moveDirection === 'deposit' ? <>
          {!minimumDepositUnits && !contextLoading ? <UserText theme={theme}>A deposit cannot be reviewed until Perpl returns its live minimum. Refresh the limits.</UserText> : null}
          {directUnits && !allowanceMatches ? <UserText theme={theme} kind="meta">This amount needs an exact AUSD allowance, then a fresh account check.</UserText> : null}
          {directCanApprove ? <UserButton label="Review exact AUSD approval with Mera" onPress={() => onPrepare('approve')} theme={theme} secondary loading={busy} /> : null}
          {allowanceMatches ? <UserButton label="Review AUSD deposit with Mera" onPress={() => onPrepare('deposit')} theme={theme} loading={busy} disabled={!directCanDeposit} /> : null}
        </> : <UserButton label="Review free AUSD withdrawal with Mera" onPress={() => onPrepare('withdraw')} theme={theme} secondary loading={busy}
          disabled={!directCanWithdraw || !minimumWithdrawalUnits || contextLoading || Boolean(contextError)} />}
      </UserCard> : null}
      {account.status === 'open' ? <>
        <PositionCards positions={account.positions} markets={markets} theme={theme} onManage={onManagePosition}
          canClose={account.capabilities.closePosition} canReduce={account.capabilities.reducePosition}
          onAction={(position, action) => onPositionAction(position, action, false)} legacy={false} />
        <OrderCards orders={account.orders} markets={markets} theme={theme} canCancel={account.capabilities.cancelOrders}
          canAmend={account.capabilities.limitOrders} onAction={(order, market, action) => onOrderAction(order, market, action, false)} legacy={false} />
      </> : null}
      <LegacyCard account={account.legacyRecovery} markets={markets} amount={legacyAmount} setAmount={setLegacyAmount} theme={theme} busy={busy}
        minimumWithdrawalUnits={minimumWithdrawalUnits}
        onPrepare={onPrepare} onPositionAction={(position, action) => onPositionAction(position, action, true)}
        onOrderAction={(order, action) => onOrderAction(order, undefined, action, true)} />
    </> : null}
  </UserPage>;
}

function PositionCards({positions, markets, theme, canClose, canReduce, onManage, onAction, legacy}: {
  positions: ManualPerplPosition[]; markets: UserMarketPrecision[]; theme: UserThemeTokens; canClose: boolean; canReduce: boolean; legacy: boolean;
  onManage(position: ManualPerplPosition): void; onAction(position: ManualPerplPosition, action: 'close_position' | 'reduce_size'): void;
}) {
  return <UserCard theme={theme}><UserText theme={theme} kind="title">{legacy ? 'Legacy positions' : 'Open positions'}</UserText>
    {positions.length ? positions.map((position, index) => {
      const market = markets.find(item => item.marketId === String(position.marketId));
      const sizeScale = precision(position.sizeDecimals) ?? precision(market?.sizeDecimals);
      const priceScale = precision(position.priceDecimals) ?? precision(market?.priceDecimals);
      return <View key={`${position.marketId}:${index}`} style={styles.item}>
      <UserValueRow theme={theme} label={`${position.symbol} · ${humanize(position.side)}`} value={scaled(position.sizeUnits, sizeScale, 'Size unavailable')}
        detail={`Entry ${scaled(position.entryPrice, priceScale, 'price unavailable')} · PnL ${amountUnits(position.unrealizedPnlUnits, 6)}`} />
      {!legacy ? canClose || canReduce ? <UserButton label={`Manage ${position.symbol}`} onPress={() => onManage(position)} theme={theme} secondary /> : null : <>
        {canClose ? <UserButton label={`Review ${position.symbol} close`} onPress={() => onAction(position, 'close_position')} theme={theme} /> : null}
        {canReduce ? <UserButton label={`Review ${position.symbol} reduction`} onPress={() => onAction(position, 'reduce_size')} theme={theme} secondary /> : null}
      </>}
    </View>;}) : <UserText theme={theme}>{legacy ? 'No legacy positions.' : 'No open positions.'}</UserText>}
  </UserCard>;
}

function OrderCards({orders, markets, theme, canCancel, canAmend, onAction, legacy}: {
  orders: ManualPerplOrder[]; markets: UserMarketPrecision[]; theme: UserThemeTokens; canCancel: boolean; canAmend: boolean; legacy: boolean;
  onAction(order: ManualPerplOrder, market: UserMarketPrecision | undefined, action: 'cancel_limit' | 'amend_limit'): void;
}) {
  return <UserCard theme={theme}><UserText theme={theme} kind="title">{legacy ? 'Legacy open orders' : 'Open orders'}</UserText>
    {orders.length ? orders.map(order => {
      const market = markets.find(item => item.marketId === String(order.marketId));
      const priceDecimals = precision(market?.priceDecimals); const sizeDecimals = precision(market?.sizeDecimals);
      const pnsPrice = typeof order.pricePNS === 'string' ? order.pricePNS : null;
      return <View key={String(order.orderId)} style={styles.item}>
        <UserValueRow theme={theme} label={`${order.symbol ?? 'Perpl'} · ${humanize(order.side)}`}
          value={`${scaled(order.sizeUnits, sizeDecimals, 'Size unavailable')} / ${order.price == null ? 'Market' : scaled(pnsPrice ?? undefined, priceDecimals, 'Price unavailable')}`}
          detail={`Order ${shortId(String(order.orderId))}`} />
        {!legacy && canAmend && market ? <UserButton label="Change limit price" onPress={() => onAction(order, market, 'amend_limit')} theme={theme} secondary /> : null}
        {canCancel ? <UserButton label="Cancel open order" onPress={() => onAction(order, market, 'cancel_limit')} theme={theme} secondary /> : null}
      </View>;
    }) : <UserText theme={theme}>{legacy ? 'No legacy orders remain.' : 'No open orders.'}</UserText>}
  </UserCard>;
}

function LegacyCard({account, markets, amount, setAmount, theme, busy, minimumWithdrawalUnits, onPrepare, onPositionAction, onOrderAction}: {
  account: ManualPerplLegacyRecovery; markets: UserMarketPrecision[]; amount: string; setAmount(value: string): void; theme: UserThemeTokens; busy: boolean;
  minimumWithdrawalUnits: string | null;
  onPrepare(action: ManualAccountAction): void; onPositionAction(position: ManualPerplPosition, action: 'close_position' | 'reduce_size'): void;
  onOrderAction(order: ManualPerplOrder, action: 'cancel_limit' | 'amend_limit'): void;
}) {
  if (account.status === 'none') return null;
  const free = freeUnits(account.collateral.balanceUnits, account.collateral.lockedUnits);
  return <UserCard theme={theme}><UserText theme={theme} kind="title">Legacy account · recovery only</UserText>
    <UserText theme={theme}>This older account stays separate from your Mera-owned account.</UserText>
    <UserValueRow theme={theme} label="Status" value={humanize(account.status)} />
    {account.status === 'unavailable' ? <UserText theme={theme}>{account.error ?? 'Refresh before attempting recovery.'}</UserText> : <>
      <UserValueRow theme={theme} label="Account AUSD" value={amountUnits(account.collateral.balanceUnits, 6)} />
      <UserValueRow theme={theme} label="Free AUSD" value={amountUnits(free, 6)} />
      <UserValueRow theme={theme} label="AUSD in recovery contract" value={amountUnits(account.collateral.tokenBalanceUnits, 6)} />
      <AmountEntry accessibilityLabel="Legacy recovery amount" amount={amount} setAmount={setAmount} theme={theme} groups={[
        {label: 'Free legacy balance', maximum: free, minimum: minimumWithdrawalUnits}, {label: 'Legacy recovery contract', maximum: account.collateral.tokenBalanceUnits},
      ]} />
      <UserButton label="Review legacy AUSD withdrawal with Mera" onPress={() => onPrepare('legacy_withdraw')} theme={theme} secondary loading={busy}
        disabled={!account.capabilities.withdraw || !minimumWithdrawalUnits || !positiveAmount(amount)
          || safeBigInt(positiveAmount(amount) ?? '0') < safeBigInt(minimumWithdrawalUnits)
          || safeBigInt(positiveAmount(amount) ?? '0') > safeBigInt(free)} />
      <UserButton label="Review legacy AUSD return with Mera" onPress={() => onPrepare('legacy_rescue')} theme={theme} loading={busy}
        disabled={!account.capabilities.rescueTokens || !positiveAmount(amount) || safeBigInt(positiveAmount(amount) ?? '0') > safeBigInt(account.collateral.tokenBalanceUnits)} />
      <PositionCards positions={account.positions} markets={markets} theme={theme} canClose={account.capabilities.closePosition} canReduce={account.capabilities.reducePosition}
        onManage={() => undefined} onAction={onPositionAction} legacy />
      <OrderCards orders={account.orders} markets={[]} theme={theme} canCancel={account.capabilities.cancelOrders} canAmend={false}
        onAction={order => onOrderAction(order, 'cancel_limit')} legacy />
    </>}
  </UserCard>;
}

function AmountEntry({accessibilityLabel, amount, setAmount, theme, groups}: {accessibilityLabel: string; amount: string; setAmount(value: string): void;
  theme: UserThemeTokens; groups: {label: string; maximum: string; minimum?: string | null}[]}) {
  const [customOpen, setCustomOpen] = useState(false);
  return <View style={styles.amountEntry}>
    <UserValueRow theme={theme} label="Selected amount" value={amount ? `${amount} AUSD` : 'Choose an amount'} />
    {groups.map(group => <View key={group.label} style={styles.presetGroup}>
      <UserText theme={theme} kind="meta">{group.label}</UserText>
      <View style={styles.presets}>{amountPresets(group.maximum, group.minimum).map(option => <Pressable key={`${group.label}:${option.units}`}
        accessibilityRole="button" accessibilityLabel={`${group.label} ${option.label}`} onPress={() => setAmount(formatMonadUnits(option.units, 6))}
        style={({pressed}) => [styles.preset, {borderColor: theme.border, backgroundColor: theme.raised}, pressed && styles.pressed]}>
        <Text style={[styles.presetText, {color: theme.ink}]}>{option.label}</Text>
        <Text style={[styles.presetAmount, {color: theme.muted}]}>{formatMonadUnits(option.units, 6)} AUSD</Text>
      </Pressable>)}</View>
    </View>)}
    <UserDisclosure theme={theme} label="Custom amount" value="Enter AUSD" expanded={customOpen} onPress={() => setCustomOpen(value => !value)}>
      {customOpen ? <TextInput accessibilityLabel={accessibilityLabel} keyboardType="decimal-pad" value={amount} onChangeText={setAmount}
        placeholder="Enter AUSD" placeholderTextColor={theme.muted} style={[styles.input, {color: theme.ink, borderColor: theme.border, backgroundColor: theme.raised}]} /> : null}
    </UserDisclosure>
  </View>;
}

function DirectionChoice({selected, onChange, theme}: {selected: 'deposit' | 'withdraw'; onChange(value: 'deposit' | 'withdraw'): void; theme: UserThemeTokens}) {
  return <View accessibilityRole="radiogroup" accessibilityLabel="AUSD direction" style={styles.presets}>
    {(['deposit', 'withdraw'] as const).map(direction => <Pressable key={direction} accessibilityRole="radio"
      accessibilityLabel={direction === 'deposit' ? 'Deposit AUSD' : 'Withdraw AUSD'} accessibilityState={{selected: selected === direction}}
      onPress={() => onChange(direction)} style={[styles.preset, {borderColor: selected === direction ? theme.accent : theme.border,
        backgroundColor: selected === direction ? theme.accentSoft : theme.raised}]}>
      <Text style={[styles.presetText, {color: theme.ink}]}>{direction === 'deposit' ? 'Deposit' : 'Withdraw'}</Text>
    </Pressable>)}
  </View>;
}

function amountPresets(maximum: string, minimum?: string | null) {
  const max = safeBigInt(maximum); const min = minimum ? safeBigInt(minimum) : 0n;
  if (max <= 0n) return [];
  const candidates = [{label: 'Half', units: max / 2n}, {label: 'Max', units: max}];
  if (min > 0n && min <= max) candidates.unshift({label: 'Minimum', units: min});
  const seen = new Set<string>();
  return candidates.filter(option => {
    if (option.units <= 0n || option.units > max || (min > 0n && option.units < min) || seen.has(option.units.toString())) return false;
    seen.add(option.units.toString()); return true;
  }).map(option => ({...option, units: option.units.toString()}));
}
function amountUnits(value: string, decimals: number) { try { return `${formatMonadUnits(value, decimals)} AUSD`; } catch { return 'Unavailable'; } }
function freeUnits(balance: string, locked: string) { const value = safeBigInt(balance) - safeBigInt(locked); return (value > 0n ? value : 0n).toString(); }
function safeBigInt(value: string) { try { return /^\d+$/.test(value) ? BigInt(value) : 0n; } catch { return 0n; } }
function positiveAmount(value: string) { try { const parsed = formatInputUnits(value, 6); return safeBigInt(parsed) > 0n ? parsed : null; } catch { return null; } }
function formatInputUnits(value: string, decimals: number) { const [whole, fraction = ''] = value.trim().split('.'); if (!whole || fraction.length > decimals || !/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) throw new Error('Invalid'); return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals))).toString(); }
function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function shortId(value: string) { return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value; }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function precision(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 30 ? value : null; }
function scaled(value: string | null | undefined, decimals: number | null, missing: string) { return !value || decimals === null ? missing : formatMonadUnits(value, decimals); }

const styles = StyleSheet.create({
  input: {minHeight: 52, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 10, fontFamily: userFonts.body, fontSize: 16, lineHeight: 22, fontWeight: '700'},
  item: {gap: 8, paddingVertical: 5}, amountEntry: {gap: 10}, presetGroup: {gap: 6}, presets: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  preset: {minHeight: 48, flexGrow: 1, minWidth: 95, borderWidth: 2, paddingHorizontal: 9, paddingVertical: 6, justifyContent: 'center'},
  presetText: {fontFamily: userFonts.body, fontWeight: '800', fontSize: 13, lineHeight: 18, textAlign: 'center'},
  presetAmount: {fontFamily: userFonts.mono, fontWeight: '700', fontSize: 11, lineHeight: 16, textAlign: 'center'},
  pressed: {transform: [{translateX: 2}, {translateY: 2}]},
});
