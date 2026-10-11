import React, {useCallback, useEffect, useState} from 'react';
import {Text} from 'react-native';
import {useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, Field, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {ManualPerplEntrySizer} from '../components/ManualPerplEntrySizer';
import {manualPerplApi, createManualPerplIdempotencyKey} from '../services/manualPerplApi';
import type {ManualPerplAccount} from '../types/manualPerpl';
import {formatMonadUnits, parseMonadAmount, shortenAddress} from '../services/monadFormatting';
import {validateManualPerplPreparation, type ManualReviewExpectation} from '../services/manualPerplValidation';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';
import {useManualPerplAccountQuery, useMarketSnapshotQuery} from '../services/useMarketQueries';
import {getManualPerplEntrySizing, timestampIsFresh} from '../services/manualPerplSizing';

type OrderType = 'market' | 'limit';
type ManualOrderKind = 'market_entry' | 'limit_entry' | 'close_position' | 'reduce_size' | 'cancel_limit' | 'add_margin' | 'amend_limit';

export function PerplTradeScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const focused = useIsFocused();
  const accountQuery = useManualPerplAccountQuery(ownerAddress, focused);
  const marketId = String(route.params?.marketId ?? '');
  const snapshotQuery = useMarketSnapshotQuery(ownerAddress, 'perpl-direct-testnet-v1', marketId, focused);
  const {refetch: refetchAccount} = accountQuery;
  const {refetch: refetchSnapshot} = snapshotQuery;
  const symbol = String(route.params?.symbol ?? `Market ${marketId}`);
  const accountMode = route.params?.accountMode === 'legacy_delegated' ? 'legacy_delegated' : 'direct_wallet';
  const legacyMode = accountMode === 'legacy_delegated';
  const action = route.params?.action as ManualOrderKind | undefined;
  const sideFromRoute = route.params?.side === 'short' ? 'short' : 'long';
  const priceDecimals = Number(snapshotQuery.data?.market.priceDecimals ?? route.params?.priceDecimals ?? 0);
  const sizeDecimals = Number(snapshotQuery.data?.market.sizeDecimals ?? route.params?.sizeDecimals ?? 0);
  const orderId = route.params?.orderId ? String(route.params.orderId) : undefined;
  const isManagement = Boolean(action);
  const candidate = accountQuery.data;
  const directModeMatches = candidate?.accountMode === 'not_created' ? candidate.accountAddress === null
    : candidate?.accountMode === 'direct_wallet' ? candidate.accountAddress?.toLowerCase() === ownerAddress?.toLowerCase()
      : candidate?.accountMode === 'unavailable' && candidate.accountAddress === null;
  const account = candidate && ownerAddress && candidate.ownerAddress.toLowerCase() === ownerAddress.toLowerCase()
    && candidate.chainId === 10143 && directModeMatches && ADDRESS.test(candidate.exchangeAddress)
    ? candidate as ManualPerplAccount : null;
  const legacyAccount = account?.legacyRecovery ?? null;
  const accountAddress = legacyMode ? legacyAccount?.accountAddress ?? null : account?.accountAddress ?? null;
  const accountStatus = legacyMode ? legacyAccount?.status : account?.status;
  const positions = legacyMode ? legacyAccount?.positions ?? [] : account?.positions ?? [];
  const orders = legacyMode ? legacyAccount?.orders ?? [] : account?.orders ?? [];
  const position = positions.find(item => String(item.marketId) === marketId) ?? null;
  const [orderType, setOrderType] = useState<OrderType>('market');
  const [side, setSide] = useState<'long' | 'short'>(sideFromRoute);
  const [notionalAUsd, setNotionalAUsd] = useState(0);
  const [size, setSize] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [marginAmount, setMarginAmount] = useState('');
  const [leverage, setLeverage] = useState(1);
  const [error, setError] = useState('');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setError(''); await Promise.allSettled([refetchAccount(), refetchSnapshot()]);
  }, [refetchAccount, refetchSnapshot]);
  const pullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);
  const accountReadError = accountQuery.data && !account
    ? 'Manual Perpl account does not match this Mera session.'
    : account?.status === 'unavailable' ? 'Perpl could not verify the account at a finalized block. Refresh before taking any action.'
      : accountQuery.error instanceof Error ? accountQuery.error.message : '';

  const entryCapability = Boolean(account && !legacyMode && account.status === 'open'
    && (orderType === 'market' ? account.capabilities.marketOrders : account.capabilities.limitOrders));
  const accountFresh = Boolean(account && !accountQuery.isError && account.status === 'open'
    && timestampIsFresh(account.observedAt));
  const liveMarket = snapshotQuery.data?.market ?? null;
  const entrySizing = getManualPerplEntrySizing({market: liveMarket, book: snapshotQuery.data?.book,
    snapshotObservedAt: snapshotQuery.data?.observedAt, snapshotError: snapshotQuery.isError, accountFresh,
    balanceUnits: account?.collateral.balanceUnits, lockedUnits: account?.collateral.lockedUnits,
    side, orderType, notionalAUsd, leverage, limitPrice, capabilityEnabled: entryCapability,
    positionOpen: Boolean(position && BigInt(position.sizeUnits) > 0n)});
  useEffect(() => {
    if (notionalAUsd <= 0 && entrySizing.maxNotionalAUsd > entrySizing.minNotionalAUsd) {
      const minimum = entrySizing.minNotionalAUsd;
      setNotionalAUsd(Math.max(minimum, Math.min(entrySizing.maxNotionalAUsd, Math.max(minimum, entrySizing.maxNotionalAUsd * 0.2))));
    }
  }, [entrySizing.maxNotionalAUsd, entrySizing.minNotionalAUsd, notionalAUsd]);

  const selectedKind = action ?? (orderType === 'market' ? 'market_entry' : 'limit_entry');
  const selectedOrder = orders.find(item => String(item.orderId) === orderId && String(item.marketId) === marketId);
  const allowed = account ? legacyMode ? selectedKind === 'close_position' ? Boolean(legacyAccount?.capabilities.closePosition)
      : selectedKind === 'reduce_size' ? Boolean(legacyAccount?.capabilities.reducePosition)
        : selectedKind === 'cancel_limit' ? Boolean(legacyAccount?.capabilities.cancelOrders) : false
    : selectedKind === 'market_entry' ? account.capabilities.marketOrders
      : selectedKind === 'limit_entry' ? account.capabilities.limitOrders
        : selectedKind === 'close_position' ? account.capabilities.closePosition
          : selectedKind === 'reduce_size' ? account.capabilities.reducePosition
            : selectedKind === 'cancel_limit' ? account.capabilities.cancelOrders
              : selectedKind === 'amend_limit' ? account.capabilities.limitOrders
                : selectedKind === 'add_margin' ? account.capabilities.deposit || account.capabilities.marketOrders : false : false;

  async function prepareOrder() {
    if (!account || !ownerAddress) return;
    if (accountStatus !== 'open') { setError('Open the Mera-owned Perpl account before preparing a manual order.'); return; }
    if (!allowed) { setError('This order action is disabled by the default-off manual Perpl Testnet gate.'); return; }
    setBusy(true); setError('');
    try {
      if (!marketId) throw new Error('The selected market ID is missing.');
      const entry = selectedKind === 'market_entry' || selectedKind === 'limit_entry';
      if (legacyMode && entry) throw new Error('Legacy delegated accounts allow recovery actions only.');
      if (legacyMode && !['close_position', 'reduce_size', 'cancel_limit'].includes(selectedKind)) throw new Error('This action is not available for legacy account recovery.');
      if (entry && !entrySizing.canReview) throw new Error(entrySizing.reason ?? 'The latest market and account data cannot support this order.');
      const positionSide = ['close_position', 'reduce_size'].includes(selectedKind) ? manualSide(position?.side) : undefined;
      const orderSide = selectedKind === 'amend_limit' ? manualSide(selectedOrder?.side) : undefined;
      if (['close_position', 'reduce_size'].includes(selectedKind) && (!position || !positionSide)) throw new Error('No verified manual position and direction exists for this market.');
      if (selectedKind === 'amend_limit' && (!selectedOrder || !orderSide)) throw new Error('The selected open limit order is no longer in this Mera account. Refresh and choose it again.');
      if (selectedKind === 'cancel_limit' && !selectedOrder) throw new Error('The selected open order is no longer in this Mera account. Refresh and choose it again.');
      const sizeUnits = entry ? entrySizing.sizeUnits
        : selectedKind === 'reduce_size' ? parseMonadAmount(size, sizeDecimals) : undefined;
      const marginUnits = selectedKind === 'add_margin' ? parseMonadAmount(marginAmount, account.collateral.decimals) : undefined;
      const limitPriceValue = ['limit_entry', 'amend_limit'].includes(selectedKind)
        ? formatMonadUnits(parseMonadAmount(entry ? entrySizing.limitPrice : limitPrice, priceDecimals), priceDecimals) : undefined;
      const parsedLeverage = entry ? leverage : 1;
      if (entry && (!Number.isSafeInteger(parsedLeverage) || parsedLeverage < 1 || parsedLeverage > entrySizing.maxLeverage)) {
        throw new Error(`Choose whole-number leverage from 1× to ${entrySizing.maxLeverage}×.`);
      }
      if (selectedKind === 'cancel_limit' && !orderId) throw new Error('The open order ID is missing. Return to the account and select the order again.');
      const prepared = await manualPerplApi.prepareOrder({kind: selectedKind, marketId,
        accountMode,
        ...(entry ? {side, sizeUnits, leverage: parsedLeverage} : {}),
        ...(positionSide ? {side: positionSide} : {}), ...(orderSide ? {side: orderSide} : {}),
        ...(limitPriceValue ? {limitPrice: limitPriceValue} : {}), ...(orderId ? {orderId} : {}),
        ...(selectedKind === 'reduce_size' ? {sizeUnits} : {}), ...(marginUnits ? {collateralAmountUnits: marginUnits} : {}),
        idempotencyKey: createManualPerplIdempotencyKey()});
      const expected: ManualReviewExpectation = {action: selectedKind, ownerAddress, venueId: 'perpl-direct-testnet-v1', accountMode,
        accountAddress, transactionTarget: legacyMode ? accountAddress ?? undefined : account.exchangeAddress, marketId,
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
  return <Screen refreshing={pullRefreshing || accountQuery.isLoading || snapshotQuery.isLoading} onRefresh={() => { void pullToRefresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker={legacyMode ? 'Legacy recovery · Mera signs each action' : 'Manual Perpl · Mera signs each action'} title={pageTitle} copy={legacyMode
      ? 'Only close, reduce, and cancel actions are available for this older delegated account. A fresh exact review is required.'
      : 'Market and limit orders stay on your direct Mera-owned Perpl account. A fresh exact review is required for every action.'} />
    {error ? <Notice live tone="rose" title="Order review unavailable" message={error} actionLabel="Refresh account" onAction={() => { void pullToRefresh(); }} /> : null}
    {accountReadError ? <Notice live tone="orange" title={account ? 'Showing last good manual account' : 'Manual Perpl account unavailable'} message={accountReadError} actionLabel="Refresh account" onAction={() => { void pullToRefresh(); }} /> : null}
    {!isManagement && snapshotQuery.isError && !liveMarket ? <Notice live tone="orange" title="Live Perpl market data unavailable"
      message="A fresh ticker and current market limits are required before you can size an entry." actionLabel="Refresh market" onAction={() => { void pullToRefresh(); }} /> : null}
    {account ? <Card>
      <StatusBadge label={humanize(accountStatus ?? 'unavailable')} tone={accountStatus === 'open' ? 'mint' : 'orange'} />
      <DataRow label="Mera owner" value={shortenAddress(account.ownerAddress)} />
      <DataRow label={legacyMode ? 'Legacy delegated account' : 'Exchange account owner'} value={accountAddress ?? 'Not created'} />
      <DataRow label="Free AUSD" value={accountStatus === 'unavailable' ? 'Unavailable' : `${formatMonadUnits(freeCollateral(legacyMode ? legacyAccount?.collateral.balanceUnits ?? '0' : account.collateral.balanceUnits,
        legacyMode ? legacyAccount?.collateral.lockedUnits ?? '0' : account.collateral.lockedUnits), 6)} AUSD`} />
      <DataRow label="Locked AUSD" value={accountStatus === 'unavailable' ? 'Unavailable' : `${formatMonadUnits(legacyMode ? legacyAccount?.collateral.lockedUnits ?? '0' : account.collateral.lockedUnits, 6)} AUSD`} />
      {position ? <>
        <DataRow label="Current position" value={`${position.side} ${position.symbol}`} />
        <DataRow label="Current size" value={scaled(position.sizeUnits, sizeDecimals, position.symbol)} />
        <DataRow label="Entry / mark" value={`${scaled(position.entryPrice, priceDecimals)} / ${scaled(position.markPrice, priceDecimals)}`} />
      </> : null}
    </Card> : null}
    {!legacyMode && !isManagement ? liveMarket ? <ManualPerplEntrySizer market={liveMarket} side={side} onSideChange={value => { setSide(value); setLimitPrice(''); }}
      orderType={orderType} onOrderTypeChange={setOrderType} notionalAUsd={notionalAUsd} onNotionalChange={setNotionalAUsd}
      leverage={leverage} onLeverageChange={setLeverage} limitPrice={limitPrice} onLimitPriceChange={setLimitPrice}
      sizing={entrySizing} quoteObservedAt={liveMarket.quote?.observedAt ?? snapshotQuery.data?.observedAt}
      bookObservedAt={snapshotQuery.data?.book?.observedAt ?? snapshotQuery.data?.observedAt} />
      : <Card><Text style={s.strong}>Loading live Perpl market data</Text><Text style={s.body}>The entry size stays unavailable until this market returns a fresh quote and its current risk limits.</Text></Card>
      : selectedKind === 'reduce_size' ? <Card><Field label="Size to reduce" value={size} onChangeText={setSize} keyboardType="decimal-pad" placeholder="Enter reduction size" /></Card>
      : selectedKind === 'add_margin' ? <Card><Field label="AUSD margin to add" value={marginAmount} onChangeText={setMarginAmount} keyboardType="decimal-pad" placeholder="Enter AUSD amount" /><Text style={s.meta}>The margin is taken from free AUSD in this separate manual Perpl account.</Text></Card>
        : selectedKind === 'amend_limit' ? <Card>
          {selectedOrder ? <><DataRow label="Open order" value={String(selectedOrder.orderId)} /><DataRow label="Current direction / size" value={`${selectedOrder.side} · ${scaled(selectedOrder.sizeUnits, sizeDecimals, symbol)}`} />
            <DataRow label="Current limit price" value={scaled(selectedOrder.price, priceDecimals)} /></> : <Text style={s.body}>This order is no longer open in the manual account.</Text>}
          <Field label="New limit price" value={limitPrice} onChangeText={setLimitPrice} keyboardType="decimal-pad" placeholder="Enter new price" />
          <Text style={s.meta}>Price precision · {priceDecimals} decimals. Amendments change price only; size and direction stay fixed.</Text>
        </Card> : null}
    {selectedKind === 'cancel_limit' ? <Card><DataRow label="Order ID" value={orderId ?? 'Unavailable'} /><DataRow label="Market" value={`${symbol} · ${marketId}`} /></Card> : null}
    {account && (legacyMode ? !legacyAccount?.capabilities.closePosition && !legacyAccount?.capabilities.reducePosition && !legacyAccount?.capabilities.cancelOrders
      : Object.values(account.capabilities).every(enabled => !enabled)) ? <Notice tone="orange" title={legacyMode ? 'Legacy recovery is unavailable' : 'Manual Perpl gate is off'}
      message={legacyMode ? 'No owner-signed close, reduce, or cancel action is currently available.' : 'Trading and account mutation remain disabled until the local manual gate is explicitly enabled.'} /> : null}
    {legacyMode && !action ? <Notice tone="orange" title="Choose a recovery action" message="Return to the legacy account card and select a position or order to manage." /> : null}
    {(selectedKind === 'market_entry' || selectedKind === 'limit_entry') && entrySizing.reason
      ? <Notice tone="orange" title="Order review waiting for fresh data" message={entrySizing.reason}
          actionLabel="Refresh market and account" onAction={() => { void pullToRefresh(); }} /> : null}
    <Button label={legacyMode ? 'Prepare exact legacy recovery review' : 'Prepare exact Mera review'} onPress={() => { void prepareOrder(); }} loading={busy}
      disabled={!account || !allowed || accountQuery.isLoading || (selectedKind === 'market_entry' || selectedKind === 'limit_entry') && !entrySizing.canReview} />
    {account ? <Button label="Manual Perpl account details" variant="secondary" onPress={() => navigation.navigate('PerplManualAccount')} /> : null}
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
function freeCollateral(balanceUnits: string, lockedUnits: string) {
  const free = BigInt(balanceUnits) - BigInt(lockedUnits);
  return (free > 0n ? free : 0n).toString();
}
const ADDRESS = /^0x[0-9a-f]{40}$/i;
