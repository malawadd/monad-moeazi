import React, {useCallback, useState} from 'react';
import {Linking, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import QRCode from 'react-native-qrcode-svg';
import {useFocusEffect} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, LoadingBlock, Notice, PageHeader} from '../components/Ui';
import {monadApi} from '../services/monadApi';
import {formatMonadUnits} from '../services/monadFormatting';
import {haptics} from '../services/haptics';
import {useApp} from '../state/AppContext';
import type {MonadWalletSnapshot} from '../types/monad';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

const MON_FAUCET = 'https://faucet.monad.xyz/';
const CIRCLE_FAUCET = 'https://faucet.circle.com/';

export function MonadFundingScreen() {
  const {ownerAddress} = useApp();
  const [wallet, setWallet] = useState<MonadWalletSnapshot | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError(''); setFeedback('');
    try {
      const result = await monadApi.wallet();
      if (result.chainId !== 10143 || result.ownerAddress.toLowerCase() !== ownerAddress?.toLowerCase()) {
        throw new Error('The wallet response does not match your Monad Testnet session.');
      }
      setWallet(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The funding address could not be loaded.');
    } finally { setLoading(false); }
  }, [ownerAddress]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function openFaucet(url: string) {
    try { await Linking.openURL(url); }
    catch { setError('The faucet link could not be opened on this device.'); }
  }

  const copyAddress = () => {
    if (!wallet) return;
    Clipboard.setString(wallet.ownerAddress); haptics.confirm();
    setFeedback('Mera address copied. Select Monad Testnet before sending tokens.');
  };

  return <FlowScreen refreshing={loading} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Funding · testnet" title="Fund your Mera wallet" copy="Use Monad Testnet only. Never send mainnet funds to this test wallet." />
    {error ? <Notice live tone="rose" title="Funding information unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {feedback ? <Notice live tone="mint" title="Copied" message={feedback} /> : null}
    {wallet?.stale ? <Notice tone="orange" title="Balances may be out of date" message={`Observed at block ${wallet.observedBlock}.`} /> : null}
    {loading && !wallet ? <LoadingBlock label="Loading your Mera address" /> : null}
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
      </Card>
    </> : null}
  </FlowScreen>;
}

const styles = StyleSheet.create({
  address: {...type.meta, color: colors.ink, fontSize: 13, lineHeight: 21, textAlign: 'center'},
  qrWrap: {alignSelf: 'center', padding: spacing.sm, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.white},
});
