import React, {useCallback, useState} from 'react';
import {Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, Field, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {manualPerplApi, createManualPerplIdempotencyKey} from '../services/manualPerplApi';
import {formatMonadUnits, parseMonadAmount, shortenAddress} from '../services/monadFormatting';
import {validateManualPerplPreparation} from '../services/manualPerplValidation';
import type {ManualPerplAccount, ManualPerplPosition} from '../types/manualPerpl';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';

type OrderType = 'market' | 'limit';
type ManualOrderKind = 'market_entry' | 'limit_entry' | 'close_position' | 'reduce_size' | 'cancel_limit' | 'add_margin' | 'amend_limit';

export function PerplTradeScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const marketId = String(route.params?.marketId ?? '');
  const symbol = String(route.params?.symbol ?? `Market ${marketId}`);
  const action = route.params?.action as ManualOrderKind | undefined;
  const sideFromRoute = route.params?.side === 'short' ? 'short' : 'long';
  const priceDecimals = Number(route.params?.priceDecimals ?? 0);
  const sizeDecimals = Number(route.params?.sizeDecimals ?? 0);
  const maxLeverage = Number(route.params?.maxLeverage ?? 1);
  const orderId = route.params?.orderId ? String(route.params.orderId) : undefined;
  const isManagement = Boolean(action);
  const [account, setAccount] = useState<ManualPerplAccount | null>(null);
  const [position, setPosition] = useState<ManualPerplPosition | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [side, setSide] = useState<'long' | 'short'>(sideFromRoute);
  const [size, setSize] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [marginAmount, setMarginAmount] = useState('');
  const [leverage, setLeverage] = useState('1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const result = await manualPerplApi.account();
      if (!ownerAddress || result.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase() || result.chainId !== 10143) throw new Error('Manual Perpl account does not match this Mera session.');
      setAccount(result);
      setPosition(result.positions.find(item => String(item.marketId) === marketId) ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Manual Perpl account is unavailable.'); }
    finally { setLoading(false); }
  }, [ownerAddress, marketId]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const selectedKind = action ?? (orderType === 'market' ? 'market_entry' : 'limit_entry');
  const selectedOrder = account?.orders.find(item => String(item.orderId) === orderId && String(item.marketId) === marketId);
  const allowed = account ? selectedKind === 'market_entry' ? account.capabilities.marketOrders
    : selectedKind === 'limit_entry' ? account.capabilities.limitOrders
      : selectedKind === 'close_position' ? account.capabilities.closePosition
        : selectedKind === 'reduce_size' ? account.capabilities.reducePosition
          : selectedKind === 'cancel_limit' ? account.capabilities.cancelOrders
            : selectedKind === 'amend_limit' ? account.capabilities.limitOrders
              : selectedKind === 'add_margin' ? account.capabilities.deposit || account.capabilities.marketOrders : false : false;

  async function prepareOrder() {
    if (!account || !ownerAddress) return;
    if (account.status !== 'open') { setError('Open the separate Mera-owned Perpl account before preparing a manual order.'); return; }
    if (!allowed) { setError('This order action is disabled by the default-off manual Perpl Testnet gate.'); return; }
    setBusy(true); setError('');
    try {
      if (!marketId) throw new Error('The selected market ID is missing.');
      const entry = selectedKind === 'market_entry' || selectedKind === 'limit_entry';
      const positionSide = ['close_position', 'reduce_size'].includes(selectedKind) ? manualSide(position?.side) : undefined;
      const orderSide = selectedKind === 'amend_limit' ? manualSide(selectedOrder?.side) : undefined;
      if (['close_position', 'reduce_size'].includes(selectedKind) && (!position || !positionSide)) throw new Error('No verified manual position and direction exists for this market.');
      if (selectedKind === 'amend_limit' && (!selectedOrder || !orderSide)) throw new Error('The selected open limit order is no longer in this Mera account. Refresh and choose it again.');
      if (selectedKind === 'cancel_limit' && !selectedOrder) throw new Error('The selected open order is no longer in this Mera account. Refresh and choose it again.');
      const sizeUnits = ['market_entry', 'limit_entry', 'reduce_size'].includes(selectedKind) ? parseMonadAmount(size, sizeDecimals) : undefined;
      const marginUnits = selectedKind === 'add_margin' ? parseMonadAmount(marginAmount, account.collateral.decimals) : undefined;
      const limitPriceValue = ['limit_entry', 'amend_limit'].includes(selectedKind)
        ? formatMonadUnits(parseMonadAmount(limitPrice, priceDecimals), priceDecimals) : undefined;
      const parsedLeverage = Number(leverage.trim());
      if (entry && (!Number.isSafeInteger(parsedLeverage) || parsedLeverage < 1 || parsedLeverage > maxLeverage)) {
        throw new Error(`Choose whole-number leverage from 1× to ${maxLeverage}×.`);
      }
      if (selectedKind === 'cancel_limit' && !orderId) throw new Error('The open order ID is missing. Return to the account and select the order again.');
      const prepared = await manualPerplApi.prepareOrder({kind: selectedKind, marketId,
        ...(entry ? {side, sizeUnits, leverage: parsedLeverage} : {}),
        ...(positionSide ? {side: positionSide} : {}), ...(orderSide ? {side: orderSide} : {}),
        ...(limitPriceValue ? {limitPrice: limitPriceValue} : {}), ...(orderId ? {orderId} : {}),
        ...(selectedKind === 'reduce_size' ? {sizeUnits} : {}), ...(marginUnits ? {collateralAmountUnits: marginUnits} : {}),
        idempotencyKey: createManualPerplIdempotencyKey()});
      const expected = {action: selectedKind, ownerAddress, venueId: 'perpl-direct-testnet-v1',
        ...(account.accountAddress ? {accountAddress: account.accountAddress} : {}), marketId,
        ...(entry ? {side, sizeUnits, leverage: parsedLeverage} : {}),
        ...(positionSide ? {side: positionSide, sizeUnits: selectedKind === 'close_position' ? position?.sizeUnits : sizeUnits} : {}),
        ...(orderSide ? {side: orderSide, orderId, sizeUnits: selectedOrder?.sizeUnits} : {}),
        ...(selectedKind === 'cancel_limit' ? {orderId} : {}),
        ...(limitPriceValue ? {limitPrice: limitPriceValue} : {}), ...(marginUnits ? {collateralAmountUnits: marginUnits} : {})};
      validateManualPerplPreparation(prepared, expected);
      navigation.navigate('ManualPerplReview', {prepared, expected, label: orderLabel(selectedKind, side, symbol), returnRoute: 'PerplTrade'});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'A fresh order review could not be prepared.'); }
    finally { setBusy(false); }
  }

  const pageTitle = selectedKind === 'close_position' ? 'Close this position'
    : selectedKind === 'reduce_size' ? 'Reduce this position'
      : selectedKind === 'cancel_limit' ? 'Cancel this open order'
        : selectedKind === 'add_margin' ? `Add AUSD margin · ${symbol}`
          : selectedKind === 'amend_limit' ? `Amend ${symbol} limit`
            : `${side === 'long' ? 'Long' : 'Short'} ${symbol}`;
  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker="Manual Perpl · Mera signs each action" title={pageTitle} copy="Market and limit orders stay on your separate Mera-owned Perpl account. A fresh exact review is required for every action." />
    {error ? <Notice live tone="rose" title="Order review unavailable" message={error} actionLabel="Refresh account" onAction={() => { void refresh(); }} /> : null}
    {account ? <Card>
      <StatusBadge label={humanize(account.status)} tone={account.status === 'open' ? 'mint' : 'orange'} />
      <DataRow label="Mera owner" value={shortenAddress(account.ownerAddress)} />
      <DataRow label="Manual Perpl account" value={account.accountAddress ?? 'Not created'} />
      <DataRow label="Available AUSD" value={`${formatMonadUnits(account.collateral.balanceUnits, 6)} AUSD`} />
      <DataRow label="Locked AUSD" value={`${formatMonadUnits(account.collateral.lockedUnits, 6)} AUSD`} />
      {position ? <>
        <DataRow label="Current position" value={`${position.side} ${position.symbol}`} />
        <DataRow label="Current size" value={scaled(position.sizeUnits, sizeDecimals, position.symbol)} />
        <DataRow label="Entry / mark" value={`${scaled(position.entryPrice, priceDecimals)} / ${scaled(position.markPrice, priceDecimals)}`} />
      </> : null}
    </Card> : null}
    {!isManagement ? <Card>
      <View style={styles.switches}>{(['long', 'short'] as const).map(item => <Button key={item} label={item.toUpperCase()} variant={side === item ? 'primary' : 'secondary'} onPress={() => setSide(item)} />)}</View>
      <View style={styles.switches}>{(['market', 'limit'] as const).map(item => <Button key={item} label={`${item} order`} variant={orderType === item ? 'primary' : 'secondary'} onPress={() => setOrderType(item)} />)}</View>
      <Field label={`Position size · ${symbol}`} value={size} onChangeText={setSize} keyboardType="decimal-pad" placeholder="Enter size" />
      {orderType === 'limit' ? <Field label="Limit price" value={limitPrice} onChangeText={setLimitPrice} keyboardType="decimal-pad" placeholder="Enter limit price" /> : null}
      <Field label="Leverage" value={leverage} onChangeText={setLeverage} keyboardType="number-pad" placeholder="1" />
      <Text style={s.meta}>Market maximum · {maxLeverage}× · size precision {sizeDecimals} decimals</Text>
    </Card> : selectedKind === 'reduce_size' ? <Card><Field label="Size to reduce" value={size} onChangeText={setSize} keyboardType="decimal-pad" placeholder="Enter reduction size" /></Card>
      : selectedKind === 'add_margin' ? <Card><Field label="AUSD margin to add" value={marginAmount} onChangeText={setMarginAmount} keyboardType="decimal-pad" placeholder="Enter AUSD amount" /><Text style={s.meta}>The margin is taken from free AUSD in this separate manual Perpl account.</Text></Card>
        : selectedKind === 'amend_limit' ? <Card>
          {selectedOrder ? <><DataRow label="Open order" value={String(selectedOrder.orderId)} /><DataRow label="Current direction / size" value={`${selectedOrder.side} · ${scaled(selectedOrder.sizeUnits, sizeDecimals, symbol)}`} />
            <DataRow label="Current limit price" value={scaled(selectedOrder.price, priceDecimals)} /></> : <Text style={s.body}>This order is no longer open in the manual account.</Text>}
          <Field label="New limit price" value={limitPrice} onChangeText={setLimitPrice} keyboardType="decimal-pad" placeholder="Enter new price" />
          <Text style={s.meta}>Price precision · {priceDecimals} decimals. Amendments change price only; size and direction stay fixed.</Text>
        </Card> : null}
    {selectedKind === 'cancel_limit' ? <Card><DataRow label="Order ID" value={orderId ?? 'Unavailable'} /><DataRow label="Market" value={`${symbol} · ${marketId}`} /></Card> : null}
    {account && Object.values(account.capabilities).every(enabled => !enabled) ? <Notice tone="orange" title="Manual Perpl gate is off" message="Trading and account mutation remain disabled until the local manual gate is explicitly enabled." /> : null}
    <Button label="Prepare exact Mera review" onPress={() => { void prepareOrder(); }} loading={busy} disabled={!account || !allowed} />
    {!account?.capabilities.openAccount ? <Button label="Manual Perpl account details" variant="secondary" onPress={() => navigation.navigate('PerplManualAccount')} /> : null}
  </Screen>;
}

function orderLabel(kind: string, side: string, symbol: string) {
  if (kind === 'market_entry' || kind === 'limit_entry') return `${kind === 'market_entry' ? 'Market' : 'Limit'} ${side} ${symbol}`;
  return humanize(kind);
}
function humanize(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function manualSide(value: unknown): 'long' | 'short' | undefined {
  const side = String(value ?? '').toLowerCase();
  return side === 'long' || side === 'short' ? side : undefined;
}
function scaled(value: string | null | undefined, decimals: number, suffix = '') {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const formatted = formatMonadUnits(value, decimals);
  return suffix ? `${formatted} ${suffix}` : formatted;
}
const styles = {switches: {flexDirection: 'row' as const, gap: 10}};
