import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, Field, LoadingBlock, Notice, PageHeader, Screen} from '../components/Ui';
import {createMonadIdempotencyKey, monadApi} from '../services/monadApi';
import {formatMonadUnits, parseMonadAmount} from '../services/monadFormatting';
import {validatePreparedMonadOperation, isAddress} from '../services/monadValidation';
import type {MonadAsset, MonadOperationKind, MonadWalletSnapshot} from '../types/monad';
import {useApp} from '../state/AppContext';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

const assets: MonadAsset[] = ['MON', 'USDC'];

export function SendScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [wallet, setWallet] = useState<MonadWalletSnapshot | null>(null);
  const [asset, setAsset] = useState<MonadAsset>('MON');
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    setChecking(true); setError('');
    try {
      const result = await monadApi.wallet();
      if (result.chainId !== 10143 || result.ownerAddress.toLowerCase() !== ownerAddress?.toLowerCase()) throw new Error('Wallet data does not match this session.');
      setWallet(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Wallet data is unavailable.'); }
    finally { setChecking(false); }
  }, [ownerAddress]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function review() {
    setLoading(true); setError('');
    try {
      if (!wallet || wallet.stale) throw new Error('A current wallet balance is required before preparing a transfer. Pull down to refresh.');
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      if (!isAddress(recipient)) throw new Error('Enter a valid 0x wallet address.');
      const balance = wallet.balances.find(row => row.asset === asset);
      if (!balance) throw new Error(`The service did not return a ${asset} balance for this wallet.`);
      const amountUnits = parseMonadAmount(amount, balance.decimals);
      if (BigInt(amountUnits) > BigInt(balance.amountUnits)) throw new Error(`The requested amount exceeds the observed ${asset} balance.`);
      const kind: MonadOperationKind = asset === 'MON' ? 'send_mon' : 'send_usdc';
      const prepared = await monadApi.prepare({kind, idempotencyKey: createMonadIdempotencyKey(), amount: amount.trim(), asset, recipient});
      const expected = {ownerAddress, kind, amount: amount.trim(), asset, recipient};
      validatePreparedMonadOperation(prepared, expected);
      navigation.navigate('OperationReview', {prepared, expected, asset});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The transfer could not be prepared.'); }
    finally { setLoading(false); }
  }

  return <Screen refreshing={checking} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Send" title="Review a transfer" copy="Moeazi prepares the exact Monad transaction first. Your Mera passkey signs only after you review it." />
    {error ? <Notice live tone="rose" title="Transfer not prepared" message={error} actionLabel="Refresh balance" onAction={() => { void refresh(); }} /> : null}
    {checking && !wallet ? <LoadingBlock label="Checking wallet balance" lines={2} /> : null}
    {wallet ? <Card>
      <Text style={s.meta}>{wallet.stale ? 'Balance may be out of date' : `Observed at block ${wallet.observedBlock}`}</Text>
      <View style={styles.assetChoices}>
        {assets.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{selected: asset === item}} onPress={() => setAsset(item)} style={[styles.assetChoice, asset === item && styles.assetSelected]}><Text style={styles.assetText}>{item}</Text></Pressable>)}
      </View>
      <Field label={`Amount (${asset})`} value={amount} onChangeText={setAmount} placeholder="0" keyboardType="decimal-pad" />
      <Field label="Recipient address" value={recipient} onChangeText={setRecipient} autoCapitalize="none" autoCorrect={false} placeholder="0x…" />
      <Text style={s.body}>Available: {wallet.balances.find(row => row.asset === asset)
        ? `${formatMonadUnits(wallet.balances.find(row => row.asset === asset)!.amountUnits, wallet.balances.find(row => row.asset === asset)!.decimals)} ${asset}` : 'Not returned by the service'}</Text>
    </Card> : null}
    <Button label="Prepare transfer review" onPress={() => { void review(); }} loading={loading} disabled={!wallet} />
    <Text style={s.body}>The fee is paid in MON. A transfer can be irreversible after broadcast.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  assetChoices: {flexDirection: 'row', gap: spacing.sm},
  assetChoice: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper},
  assetSelected: {backgroundColor: colors.yellow},
  assetText: {...type.meta, color: colors.ink, fontSize: 12},
});
