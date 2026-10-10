import React, {useCallback, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, Field, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {manualPerplApi, createManualPerplIdempotencyKey} from '../services/manualPerplApi';
import {marketDirectoryApi} from '../services/marketDirectoryApi';
import {monadApi} from '../services/monadApi';
import {formatMonadUnits, formatMonadTimestamp, parseMonadAmount, shortenAddress} from '../services/monadFormatting';
import {validateManualPerplPreparation} from '../services/manualPerplValidation';
import type {ManualPerplAccount} from '../types/manualPerpl';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';

export function PerplManualAccountScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [account, setAccount] = useState<ManualPerplAccount | null>(null);
  const [markets, setMarkets] = useState<Array<{marketId: string; symbol: string; priceDecimals?: number; sizeDecimals?: number; maxLeverage?: number}>>([]);
  const [walletAusd, setWalletAusd] = useState('Unavailable');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    const [accountResult, walletResult, marketResult] = await Promise.allSettled([manualPerplApi.account(), monadApi.wallet(), marketDirectoryApi.list()]);
    if (marketResult.status === 'fulfilled') setMarkets(marketResult.value.markets.filter(item => item.kind === 'perpl'));
    if (accountResult.status === 'fulfilled') {
      const next = accountResult.value;
      if (!ownerAddress || next.chainId !== 10143 || next.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
        setError('The manual Perpl account does not match this Mera session on Monad Testnet.');
        setAccount(null);
      } else setAccount(next);
    } else { setError(accountResult.reason instanceof Error ? accountResult.reason.message : 'Manual Perpl account is unavailable.'); }
    if (walletResult.status === 'fulfilled' && ownerAddress && walletResult.value.ownerAddress.toLowerCase() === ownerAddress.toLowerCase()
        && walletResult.value.chainId === 10143) {
      const balance = walletResult.value.balances.find(item => item.asset === 'AUSD');
      setWalletAusd(balance ? `${formatMonadUnits(balance.amountUnits, balance.decimals)} AUSD` : 'Not returned');
    }
    setLoading(false);
  }, [ownerAddress]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function prepare(action: 'create' | 'fund' | 'open' | 'deposit' | 'withdraw') {
    if (!account || !ownerAddress) return;
    const allowed = action === 'create' ? account.capabilities.createAccount
      : action === 'fund' ? account.capabilities.fundAccount
      : action === 'open' ? account.capabilities.openAccount
        : action === 'withdraw' ? account.capabilities.withdraw : account.capabilities.deposit;
    if (!allowed) { setError('This action is disabled by the default-off manual Perpl Testnet gate.'); return; }
    setBusy(true); setError('');
    try {
      const amountUnits = ['fund', 'open', 'deposit', 'withdraw'].includes(action) ? parseMonadAmount(amount, account.collateral.decimals) : undefined;
      const prepared = await manualPerplApi.prepareAccount({action, ...(amountUnits ? {amountUnits} : {}), idempotencyKey: createManualPerplIdempotencyKey()});
      const expected = {action, ownerAddress, venueId: 'perpl-direct-testnet-v1',
        ...(account.accountAddress ? {accountAddress: account.accountAddress} : {}), ...(amountUnits ? {amountUnits} : {})};
      validateManualPerplPreparation(prepared, expected);
      navigation.navigate('ManualPerplReview', {prepared, expected, label: accountActionLabel(action), returnRoute: 'PerplManualAccount'});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'A fresh account review could not be prepared.'); }
    finally { setBusy(false); }
  }

  const manualGateOff = account && Object.values(account.capabilities).every(enabled => !enabled);
  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker="Manual Perpl · Mera owner" title="Your separate AUSD account" copy="This account belongs to your Mera wallet. Its balance and positions stay separate from autonomous Perpl runs and have no trading operator." />
    {error ? <Notice live tone="rose" title="Manual account needs attention" message={error} actionLabel="Refresh" onAction={() => { void refresh(); }} /> : null}
    {manualGateOff ? <Notice tone="orange" title="Manual Perpl gate is off" message="Account mutations and order preparation remain disabled until the Testnet manual-trading gate is explicitly enabled." /> : null}
    {account ? <>
      <Card>
        <StatusBadge label={humanize(account.status)} tone={account.status === 'open' ? 'mint' : 'orange'} />
        <DataRow label="Network" value={`Monad Testnet · ${account.chainId}`} />
        <DataRow label="Mera owner" value={shortenAddress(account.ownerAddress)} />
        <DataRow label="Manual Perpl account" value={account.accountAddress ?? 'Not created'} />
        <DataRow label="Account ID" value={account.accountId === null ? 'Not open on Perpl' : String(account.accountId)} />
        <DataRow label="AUSD available" value={`${formatMonadUnits(account.collateral.balanceUnits, account.collateral.decimals)} AUSD`} />
        <DataRow label="AUSD locked" value={`${formatMonadUnits(account.collateral.lockedUnits, account.collateral.decimals)} AUSD`} />
        <DataRow label="Mera wallet AUSD" value={walletAusd} />
        <DataRow label="Snapshot" value={formatMonadTimestamp(account.observedAt)} />
      </Card>
      <Card><Text style={s.strong}>Account setup and collateral</Text>
        {account.status === 'not_created' ? <Button label="Review manual account creation" onPress={() => { void prepare('create'); }} disabled={!account.capabilities.createAccount} loading={busy} /> : null}
        {account.status === 'created' ? <>
          <Field label="AUSD amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Enter an amount" />
          <Button label="Review AUSD funding" onPress={() => { void prepare('fund'); }} disabled={!account.capabilities.fundAccount} loading={busy} />
          <Button label="Review Perpl account opening" variant="secondary" onPress={() => { void prepare('open'); }} disabled={!account.capabilities.openAccount} loading={busy} />
        </> : null}
        {account.status === 'open' ? <>
          <Field label="AUSD amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Enter an amount" />
          <Button label="Review AUSD funding" variant="secondary" onPress={() => { void prepare('fund'); }} disabled={!account.capabilities.fundAccount} loading={busy} />
          <Button label="Review AUSD deposit" onPress={() => { void prepare('deposit'); }} disabled={!account.capabilities.deposit} loading={busy} />
          <Button label="Review AUSD withdrawal" variant="secondary" onPress={() => { void prepare('withdraw'); }} disabled={!account.capabilities.withdraw} loading={busy} />
        </> : null}
      </Card>
      <Card><Text style={s.strong}>Manual positions</Text>
        {account.positions.length ? account.positions.map((position, index) => <Card key={`${position.marketId}:${index}`} tint="#F1EDFF">
          <DataRow label="Market" value={`${position.symbol} · ${position.marketId}`} />
          <DataRow label="Direction" value={humanize(position.side)} />
          <DataRow label="Size" value={formatMonadUnits(position.sizeUnits, Number(position.sizeDecimals ?? 0))} />
          <DataRow label="Entry / mark" value={`${formatMonadUnits(position.entryPrice, Number(position.priceDecimals ?? 0))} / ${formatMonadUnits(position.markPrice, Number(position.priceDecimals ?? 0))}`} />
          <DataRow label="Leverage" value={`${position.leverage}×`} />
          <DataRow label="Unrealized PnL" value={`${formatMonadUnits(position.unrealizedPnlUnits, 6)} AUSD`} />
          {account.capabilities.marketOrders ? <Button label="Review AUSD margin addition" variant="secondary" onPress={() => navigation.navigate('PerplTrade', {
            marketId: String(position.marketId), symbol: position.symbol, priceDecimals: Number(position.priceDecimals ?? 0),
            sizeDecimals: Number(position.sizeDecimals ?? 0), action: 'add_margin',
          })} /> : null}
          <Button label={`Manage ${position.symbol}`} variant="secondary" onPress={() => navigation.navigate('MarketDetail', {venueId: 'perpl-direct-testnet-v1', marketId: String(position.marketId)})} />
        </Card>) : <Text style={s.body}>No manual positions are open.</Text>}
      </Card>
      <Card><Text style={s.strong}>Open manual orders</Text>
        {account.orders.length ? account.orders.map(order => {
          const market = markets.find(item => item.marketId === String(order.marketId));
          const orderSize = market?.sizeDecimals === undefined ? `${order.sizeUnits} raw units` : formatMonadUnits(order.sizeUnits, market.sizeDecimals);
          const orderPrice = order.price == null ? 'Market' : market?.priceDecimals === undefined ? `${order.price} raw units` : formatMonadUnits(order.price, market.priceDecimals);
          return <Card key={String(order.orderId)} tint="#EEF7FF">
          <DataRow label="Market" value={`${order.symbol ?? 'Perpl'} · ${order.marketId}`} />
          <DataRow label="Order" value={String(order.orderId)} /><DataRow label="Side" value={humanize(order.side)} />
          <DataRow label="Size / price" value={`${orderSize} / ${orderPrice}`} /><DataRow label="Status" value={humanize(order.status)} />
          {account.capabilities.limitOrders && market ? <Button label="Review limit price amendment" variant="secondary" onPress={() => navigation.navigate('PerplTrade', {
            marketId: String(order.marketId), symbol: order.symbol ?? market.symbol ?? 'Perpl market', action: 'amend_limit',
            orderId: String(order.orderId), side: order.side, priceDecimals: market.priceDecimals ?? 0, sizeDecimals: market.sizeDecimals ?? 0,
          })} /> : null}
          {account.capabilities.cancelOrders ? <Button label="Review cancellation" variant="secondary" onPress={() => navigation.navigate('PerplTrade', {
            marketId: String(order.marketId), symbol: order.symbol ?? 'Perpl market', action: 'cancel_limit', orderId: String(order.orderId),
            side: order.side, priceDecimals: market?.priceDecimals ?? 0, sizeDecimals: market?.sizeDecimals ?? 0,
          })} /> : null}
          </Card>;
        }) : <Text style={s.body}>No open manual orders were returned.</Text>}
      </Card>
    </> : null}
  </Screen>;
}

function accountActionLabel(action: string) { return `${humanize(action)} manual Perpl account`; }
function humanize(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
