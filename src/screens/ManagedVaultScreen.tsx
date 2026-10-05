import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {TypedDataDefinition} from 'viem';
import {Button, Card, DataRow, Field, LoadingBlock, Notice, PageHeader, Screen} from '../components/Ui';
import {createMonadIdempotencyKey, getMonadApprovalRequirement, monadApi} from '../services/monadApi';
import {formatMonadTimestamp, formatMonadUnits, parseMonadAmount} from '../services/monadFormatting';
import {validatePreparedMonadMandate, validatePreparedMonadOperation} from '../services/monadValidation';
import {openMeraSigningSession} from '../services/wallet/meraAuth';
import type {MonadAccountScope, MonadMandate, MonadWalletSnapshot, PreparedMonadMandate} from '../types/monad';
import {useApp} from '../state/AppContext';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

const USDC_DECIMALS = 6;
function typedValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value);
}
export function ManagedVaultScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [mandate, setMandate] = useState<MonadMandate | null>(null);
  const [wallet, setWallet] = useState<MonadWalletSnapshot | null>(null);
  const [preparedMandate, setPreparedMandate] = useState<PreparedMonadMandate | null>(null);
  const [amount, setAmount] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [mandateAsset, setMandateAsset] = useState<'USDC' | 'WMON'>('USDC');
  const [returnAsset, setReturnAsset] = useState<'USDC' | 'WMON'>('USDC');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setChecking(true); setError('');
    try {
      const [mandateResult, walletResult] = await Promise.all([monadApi.mandate(), monadApi.wallet()]);
      if (walletResult.chainId !== 10143 || walletResult.ownerAddress.toLowerCase() !== ownerAddress?.toLowerCase()) throw new Error('Wallet data does not match this session.');
      if (mandateResult.mandate && mandateResult.mandate.ownerAddress.toLowerCase() !== ownerAddress?.toLowerCase()) throw new Error('The managed mandate belongs to a different wallet.');
      setMandate(mandateResult.mandate); setWallet(walletResult);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Managed vault information is unavailable.'); }
    finally { setChecking(false); }
  }, [ownerAddress]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function prepareMandate() {
    setLoading(true); setError(''); setMessage('');
    try {
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      if (!/^[1-7]$/.test(durationDays)) throw new Error('Choose a mandate duration from 1 to 7 days.');
      const amountUnits = parseMonadAmount(amount, mandateAsset === 'USDC' ? USDC_DECIMALS : 18);
      const result = await monadApi.prepareMandate({amount: amount.trim(), asset: mandateAsset, durationDays: Number(durationDays), idempotencyKey: createMonadIdempotencyKey()});
      validatePreparedMonadMandate(result, ownerAddress, {amount: amount.trim(), amountUnits, asset: mandateAsset, durationDays: Number(durationDays)});
      setPreparedMandate(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The mandate could not be prepared.'); }
    finally { setLoading(false); }
  }

  async function signMandate() {
    if (!preparedMandate || !ownerAddress) return;
    setLoading(true); setError(''); setMessage('');
    let session: Awaited<ReturnType<typeof openMeraSigningSession>> | undefined;
    try {
      const amountUnits = parseMonadAmount(amount, mandateAsset === 'USDC' ? USDC_DECIMALS : 18);
      validatePreparedMonadMandate(preparedMandate, ownerAddress, {amount: amount.trim(), amountUnits, asset: mandateAsset, durationDays: Number(durationDays)});
      session = await openMeraSigningSession('signin');
      if (session.address.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error('The passkey opened a different Mera wallet. The mandate was not signed.');
      const signature = await session.signTypedData(10143, preparedMandate.typedData as unknown as TypedDataDefinition);
      session.end(); session = undefined;
      const saved = await monadApi.submitMandate(preparedMandate.mandateId, signature);
      setMandate(saved); setPreparedMandate(null);
      setMessage('The EIP-712 signature was verified and stored. On-chain authorization is still required before deposits or trading.');
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The mandate signature could not be verified.'); }
    finally { session?.end(); setLoading(false); }
  }

  async function prepareOnchain(kind: 'mandate_authorize' | 'mandate_revoke' | 'vault_stop' | 'vault_resume') {
    if (!ownerAddress || !mandate?.vaultAddress) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const key = createMonadIdempotencyKey();
      const prepared = kind === 'mandate_authorize'
        ? await monadApi.prepareMandateAuthorization(mandate.mandateId, key)
        : kind === 'mandate_revoke'
          ? await monadApi.prepareMandateRevoke(mandate.mandateId, key)
          : kind === 'vault_resume' ? await monadApi.prepareVaultResume(key) : await monadApi.prepareVaultStop(key);
      const expected = {ownerAddress, kind, vaultAddress: mandate.vaultAddress};
      validatePreparedMonadOperation(prepared, expected);
      navigation.navigate('OperationReview', {prepared, expected, asset: 'Managed vault'});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The vault transaction could not be prepared.'); }
    finally { setLoading(false); }
  }

  async function prepareVaultOperation(kind: 'vault_deposit' | 'vault_return') {
    setLoading(true); setError(''); setMessage('');
    try {
      if (!ownerAddress || !mandate?.vaultAddress) throw new Error('A verified vault address is required.');
      if (kind === 'vault_deposit' && mandate.status !== 'active') throw new Error('The signed mandate must be active on chain before depositing.');
      const asset = kind === 'vault_deposit' ? 'USDC' : returnAsset;
      const source = kind === 'vault_deposit'
        ? wallet?.balances.find(row => row.asset === 'USDC')
        : mandate.vaultBalances?.find(row => row.asset === asset);
      const sourceStale = kind === 'vault_deposit' ? wallet?.stale !== false
        : mandate.vaultBalances?.find(row => row.asset === asset)?.stale !== false;
      if (!source || sourceStale) throw new Error(`A current ${asset} balance is not available for this review.`);
      const units = parseMonadAmount(amount, source.decimals);
      if (BigInt(units) > BigInt(source.amountUnits)) throw new Error(`The requested ${asset} amount exceeds the observed balance.`);
      const prepared = await monadApi.prepare({kind, idempotencyKey: createMonadIdempotencyKey(), amount: amount.trim(), asset, vaultAddress: mandate.vaultAddress});
      const expected = {ownerAddress, kind, amount: amount.trim(), asset, vaultAddress: mandate.vaultAddress};
      validatePreparedMonadOperation(prepared, expected);
      navigation.navigate('OperationReview', {prepared, expected, asset});
    } catch (reason) {
      const approval = kind === 'vault_deposit' ? getMonadApprovalRequirement(reason) : null;
      if (approval) navigation.navigate('TokenApprovalReview', {
        approval, tokenSymbol: 'USDC', tokenDecimals: USDC_DECIMALS, returnRoute: 'ManagedVault',
      });
      else setError(reason instanceof Error ? reason.message : 'The vault action could not be prepared.');
    }
    finally { setLoading(false); }
  }

  const active = mandate?.status === 'active';
  const vaultBalances = mandate?.vaultBalances ?? [];
  const currentVaultBalance = vaultBalances.find(row => row.asset === returnAsset);
  const walletUsdc = wallet?.balances.find(row => row.asset === 'USDC');
  return <Screen refreshing={checking} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Managed vault" title="Set clear limits first" copy="A typed mandate signature is followed by a separately reviewed on-chain authorization. Deposits and returns each need their own review." />
    {error ? <Notice live tone="rose" title="Managed vault needs attention" message={error} actionLabel="Refresh" onAction={() => { void refresh(); }} /> : null}
    {message ? <Notice live tone="mint" title="Mandate update" message={message} /> : null}
    {checking && !wallet ? <LoadingBlock label="Loading mandate and balances" lines={3} /> : null}
    {mandate ? <Card>
      <DataRow label="Mandate status" value={mandate.status} />
      <DataRow label="Vault trading" value={mandate.vaultStopped ? 'Stopped by owner' : 'Available only under an active signed mandate'} />
      <DataRow label="Vault address" value={mandate.vaultAddress ?? 'Not provided by the service'} />
      {mandate.expiresAt ? <DataRow label="Mandate expires" value={formatMonadTimestamp(mandate.expiresAt)} /> : null}
      <DataRow label="Wallet USDC" value={walletUsdc ? `${formatMonadUnits(walletUsdc.amountUnits, walletUsdc.decimals)} USDC` : 'Not returned by the service'} />
      {(['USDC', 'WMON'] as const).map(asset => {
        const balance = vaultBalances.find(row => row.asset === asset);
        return <DataRow key={asset} label={`Vault ${asset}`} value={balance
          ? `${formatMonadUnits(balance.amountUnits, balance.decimals)} ${asset} · block ${balance.observedBlock}${balance.stale ? ' · stale' : ''}`
          : 'Not returned by the service'} />;
      })}
    </Card> : <Card><Text style={s.strong}>No managed mandate is recorded.</Text><Text style={s.body}>Choose an amount and duration to prepare the exact terms for your review.</Text></Card>}

    {mandate?.status === 'signed' ? <Card>
      <Text style={s.strong}>On-chain authorization required</Text>
      <Text style={s.body}>The typed signature is stored, but the mandate is not active until the separate owner transaction is finalized.</Text>
      <Button label="Review on-chain authorization" onPress={() => { void prepareOnchain('mandate_authorize'); }} loading={loading} />
    </Card> : null}

    {mandate?.vaultStopped ? <Card>
      <Text style={s.strong}>Owner trading stop is active</Text>
      <Text style={s.body}>Only the Mera owner can resume this vault. A fresh mandate is still required before an operator can trade.</Text>
      <Button label="Review owner trading resume" variant="secondary" onPress={() => { void prepareOnchain('vault_resume'); }} loading={loading} />
    </Card> : null}

    {(!mandate || (['revoked', 'stopped', 'expired', 'inactive'].includes(mandate.status) && !mandate.vaultStopped)) ? <Card>
      <Text style={s.strong}>Prepare a new mandate</Text>
      <Text style={s.body}>Input asset for this mandate</Text>
      <View style={styles.assetChoices}>{(['USDC', 'WMON'] as const).map(asset => <Pressable key={asset}
        accessibilityRole="button" accessibilityState={{selected: mandateAsset === asset}}
        onPress={() => { setMandateAsset(asset); setAmount(''); setPreparedMandate(null); }}
        style={[styles.assetChoice, mandateAsset === asset && styles.assetSelected]}><Text style={styles.assetText}>{asset}</Text></Pressable>)}</View>
      <Field label={`Maximum ${mandateAsset} input`} value={amount} onChangeText={setAmount} placeholder="0" keyboardType="decimal-pad" />
      <Field label="Duration in days · up to 7" value={durationDays} onChangeText={setDurationDays} placeholder="1–7" keyboardType="number-pad" />
      <Button label="Prepare EIP-712 review" variant="secondary" onPress={() => { void prepareMandate(); }} loading={loading} />
    </Card> : null}

    {preparedMandate ? <>
      <Card>
        <Text style={s.strong}>Mandate details</Text>
        <DataRow label="Owner" value={preparedMandate.ownerAddress} />
        <DataRow label="Vault contract" value={preparedMandate.vaultAddress} />
        <DataRow label="Network" value="Monad Testnet · 10143" />
        <DataRow label="Nonce" value={preparedMandate.nonce} />
        <DataRow label="Valid after" value={preparedMandate.validAfter ? formatMonadTimestamp(preparedMandate.validAfter) : 'As defined in signed terms'} />
        <DataRow label="Expires" value={formatMonadTimestamp(preparedMandate.expiresAt)} />
        <DataRow label="Maximum input" value={`${formatMonadUnits(preparedMandate.review?.amountUnits ?? '0', mandateAsset === 'USDC' ? 6 : 18)} ${mandateAsset}`} />
        {preparedMandate.review?.amountPerTradeUnits ? <DataRow label="Maximum per trade" value={`${formatMonadUnits(preparedMandate.review.amountPerTradeUnits, mandateAsset === 'USDC' ? 6 : 18)} ${mandateAsset}`} /> : null}
        <DataRow label="EIP-712 type" value={preparedMandate.typedData.primaryType} />
        {Object.entries(preparedMandate.typedData.message).map(([key, value]) => <DataRow key={key} label={key} value={typedValue(value)} />)}
      </Card>
      <Button label="Sign this exact mandate" onPress={() => { void signMandate(); }} loading={loading} />
      <Button label="Discard mandate review" variant="secondary" disabled={loading} onPress={() => setPreparedMandate(null)} />
    </> : null}

    {mandate?.vaultAddress ? <Card>
      <Text style={s.strong}>Owner vault actions</Text>
      {active ? <>
        <Field label="USDC deposit amount" value={amount} onChangeText={setAmount} placeholder="0" keyboardType="decimal-pad" />
        <Button label="Review USDC deposit" onPress={() => { void prepareVaultOperation('vault_deposit'); }} loading={loading} />
      </> : <Text style={s.body}>Deposits need a mandate that is active on chain.</Text>}
      <Text style={s.body}>Returns remain available when a mandate has expired, been revoked, or trading has stopped.</Text>
      <View style={styles.assetChoices}>{(['USDC', 'WMON'] as const).map(asset => <Pressable key={asset} accessibilityRole="button" accessibilityState={{selected: returnAsset === asset}} onPress={() => setReturnAsset(asset)} style={[styles.assetChoice, returnAsset === asset && styles.assetSelected]}><Text style={styles.assetText}>{asset}</Text></Pressable>)}</View>
      <Text style={s.body}>Observed vault balance: {currentVaultBalance && !currentVaultBalance.stale ? `${formatMonadUnits(currentVaultBalance.amountUnits, currentVaultBalance.decimals)} ${returnAsset}` : 'Current balance unavailable'}</Text>
      <Field label={`Return amount (${returnAsset})`} value={amount} onChangeText={setAmount} placeholder="0" keyboardType="decimal-pad" />
      <Button label={`Review ${returnAsset} return`} variant="secondary" onPress={() => { void prepareVaultOperation('vault_return'); }} loading={loading} disabled={!currentVaultBalance || currentVaultBalance.stale} />
      {!mandate.vaultStopped ? <Button label="Review owner trading stop" variant="danger" onPress={() => { void prepareOnchain('vault_stop'); }} loading={loading} /> : null}
      {mandate.status !== 'revoked' ? <Button label="Review mandate revoke" variant="secondary" onPress={() => { void prepareOnchain('mandate_revoke'); }} loading={loading} /> : null}
    </Card> : null}
    <Text style={s.body}>Managed agent trading stays inactive until the service reports verified on-chain authorization. Every owner action is separately signed and reviewed.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  assetChoices: {flexDirection: 'row', gap: spacing.sm},
  assetChoice: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper},
  assetSelected: {backgroundColor: colors.yellow},
  assetText: {...type.meta, color: colors.ink, fontSize: 11},
});
