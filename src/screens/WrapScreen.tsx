import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, Field, LoadingBlock, Notice, PageHeader, Screen} from '../components/Ui';
import {createMonadIdempotencyKey, monadApi} from '../services/monadApi';
import {formatMonadUnits, parseMonadAmount} from '../services/monadFormatting';
import {validatePreparedMonadOperation} from '../services/monadValidation';
import type {MonadWalletSnapshot} from '../types/monad';
import {useApp} from '../state/AppContext';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

type Action = 'wrap' | 'unwrap';

export function WrapScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [wallet, setWallet] = useState<MonadWalletSnapshot | null>(null);
  const [action, setAction] = useState<Action>('wrap');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

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

  async function prepareReview() {
    setLoading(true); setError('');
    try {
      if (!ownerAddress || !wallet || wallet.stale) throw new Error('A current wallet balance is required before preparing this action.');
      const asset = action === 'wrap' ? 'MON' : 'WMON';
      const balance = wallet.balances.find(row => row.asset === asset);
      if (!balance) throw new Error(`The service did not return a ${asset} balance.`);
      const units = parseMonadAmount(amount, balance.decimals);
      if (BigInt(units) > BigInt(balance.amountUnits)) throw new Error(`The requested amount exceeds the observed ${asset} balance.`);
      const prepared = await monadApi.prepare({kind: action, idempotencyKey: createMonadIdempotencyKey(), amount: amount.trim(), asset});
      const expected = {ownerAddress, kind: action, amount: amount.trim(), asset: 'WMON'};
      validatePreparedMonadOperation(prepared, expected);
      navigation.navigate('OperationReview', {prepared, expected, asset: inputAsset});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The action could not be prepared.'); }
    finally { setLoading(false); }
  }

  const inputAsset = action === 'wrap' ? 'MON' : 'WMON';
  const outputAsset = action === 'wrap' ? 'WMON' : 'MON';
  const balance = wallet?.balances.find(row => row.asset === inputAsset);

  return <Screen refreshing={checking} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Wrap" title="Move between MON and WMON" copy="Review the exact contract call and maximum MON network fee before signing." />
    {error ? <Notice live tone="rose" title="Action unavailable" message={error} actionLabel="Refresh balance" onAction={() => { void refresh(); }} /> : null}
    {checking && !wallet ? <LoadingBlock label="Checking MON and WMON balances" lines={2} /> : null}
    {wallet ? <Card>
      <View style={styles.actions}>{(['wrap', 'unwrap'] as const).map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{selected: action === item}} onPress={() => setAction(item)} style={[styles.action, action === item && styles.selected]}><Text style={styles.actionLabel}>{item === 'wrap' ? 'MON → WMON' : 'WMON → MON'}</Text></Pressable>)}</View>
      <Field label={`Amount (${inputAsset})`} value={amount} onChangeText={setAmount} placeholder="0" keyboardType="decimal-pad" />
      <Text style={s.body}>Available: {balance ? `${formatMonadUnits(balance.amountUnits, balance.decimals)} ${inputAsset}` : 'Not returned by the service'}</Text>
      <Text style={s.meta}>You receive {outputAsset}; amounts and fees are confirmed by the Monad API.</Text>
    </Card> : null}
    <Button label={`Prepare ${action} review`} onPress={() => { void prepareReview(); }} loading={loading} disabled={!wallet} />
  </Screen>;
}

const styles = StyleSheet.create({
  actions: {flexDirection: 'row', gap: spacing.sm},
  action: {flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper},
  selected: {backgroundColor: colors.yellow},
  actionLabel: {...type.meta, color: colors.ink, fontSize: 10, textAlign: 'center'},
});
