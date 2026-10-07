import React, {useCallback, useState} from 'react';
import {Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, LoadingBlock, Notice, PageHeader, Screen} from '../components/Ui';
import {monadApi} from '../services/monadApi';
import {formatMonadUnits, shortenAddress} from '../services/monadFormatting';
import type {MonadWalletSnapshot} from '../types/monad';
import {screenStyles as s} from '../theme/screenStyles';
import {useApp} from '../state/AppContext';

export function MonadHomeScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [wallet, setWallet] = useState<MonadWalletSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const snapshot = await monadApi.wallet();
      if (snapshot.chainId !== 10143 || snapshot.ownerAddress.toLowerCase() !== ownerAddress?.toLowerCase()) {
        throw new Error('The wallet snapshot does not match this Monad Testnet session.');
      }
      setWallet(snapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Wallet balances could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [ownerAddress]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Monad Testnet · 10143" title="Your money, in view" copy="Balances come from the Monad API and include the block they were checked at." />
    {error ? <Notice live tone="rose" title="Balances are unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {wallet?.stale ? <Notice tone="orange" title="Balance data may be out of date" message={`Last checked at block ${wallet.observedBlock}.`} /> : null}
    {loading && !wallet ? <LoadingBlock label="Checking Monad balances" lines={3} /> : null}
    {wallet ? <Card>
      <Text style={s.meta}>Mera wallet · {shortenAddress(wallet.ownerAddress)}</Text>
      {wallet.balances.length
        ? wallet.balances.map(balance => <DataRow key={`${balance.asset}:${balance.tokenAddress ?? 'native'}`} label={balance.asset} value={`${formatMonadUnits(balance.amountUnits, balance.decimals)} ${balance.asset}`} />)
        : <Text style={s.body}>The service returned no asset balances for this wallet.</Text>}
      <Text style={s.meta}>Observed block {wallet.observedBlock} · {new Date(wallet.observedAt).toLocaleString()}</Text>
    </Card> : null}
    <View>
      <Button label="Add testnet funds" onPress={() => navigation.navigate('Funding')} />
      <Button label="Send MON or USDC" variant="secondary" onPress={() => navigation.navigate('Send')} />
      <Button label="Markets and trade review" variant="secondary" onPress={() => navigation.navigate('Markets')} />
      <Button label="Wrap or unwrap MON" variant="secondary" onPress={() => navigation.navigate('Wrap')} />
      <Button label="Managed vault" variant="secondary" onPress={() => navigation.navigate('ManagedVault')} />
      <Button label="Perpl Testnet markets" variant="secondary" onPress={() => navigation.navigate('PerplMarkets')} />
      <Button label="Mock Spot and Perp" variant="secondary" onPress={() => navigation.navigate('AutonomyChoice')} />
      <Button label="Autonomous trading · testnet" onPress={() => navigation.navigate('AutonomyChoice')} />
    </View>
  </Screen>;
}
