import React, {useCallback, useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import {useIsFocused, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, LoadingBlock, Notice, PageHeader, TextLink} from '../components/Ui';
import {MONAD_AUSD_ADDRESS, MONAD_AUSD_FAUCET_ADDRESS} from '../config/monadAUsd';
import {monadApi, createMonadIdempotencyKey} from '../services/monadApi';
import {formatMonadUnits} from '../services/monadFormatting';
import {haptics} from '../services/haptics';
import {validatePreparedMonadOperation} from '../services/monadValidation';
import {useApp} from '../state/AppContext';
import {useMonadWalletQuery} from '../services/useMarketQueries';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

const MON_FAUCET = 'https://faucet.monad.xyz/';
const CIRCLE_FAUCET = 'https://faucet.circle.com/';
const AGORA_FAUCET_DOCS = 'https://docs.agora.finance/instant-settlement/guides/getting-testnet-tokens';

export function MonadFundingScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const walletQuery = useMonadWalletQuery(ownerAddress, useIsFocused());
  const {refetch} = walletQuery;
  const wallet = walletQuery.data ?? null;
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [preparingAusd, setPreparingAusd] = useState(false);
  const refresh = useCallback(async () => { setFeedback(''); await refetch(); }, [refetch]);
  const pullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);
  const walletError = walletQuery.error instanceof Error ? walletQuery.error.message : '';

  async function openFaucet(url: string) {
    try { await Linking.openURL(url); }
    catch { setError('The faucet link could not be opened on this device.'); }
  }

  const copyAddress = () => {
    if (!wallet) return;
    Clipboard.setString(wallet.ownerAddress); haptics.confirm();
    setFeedback('Mera address copied. Select Monad Testnet before sending tokens.');
  };

  async function prepareAusdClaim() {
    if (!ownerAddress || !wallet) return;
    setPreparingAusd(true); setError(''); setFeedback('');
    try {
      const prepared = await monadApi.prepareAusdFaucet(createMonadIdempotencyKey());
      const expected = {ownerAddress, kind: 'claim_ausd_faucet' as const, asset: 'AUSD',
        recipient: ownerAddress, tokenAddress: MONAD_AUSD_ADDRESS, faucetAddress: MONAD_AUSD_FAUCET_ADDRESS,
        method: 'requestFunds(address)'};
      validatePreparedMonadOperation(prepared, expected);
      navigation.navigate('OperationReview', {prepared, expected, asset: 'AUSD'});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The Agora AUSD faucet request could not be prepared.');
    } finally { setPreparingAusd(false); }
  }

  return <FlowScreen refreshing={pullRefreshing || walletQuery.isLoading} onRefresh={() => { void pullToRefresh(); }}>
    <PageHeader kicker="Funding · testnet" title="Fund your Mera wallet" copy="Use Monad Testnet only. Never send mainnet funds to this test wallet." />
    {walletError ? <Notice live tone="orange" title={wallet ? 'Showing last good balance' : 'Funding information unavailable'} message={walletError} actionLabel="Retry" onAction={() => { void pullToRefresh(); }} /> : null}
    {error ? <Notice live tone="rose" title="Funding action unavailable" message={error} /> : null}
    {feedback ? <Notice live tone="mint" title="Copied" message={feedback} /> : null}
    {wallet?.stale ? <Notice tone="orange" title="Balances may be out of date" message={`Observed at block ${wallet.observedBlock}.`} /> : null}
    {walletQuery.isLoading ? <LoadingBlock label="Loading your Mera address" /> : null}
    {wallet ? <>
      <Card tint={colors.skyTint}>
        <Text style={s.strong}>Your Mera address</Text>
        <Text selectable style={styles.address}>{wallet.ownerAddress}</Text>
        <View style={styles.qrWrap}>
          <QRCode value={wallet.ownerAddress} size={190} backgroundColor={colors.white} color={colors.ink} />
        </View>
        <Button label="Copy Mera address" onPress={copyAddress} />
        <Text style={s.meta}>Network: Monad Testnet · Chain ID 10143</Text>
        {wallet.balances.map(asset => <DataRow key={`${asset.asset}:${asset.tokenAddress ?? 'native'}`} label={`${asset.asset} balance`} value={`${formatMonadUnits(asset.amountUnits, asset.decimals)} ${asset.asset}`} />)}
        <Text style={s.meta}>Observed block {wallet.observedBlock} · {new Date(wallet.observedAt).toLocaleString()}</Text>
      </Card>
      <Card tint={colors.mintTint}>
        <Text style={s.strong}>Get test tokens</Text>
        <Text style={s.body}>The faucet sites open outside Moeazi. Check the network and destination address before requesting funds.</Text>
        <Button label="Open Monad MON faucet" onPress={() => { void openFaucet(MON_FAUCET); }} />
        <Button label="Open Circle USDC faucet" variant="secondary" onPress={() => { void openFaucet(CIRCLE_FAUCET); }} />
        <Button label="Request Agora test AUSD" variant="secondary" loading={preparingAusd}
          disabled={preparingAusd || !ownerAddress} onPress={() => { void prepareAusdClaim(); }}
          hint="Prepares the faucet transaction for Mera review. You will sign once and pay the displayed MON network fee." />
        <Text style={s.meta}>Agora Monad Testnet AUSD · contract {MONAD_AUSD_ADDRESS} · faucet {MONAD_AUSD_FAUCET_ADDRESS}</Text>
        <TextLink label="Agora faucet instructions" onPress={() => { void openFaucet(AGORA_FAUCET_DOCS); }} />
      </Card>
    </> : null}
  </FlowScreen>;
}

const styles = StyleSheet.create({
  address: {...type.meta, color: colors.ink, fontSize: 13, lineHeight: 21, textAlign: 'center'},
  qrWrap: {alignSelf: 'center', padding: spacing.sm, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.white},
});
