import React, {useCallback, useEffect, useState} from 'react';
import {Text} from 'react-native';
import {useIsFocused, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, Field, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {manualPerplApi, createManualPerplIdempotencyKey} from '../services/manualPerplApi';
import {perplApi} from '../services/perplApi';
import {formatMonadUnits, formatMonadTimestamp, parseMonadAmount, shortenAddress} from '../services/monadFormatting';
import {validateManualPerplPreparation, type ManualReviewExpectation} from '../services/manualPerplValidation';
import {manualPerplOpenDisabledReason} from '../services/manualPerplAccountSetup';
import {useManualPerplAccountAmounts} from '../services/useManualPerplAccountAmounts';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {screenStyles as s} from '../theme/screenStyles';
import {useManualPerplAccountQuery, useMarketDirectoryQuery} from '../services/useMarketQueries';
import type {ManualPerplAccount, ManualPerplLegacyRecovery} from '../types/manualPerpl';
import {UserPerplManualAccountView} from './user-perpl/UserPerplManualAccountView';

type AccountAction = 'approve' | 'open' | 'deposit' | 'withdraw' | 'legacy_withdraw' | 'legacy_rescue';

export function PerplManualAccountScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const {presentationMode, effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const focused = useIsFocused();
  const accountQuery = useManualPerplAccountQuery(ownerAddress, focused);
  const directoryQuery = useMarketDirectoryQuery(ownerAddress, focused);
  const {refetch: refetchAccount} = accountQuery;
  const {refetch: refetchDirectory} = directoryQuery;
  const data = accountQuery.data;
  const correctOwner = Boolean(data && ownerAddress && data.ownerAddress.toLowerCase() === ownerAddress.toLowerCase());
  const directAddressMatches = data?.accountMode === 'not_created' ? data.accountAddress === null
    : data?.accountMode === 'direct_wallet' ? data.accountAddress?.toLowerCase() === ownerAddress?.toLowerCase()
      : data?.accountMode === 'unavailable' && data.accountAddress === null;
  const statusMatchesMode = data?.accountMode === 'not_created' ? data.status === 'not_created'
    : data?.accountMode === 'direct_wallet' ? data.status === 'open'
      : data?.accountMode === 'unavailable' && data.status === 'unavailable';
  const account = data && correctOwner && directAddressMatches && statusMatchesMode && data.chainId === 10143
    && ADDRESS.test(data.exchangeAddress) && ADDRESS.test(data.collateral.address) && data.collateral.symbol === 'AUSD' && data.collateral.decimals === 6
    ? data : null;
  const markets = (directoryQuery.data?.markets ?? []).filter(item => item.kind === 'perpl');
  const [minimumOpenUnits, setMinimumOpenUnits] = useState<string | null>(null);
  const [minimumDepositUnits, setMinimumDepositUnits] = useState<string | null>(null);
  const [minimumWithdrawalUnits, setMinimumWithdrawalUnits] = useState<string | null>(null);
  const [contextError, setContextError] = useState('');
  const [contextLoading, setContextLoading] = useState(true);
  const {amount, setAmount, legacyAmount, setLegacyAmount} = useManualPerplAccountAmounts(
    ownerAddress, account, minimumOpenUnits, contextLoading, contextError);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const expectedTokenAddress = account?.collateral.address;

  useEffect(() => {
    if (!focused || !expectedTokenAddress) return;
    let cancelled = false;
    setContextLoading(true); setContextError(''); setMinimumOpenUnits(null); setMinimumDepositUnits(null); setMinimumWithdrawalUnits(null);
    void perplApi.venues().then(response => {
      const venue = response.venues.find(item => item.venueId === 'perpl-direct-testnet-v1');
      if (!venue || venue.chainId !== 10143 || !venue.collateral
          || venue.collateral.address.toLowerCase() !== expectedTokenAddress.toLowerCase()) {
        throw new Error('Live Perpl Testnet AUSD context does not match this manual account.');
      }
      const minimum = venue.limits?.minAccountOpenUnits ?? venue.collateral.minAccountOpenUnits ?? venue.limits?.minFundingUnits;
      if (typeof minimum === 'string' && /^\d+$/.test(minimum) && BigInt(minimum) > 0n && !cancelled) setMinimumOpenUnits(minimum);
      const minimumDeposit = venue.limits?.minDepositUnits;
      if (typeof minimumDeposit === 'string' && /^\d+$/.test(minimumDeposit) && BigInt(minimumDeposit) > 0n && !cancelled) {
        setMinimumDepositUnits(minimumDeposit);
      }
      const minimumWithdrawal = venue.limits?.minWithdrawalUnits;
      if (typeof minimumWithdrawal === 'string' && /^\d+$/.test(minimumWithdrawal) && BigInt(minimumWithdrawal) > 0n && !cancelled) {
        setMinimumWithdrawalUnits(minimumWithdrawal);
      }
    }).catch(reason => {
      if (!cancelled) { setMinimumOpenUnits(null); setMinimumDepositUnits(null); setMinimumWithdrawalUnits(null);
        setContextError(reason instanceof Error ? reason.message : 'Live Perpl account limits are unavailable.'); }
    }).finally(() => { if (!cancelled) setContextLoading(false); });
    return () => { cancelled = true; };
  }, [expectedTokenAddress, focused]);

  const refresh = useCallback(async () => {
    setError('');
    await Promise.allSettled([refetchAccount(), refetchDirectory()]);
  }, [refetchAccount, refetchDirectory]);
  const pullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);
  const readError = accountQuery.data && !account
    ? 'The manual Perpl account does not match this Mera session on Monad Testnet.'
    : account?.status === 'unavailable' ? 'Perpl could not verify the account at a finalized block. Refresh before taking any action.'
      : [accountQuery.error, directoryQuery.error].filter(Boolean)
      .map(reason => reason instanceof Error ? reason.message : 'Account data could not be refreshed.').join(' ');
  const manualGateOff = account && account.status !== 'unavailable' && Object.values(account.capabilities).every(enabled => !enabled);

  async function prepare(action: AccountAction) {
    if (!account || !ownerAddress) return;
    setBusy(true); setError('');
    try {
      const directUnits = action.startsWith('legacy_') ? parseAmount(legacyAmount, account.collateral.decimals) : parseAmount(amount, account.collateral.decimals);
      const legacy = account.legacyRecovery;
      if (!action.startsWith('legacy_') && account.status === 'unavailable') throw new Error('Perpl account state is unavailable; refresh before preparing an action.');
      const capability = action === 'approve' ? account.capabilities.approve
        : action === 'open' ? account.capabilities.open
          : action === 'deposit' ? account.capabilities.deposit
            : action === 'withdraw' ? account.capabilities.withdraw
              : action === 'legacy_withdraw' ? legacy.capabilities.withdraw : legacy.capabilities.rescueTokens;
      if (!capability) throw new Error('This action is disabled by the default-off manual Perpl Testnet gate.');
      if (action === 'approve' || action === 'open') {
        if (contextLoading || contextError || (account.status === 'not_created' && !minimumOpenUnits)) {
          throw new Error(contextError || 'Live Perpl account setup limits are still loading. Refresh and try again.');
        }
        if (account.status === 'not_created' && minimumOpenUnits && BigInt(directUnits) < BigInt(minimumOpenUnits)) {
          throw new Error(`Perpl requires at least ${formatMonadUnits(minimumOpenUnits, account.collateral.decimals)} AUSD to open an account.`);
        }
        if (presentationMode === 'user' && action === 'approve' && account.status === 'open') {
          if (!minimumDepositUnits) throw new Error('Perpl’s live deposit minimum is unavailable. Refresh account limits before approving.');
          if (BigInt(directUnits) < BigInt(minimumDepositUnits)) throw new Error(`Perpl requires at least ${formatMonadUnits(minimumDepositUnits, account.collateral.decimals)} AUSD for a deposit.`);
        }
        if (action === 'open' && account.status !== 'not_created') throw new Error('This Mera wallet already has a Perpl exchange account.');
        if (BigInt(directUnits) > BigInt(account.collateral.walletBalanceUnits)) throw new Error('The selected amount exceeds the AUSD in your Mera wallet.');
        if (action === 'open' && BigInt(account.collateral.allowanceUnits) !== BigInt(directUnits)) {
          throw new Error('Perpl requires the finalized AUSD allowance to equal the account creation amount exactly. Review an exact approval, then refresh.');
        }
      }
      if (action === 'deposit') {
        if (account.status !== 'open') throw new Error('Create your direct Mera-owned Perpl account first.');
        if (presentationMode === 'user') {
          if (!minimumDepositUnits) throw new Error('Perpl’s live deposit minimum is unavailable. Refresh account limits before depositing.');
          if (BigInt(directUnits) < BigInt(minimumDepositUnits)) throw new Error(`Perpl requires at least ${formatMonadUnits(minimumDepositUnits, account.collateral.decimals)} AUSD for a deposit.`);
        }
        if (BigInt(directUnits) > BigInt(account.collateral.walletBalanceUnits)) throw new Error('The selected amount exceeds the AUSD in your Mera wallet.');
        if (BigInt(account.collateral.allowanceUnits) !== BigInt(directUnits)) {
          throw new Error('Perpl requires the finalized AUSD allowance to equal the deposit amount exactly. Review an exact approval, then refresh.');
        }
      }
      if (action === 'withdraw' && (account.status !== 'open'
          || BigInt(directUnits) > freeCollateral(account.collateral.balanceUnits, account.collateral.lockedUnits))) {
        throw new Error('The withdrawal amount exceeds available AUSD in the direct Perpl account.');
      }
      if (presentationMode === 'user' && action === 'withdraw') {
        if (!minimumWithdrawalUnits) throw new Error('Perpl’s live withdrawal minimum is unavailable. Refresh account limits before withdrawing.');
        if (BigInt(directUnits) < BigInt(minimumWithdrawalUnits)) {
          throw new Error(`Perpl requires at least ${formatMonadUnits(minimumWithdrawalUnits, account.collateral.decimals)} AUSD for a withdrawal.`);
        }
      }
      if (presentationMode === 'user' && action === 'legacy_withdraw') {
        if (!minimumWithdrawalUnits) throw new Error('Perpl’s live withdrawal minimum is unavailable. Refresh account limits before withdrawing.');
        if (BigInt(directUnits) < BigInt(minimumWithdrawalUnits)) {
          throw new Error(`Perpl requires at least ${formatMonadUnits(minimumWithdrawalUnits, account.collateral.decimals)} AUSD for a withdrawal.`);
        }
      }
      if (action === 'legacy_withdraw' && (legacy.status === 'none'
          || BigInt(directUnits) > freeCollateral(legacy.collateral.balanceUnits, legacy.collateral.lockedUnits))) {
        throw new Error('The amount exceeds free collateral in the legacy delegated account.');
      }
      if (action === 'legacy_rescue' && (legacy.status === 'none' || BigInt(directUnits) > BigInt(legacy.collateral.tokenBalanceUnits))) {
        throw new Error('The amount exceeds AUSD held by the legacy recovery contract.');
      }
      const prepared = await manualPerplApi.prepareAccount({action, amountUnits: directUnits, idempotencyKey: createManualPerplIdempotencyKey()});
      const legacyAction = action.startsWith('legacy_');
      const target = action === 'approve' ? account.collateral.address
        : action === 'legacy_withdraw' || action === 'legacy_rescue' ? legacy.accountAddress : account.exchangeAddress;
      if (!target) throw new Error('The expected Perpl transaction target is unavailable.');
      const expected: ManualReviewExpectation = {action, ownerAddress, venueId: 'perpl-direct-testnet-v1', amountUnits: directUnits,
        transactionTarget: target, ...(action === 'approve' ? {approvalSpender: account.exchangeAddress} : {}),
        ...(legacyAction ? {accountMode: 'legacy_delegated', accountAddress: legacy.accountAddress}
          : {accountMode: 'direct_wallet', accountAddress: ownerAddress})};
      validateManualPerplPreparation(prepared, expected);
      navigation.navigate('ManualPerplReview', {prepared, expected, label: actionLabel(action), returnRoute: 'PerplManualAccount',
        accountCreationSetup: account.status === 'not_created' && (action === 'approve' || action === 'open')});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'A fresh account review could not be prepared.'); }
    finally { setBusy(false); }
  }

  const directUnits = account ? maybeAmount(amount, account.collateral.decimals) : null;
  const allowanceMatches = Boolean(account && directUnits && BigInt(account.collateral.allowanceUnits) === BigInt(directUnits));
  const directCanApprove = Boolean(account && directUnits && !allowanceMatches
    && BigInt(directUnits) <= BigInt(account.collateral.walletBalanceUnits)
    && (account.status === 'open' || (minimumOpenUnits !== null && BigInt(directUnits) >= BigInt(minimumOpenUnits))));
  const userCanApprove = account?.status !== 'unavailable' && directCanApprove && (account?.status !== 'open'
    || (minimumDepositUnits !== null && Boolean(directUnits) && BigInt(directUnits!) >= BigInt(minimumDepositUnits)));
  const openDisabledReason = account ? manualPerplOpenDisabledReason({account, amountUnits: directUnits, minimumUnits: minimumOpenUnits,
    contextLoading, contextError, allowanceMatches}) : null;
  const directCanOpen = openDisabledReason === null;
  const directCanDeposit = Boolean(account && directUnits && allowanceMatches
    && BigInt(directUnits) <= BigInt(account.collateral.walletBalanceUnits) && account.capabilities.deposit);
  const userCanDeposit = account?.status === 'open' && directCanDeposit && minimumDepositUnits !== null && Boolean(directUnits)
    && BigInt(directUnits!) >= BigInt(minimumDepositUnits);
  const directCanWithdraw = Boolean(account && directUnits
    && BigInt(directUnits) <= freeCollateral(account.collateral.balanceUnits, account.collateral.lockedUnits) && account.capabilities.withdraw);
  const userCanWithdraw = directCanWithdraw && minimumWithdrawalUnits !== null && Boolean(directUnits)
    && BigInt(directUnits!) >= BigInt(minimumWithdrawalUnits);

  if (presentationMode === 'user') return <UserPerplManualAccountView theme={theme} account={account} markets={markets}
    loading={accountQuery.isLoading || directoryQuery.isLoading} readError={readError || ''} contextError={contextError}
    contextLoading={contextLoading} minimumOpenUnits={minimumOpenUnits} minimumDepositUnits={minimumDepositUnits}
    minimumWithdrawalUnits={minimumWithdrawalUnits} amount={amount} setAmount={setAmount}
    legacyAmount={legacyAmount} setLegacyAmount={setLegacyAmount} directUnits={directUnits} directCanApprove={userCanApprove}
    directCanOpen={directCanOpen} directCanDeposit={userCanDeposit} directCanWithdraw={userCanWithdraw}
    allowanceMatches={allowanceMatches} openDisabledReason={openDisabledReason} busy={busy} error={error}
    manualGateOff={Boolean(manualGateOff)} onBack={() => navigation.goBack()} onRefresh={() => { void pullToRefresh(); }}
    onPrepare={action => { void prepare(action); }}
    onManagePosition={position => navigation.navigate('MarketDetail', {venueId: 'perpl-direct-testnet-v1', marketId: String(position.marketId)})}
    onPositionAction={(position, action, legacy) => navigation.navigate('PerplTrade', tradeParams(position,
      legacy ? 'legacy_delegated' : 'direct_wallet', action))}
    onOrderAction={(order, market, action, legacy) => navigation.navigate('PerplTrade', tradeParams(
      action === 'amend_limit' && market ? {...order, ...market} : order, legacy ? 'legacy_delegated' : 'direct_wallet', action))} />;

  return <Screen refreshing={pullRefreshing || accountQuery.isLoading || directoryQuery.isLoading} onRefresh={() => { void pullToRefresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker="Manual Perpl · Mera owner" title="Your direct AUSD account" copy="Your Mera wallet owns this Perpl exchange account. Every approval, deposit, withdrawal, and order gets a fresh review and signature." />
    {readError ? <Notice live tone="orange" title={account ? 'Showing last good manual account' : 'Manual account needs attention'} message={readError} actionLabel="Refresh" onAction={() => { void pullToRefresh(); }} /> : null}
    {contextError ? <Notice live tone="orange" title="Perpl setup context unavailable" message={contextError} actionLabel="Refresh" onAction={() => { void pullToRefresh(); }} /> : null}
    {error ? <Notice live tone="rose" title="Manual account action unavailable" message={error} /> : null}
    {manualGateOff ? <Notice tone="orange" title="Manual Perpl gate is off" message="Account mutations and order preparation remain disabled until the Testnet manual-trading gate is explicitly enabled." /> : null}
    {account ? <>
      <Card>
        <StatusBadge label={humanize(account.status)} tone={account.status === 'open' ? 'mint' : 'orange'} />
        <DataRow label="Network" value={`Monad Testnet · ${account.chainId}`} />
        <DataRow label="Mera owner" value={shortenAddress(account.ownerAddress)} />
        <DataRow label="Exchange account owner" value={account.status === 'unavailable' ? 'Unavailable' : account.accountAddress ? shortenAddress(account.accountAddress) : 'Not created'} />
        <DataRow label="Exchange account ID" value={account.status === 'unavailable' ? 'Unavailable' : account.accountId === null ? 'Not open on Perpl' : String(account.accountId)} />
        <DataRow label="Perpl Exchange" value={account.exchangeAddress} />
        <DataRow label="AUSD in Perpl account" value={account.status === 'unavailable' ? 'Unavailable' : `${formatMonadUnits(account.collateral.balanceUnits, account.collateral.decimals)} AUSD`} />
        <DataRow label="Free AUSD" value={account.status === 'unavailable' ? 'Unavailable' : `${formatMonadUnits(freeCollateral(account.collateral.balanceUnits, account.collateral.lockedUnits).toString(), account.collateral.decimals)} AUSD`} />
        <DataRow label="AUSD locked" value={account.status === 'unavailable' ? 'Unavailable' : `${formatMonadUnits(account.collateral.lockedUnits, account.collateral.decimals)} AUSD`} />
        <DataRow label="Mera wallet AUSD" value={account.status === 'unavailable' ? 'Unavailable' : `${formatMonadUnits(account.collateral.walletBalanceUnits, account.collateral.decimals)} AUSD`} />
        <DataRow label="AUSD allowance to Perpl" value={account.status === 'unavailable' ? 'Unavailable' : formatMonadUnits(account.collateral.allowanceUnits, account.collateral.decimals)} />
        <DataRow label="Snapshot" value={formatMonadTimestamp(account.observedAt)} />
      </Card>
      <Card><Text style={s.strong}>Direct account setup and collateral</Text>
        {account.status === 'unavailable' ? <Text style={s.body}>Perpl could not verify the direct account state. Refresh before approving, opening, or managing collateral.</Text>
          : account.status === 'not_created' ? <>
          <Field label="AUSD amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Enter initial deposit" />
          {minimumOpenUnits ? <DataRow label="Live minimum account deposit" value={`${formatMonadUnits(minimumOpenUnits, account.collateral.decimals)} AUSD`} /> : <DataRow label="Live minimum account deposit" value={contextLoading ? 'Loading Perpl context…' : 'Unavailable'} />}
          {directCanApprove ? <Button label="Review exact AUSD approval" onPress={() => { void prepare('approve'); }} disabled={!account.capabilities.approve || contextLoading || Boolean(contextError)} loading={busy} /> : null}
          <Button label="Review account creation and initial deposit" variant="secondary" onPress={() => { void prepare('open'); }} disabled={!directCanOpen || contextLoading || Boolean(contextError)} loading={busy} />
          <Text style={s.body}>{directCanOpen
            ? 'The finalized AUSD allowance is ready. Your Perpl account is still not created; review a fresh account creation transaction and sign it with Mera.'
            : openDisabledReason}</Text>
        </> : <>
          <Field label="AUSD amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Enter an amount" />
          {directCanApprove ? <Button label="Review exact AUSD approval" variant="secondary" onPress={() => { void prepare('approve'); }} disabled={!account.capabilities.approve} loading={busy} /> : null}
          <Button label="Review AUSD deposit" onPress={() => { void prepare('deposit'); }} disabled={!directUnits || !allowanceMatches || BigInt(directUnits) > BigInt(account.collateral.walletBalanceUnits) || !account.capabilities.deposit} loading={busy} />
          {directUnits && !allowanceMatches ? <Text style={s.body}>{BigInt(account.collateral.allowanceUnits) < BigInt(directUnits)
            ? 'Perpl needs an exact AUSD allowance for this deposit. Review approval, then refresh.'
            : 'The current AUSD allowance is larger than this deposit. Match the amount to it or review a fresh exact approval.'}</Text> : null}
          <Button label="Review AUSD withdrawal" variant="secondary" onPress={() => { void prepare('withdraw'); }} disabled={!directUnits || BigInt(directUnits) > freeCollateral(account.collateral.balanceUnits, account.collateral.lockedUnits) || !account.capabilities.withdraw} loading={busy} />
        </>}
      </Card>
      {account.status === 'open' ? <>
        <PositionList positions={account.positions} accountMode="direct_wallet" navigation={navigation}
          canClose={account.capabilities.closePosition} canReduce={account.capabilities.reducePosition} />
        <OrderList orders={account.orders} markets={markets} accountMode="direct_wallet" navigation={navigation}
          canCancel={account.capabilities.cancelOrders} canAmend={account.capabilities.limitOrders} />
      </> : null}
      <LegacyRecovery account={account.legacyRecovery} amount={legacyAmount} setAmount={setLegacyAmount} busy={busy}
        onPrepare={action => { void prepare(action); }} navigation={navigation} />
    </> : null}
  </Screen>;
}

function LegacyRecovery({account, amount, setAmount, busy, onPrepare, navigation}: {account: ManualPerplLegacyRecovery; amount: string;
  setAmount: (value: string) => void; busy: boolean; onPrepare: (action: 'legacy_withdraw' | 'legacy_rescue') => void; navigation: any}) {
  if (account.status === 'none') return null;
  return <Card tint="#FFF8E9">
    <Text style={s.strong}>Legacy delegated account · recovery only</Text>
    <Text style={s.body}>This older account stays separate. Recovery actions use fresh Mera signatures; funds are never moved automatically.</Text>
    {account.status === 'unavailable' ? <>
      <DataRow label="Delegated account" value={account.accountAddress ?? 'Unavailable'} />
      <Text style={s.body}>{account.error ?? 'Legacy account state could not be verified. Refresh before attempting recovery.'}</Text>
    </> : <>
    <DataRow label="Delegated account" value={account.accountAddress ?? 'Unavailable'} />
    <DataRow label="Legacy account ID" value={account.accountId === null ? 'Unavailable' : String(account.accountId)} />
    <DataRow label="AUSD account balance" value={`${formatMonadUnits(account.collateral.balanceUnits, 6)} AUSD`} />
    <DataRow label="Free AUSD in account" value={`${formatMonadUnits(freeCollateral(account.collateral.balanceUnits, account.collateral.lockedUnits).toString(), 6)} AUSD`} />
    <DataRow label="Locked AUSD" value={`${formatMonadUnits(account.collateral.lockedUnits, 6)} AUSD`} />
    <DataRow label="AUSD held for recovery" value={`${formatMonadUnits(account.collateral.tokenBalanceUnits, 6)} AUSD`} />
    <Field label="Legacy recovery amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Enter an amount" />
    <Button label="Review legacy AUSD withdrawal" variant="secondary" onPress={() => onPrepare('legacy_withdraw')}
      disabled={!account.capabilities.withdraw || !maybeAmount(amount, 6)
        || BigInt(maybeAmount(amount, 6) ?? '0') > freeCollateral(account.collateral.balanceUnits, account.collateral.lockedUnits)} loading={busy} />
    <Button label="Recover legacy AUSD to Mera wallet" onPress={() => onPrepare('legacy_rescue')}
      disabled={!account.capabilities.rescueTokens || !maybeAmount(amount, 6) || BigInt(maybeAmount(amount, 6) ?? '0') > BigInt(account.collateral.tokenBalanceUnits)} loading={busy} />
    <PositionList positions={account.positions} accountMode="legacy_delegated" navigation={navigation}
      canClose={account.capabilities.closePosition} canReduce={account.capabilities.reducePosition} />
    <OrderList orders={account.orders} markets={[]} accountMode="legacy_delegated" navigation={navigation}
      canCancel={account.capabilities.cancelOrders} canAmend={false} />
    </>}
  </Card>;
}

function PositionList({positions, accountMode, navigation, canClose, canReduce}: {positions: ManualPerplAccount['positions']; accountMode: 'direct_wallet' | 'legacy_delegated';
  navigation: any; canClose: boolean; canReduce: boolean}) {
  return <Card><Text style={s.strong}>{accountMode === 'direct_wallet' ? 'Manual positions' : 'Legacy positions to close'}</Text>
    {positions.length ? positions.map((position, index) => <Card key={`${position.marketId}:${index}`} tint="#F1EDFF">
      <DataRow label="Market" value={`${position.symbol} · ${position.marketId}`} /><DataRow label="Direction" value={humanize(position.side)} />
      <DataRow label="Size" value={formatMonadUnits(position.sizeUnits, Number(position.sizeDecimals ?? 0))} />
      <DataRow label="Entry / mark" value={`${formatMonadUnits(position.entryPrice, Number(position.priceDecimals ?? 0))} / ${formatMonadUnits(position.markPrice, Number(position.priceDecimals ?? 0))}`} />
      <DataRow label="Leverage" value={`${position.leverage}×`} /><DataRow label="Unrealized PnL" value={`${formatMonadUnits(position.unrealizedPnlUnits, 6)} AUSD`} />
      {accountMode === 'legacy_delegated' ? <>
        {canClose ? <Button label={`Review legacy ${position.symbol} close`} onPress={() => navigation.navigate('PerplTrade', tradeParams(position, accountMode, 'close_position'))} /> : null}
        {canReduce ? <Button label={`Review legacy ${position.symbol} reduction`} variant="secondary" onPress={() => navigation.navigate('PerplTrade', tradeParams(position, accountMode, 'reduce_size'))} /> : null}
      </> : canClose || canReduce ? <Button label={`Manage ${position.symbol}`} variant="secondary" onPress={() => navigation.navigate('MarketDetail', {venueId: 'perpl-direct-testnet-v1', marketId: String(position.marketId)})} /> : null}
    </Card>) : <Text style={s.body}>{accountMode === 'direct_wallet' ? 'No manual positions are open.' : 'No legacy positions are open.'}</Text>}
  </Card>;
}

function OrderList({orders, markets, accountMode, navigation, canCancel, canAmend}: {orders: ManualPerplAccount['orders']; markets: Array<{marketId: string; symbol?: string; priceDecimals?: number; sizeDecimals?: number}>;
  accountMode: 'direct_wallet' | 'legacy_delegated'; navigation: any; canCancel: boolean; canAmend: boolean}) {
  return <Card><Text style={s.strong}>{accountMode === 'direct_wallet' ? 'Open manual orders' : 'Legacy orders to cancel'}</Text>
    {orders.length ? orders.map(order => {
      const market = markets.find(item => item.marketId === String(order.marketId));
      const orderSize = market?.sizeDecimals === undefined ? `${order.sizeUnits} raw units` : formatMonadUnits(order.sizeUnits, market.sizeDecimals);
      const orderPrice = order.price == null ? 'Market' : market?.priceDecimals === undefined ? `${order.price} raw units` : formatMonadUnits(order.price, market.priceDecimals);
      return <Card key={String(order.orderId)} tint="#EEF7FF"><DataRow label="Market" value={`${order.symbol ?? 'Perpl'} · ${order.marketId}`} />
        <DataRow label="Order" value={String(order.orderId)} /><DataRow label="Side" value={humanize(order.side)} />
        <DataRow label="Size / price" value={`${orderSize} / ${orderPrice}`} /><DataRow label="Status" value={humanize(order.status)} />
        {canAmend && accountMode === 'direct_wallet' && market ? <Button label={`Review limit amendment · ${order.orderId}`} variant="secondary"
          onPress={() => navigation.navigate('PerplTrade', tradeParams({...order, ...market}, accountMode, 'amend_limit'))} /> : null}
        {canCancel ? <Button label={`${accountMode === 'legacy_delegated' ? 'Review legacy cancellation' : 'Review cancellation'} · ${order.orderId}`} variant="secondary"
          onPress={() => navigation.navigate('PerplTrade', tradeParams(order, accountMode, 'cancel_limit'))} /> : null}
      </Card>;
    }) : <Text style={s.body}>{accountMode === 'direct_wallet' ? 'No open manual orders were returned.' : 'No legacy orders remain.'}</Text>}
  </Card>;
}

function tradeParams(item: Record<string, any>, accountMode: 'direct_wallet' | 'legacy_delegated', action: string) {
  const priceDecimals = safePrecision(item.priceDecimals);
  const sizeDecimals = safePrecision(item.sizeDecimals);
  return {marketId: String(item.marketId), symbol: String(item.symbol ?? 'Perpl market'), accountMode, action, side: item.side,
    orderId: item.orderId === undefined ? undefined : String(item.orderId),
    ...(priceDecimals === null ? {} : {priceDecimals}), ...(sizeDecimals === null ? {} : {sizeDecimals})};
}
function safePrecision(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 30 ? value : null;
}
function parseAmount(value: string, decimals: number) { const units = maybeAmount(value, decimals); if (!units) throw new Error('Enter a positive AUSD amount.'); return units; }
function freeCollateral(balanceUnits: string, lockedUnits: string) {
  const free = BigInt(balanceUnits) - BigInt(lockedUnits);
  return free > 0n ? free : 0n;
}
function maybeAmount(value: string, decimals: number): string | null {
  try { const units = parseMonadAmount(value, decimals); return BigInt(units) > 0n ? units : null; } catch { return null; }
}
function actionLabel(action: AccountAction) {
  const labels: Record<AccountAction, string> = {approve: 'Approve AUSD for direct Perpl', open: 'Open direct Perpl account and deposit AUSD',
    deposit: 'Deposit AUSD to direct Perpl', withdraw: 'Withdraw AUSD from direct Perpl',
    legacy_withdraw: 'Withdraw free AUSD from legacy Perpl', legacy_rescue: 'Recover legacy AUSD to Mera'};
  return labels[action];
}
function humanize(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
const ADDRESS = /^0x[0-9a-f]{40}$/i;
