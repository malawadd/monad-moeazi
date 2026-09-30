import React, {useCallback, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, Notice, PageHeader, Panel, Screen, TextLink} from '../components/Ui';
import {useApp} from '../state/AppContext';
import {border, colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {confirmSensitiveAction} from '../services/biometrics';
import {runMagicSigningProof} from '../services/signingProof';
import {haptics} from '../services/haptics';
import {loadCoveredRecovery} from '../services/coveredRecovery';

function AccountGroup({title, tint, children}: {title: string; tint: string; children: React.ReactNode}) {
  return <View style={[styles.group, {backgroundColor: tint}]}>
    <Text style={s.subheading}>{title}</Text>
    <View>{children}</View>
  </View>;
}

export function AccountScreen() {
  const navigation = useNavigation<any>(); const {account, home, ownerAddress, mode, signOut, refreshMagicChain} = useApp();
  const [message, setMessage] = useState('');
  const [checkingSigner, setCheckingSigner] = useState(false);
  const [checkingChain, setCheckingChain] = useState(false);
  const [recovery, setRecovery] = useState<{operationId: string; kind: 'activation' | 'withdrawal'} | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true; setRecovery(null);
    if (mode === 'authenticated' && ownerAddress) loadCoveredRecovery(ownerAddress).then(value => {if (active) setRecovery(value);}).catch(() => undefined);
    return () => {active = false;};
  }, [mode, ownerAddress]));
  const unavailable = (name: string) => setMessage(`${name} will appear here when its authenticated mobile endpoint is ready.`);
  async function verifySigner() {
    if (!ownerAddress) return;
    setCheckingSigner(true); setMessage('');
    try {
      if (!await confirmSensitiveAction('Verify this Magic signer without moving funds')) throw new Error('Device confirmation was cancelled. Nothing was signed.');
      const result = await runMagicSigningProof(ownerAddress);
      haptics.confirm(); setMessage(`Magic signer verified for ${result.owner.slice(0, 6)}…${result.owner.slice(-4)}. No funds moved.`);
    } catch (reason) {
      haptics.reject(); setMessage(reason instanceof Error ? reason.message : 'Magic signing verification failed.');
    } finally { setCheckingSigner(false); }
  }
  async function verifyChain() {
    setCheckingChain(true); setMessage('');
    try {
      const result = await refreshMagicChain();
      setMessage(result.delegationState === 'active'
        ? `EIP-7702 delegation observed on finalized Arbitrum block ${result.blockNumber}.`
        : `No active EIP-7702 delegation was observed on finalized Arbitrum block ${result.blockNumber}.`);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Arbitrum wallet verification failed.');
    } finally { setCheckingChain(false); }
  }
  return <Screen>
    <PageHeader kicker="Account" title="Money and safety" copy="Infrequent and sensitive controls are grouped here." />
    {mode === 'preview' ? <Card tint={colors.yellow}><Text style={s.strong}>Preview mode</Text><Text style={s.body}>Local fixture data only. No wallet or backend is connected.</Text></Card> : null}
    {message ? <Notice live title={message.includes('verified') ? 'Signing ready' : 'Account update'} message={message} tone={message.includes('verified') ? 'mint' : 'lilac'} /> : null}
    <AccountGroup title="Wallet and funds" tint={colors.skyTint}>
      <DataRow label="Owner wallet" value={ownerAddress ? `${ownerAddress.slice(0, 6)}…${ownerAddress.slice(-4)}` : 'Loading'} />
      <DataRow label="Universal Account" value={account?.universalAccount ? `${account.universalAccount.slice(0, 6)}…${account.universalAccount.slice(-4)}` : 'Loading'} />
      <DataRow label="Arbitrum delegation" value={account?.delegationState === 'active' ? 'Observed' : 'Setup required'} />
      <DataRow label="Arbitrum check" value={account?.chainVerification === 'finalized'
        ? `Finalized block ${account.chainBlockNumber ?? 'verified'}` : 'Verification needed'} />
      <DataRow label="Trading account" value={home.aiState === 'blocked' ? 'Needs attention' : 'Ready'} />
      <TextLink label="Add funds" onPress={() => navigation.navigate('Funding')} />
      <TextLink label="Withdraw funds" onPress={() => navigation.navigate('Withdraw')} />
      <TextLink label="Covered network fees" onPress={() => navigation.navigate('CoveredFees')} />
      {recovery ? <TextLink label="Check pending wallet operation" onPress={() => navigation.navigate('CoveredReview', recovery)} /> : null}
      {mode === 'authenticated' ? <View style={styles.groupAction}><Button label="Verify Arbitrum wallet" variant="secondary" loading={checkingChain} onPress={verifyChain} /></View> : null}
    </AccountGroup>
    {account?.delegationState === 'required' ? <Notice title="Secure your AI trader" message={account.chainVerification === 'unavailable'
      ? 'Arbitrum verification was unavailable. Use Verify Arbitrum wallet to try again.'
      : 'The Magic wallet has no observed EIP-7702 delegation on Arbitrum. Verify the wallet before starting Autopilot.'} tone="yellow" /> : null}
    <AccountGroup title="AI trader" tint={colors.mintTint}>
      <DataRow label="Status" value={home.aiState.replaceAll('_', ' ')} />
      <DataRow label="Credits" value={String(home.availableCredits)} />
      <TextLink label="Autopilot limits" onPress={() => navigation.navigate('AgentSettings')} />
      <TextLink label="Moeazi credit packs" onPress={() => navigation.navigate('Credits')} />
    </AccountGroup>
    <AccountGroup title="Preferences" tint={colors.paperAlt}>
      <TextLink label="Notifications" onPress={() => unavailable('Notification preferences')} />
      <TextLink label="Security and biometrics" onPress={() => unavailable('Security settings')} />
      <TextLink label="Advanced models and keys" onPress={() => navigation.navigate('AgentSettings')} />
    </AccountGroup>
    {__DEV__ && mode === 'authenticated' ? <AccountGroup title="Developer signing check" tint={colors.lilacTint}>
      <Text style={s.body}>Confirms that Magic can sign Moeazi data for this account. It cannot submit a trade, activate delegation, or move funds.</Text>
      <View style={styles.groupAction}><Button label="Verify Magic signer" variant="secondary" loading={checkingSigner} onPress={verifySigner} /></View>
    </AccountGroup> : null}
    <Panel tone="rose"><Text style={s.subheading}>Danger zone</Text><Text style={s.body}>Emergency Stop blocks all new AI trading activity and requires explicit review before restarting.</Text><Button label="Review Emergency Stop" variant="danger" onPress={() => navigation.navigate('Safety')} /></Panel>
    <Button label="Sign out on this device" variant="secondary" onPress={signOut} />
  </Screen>;
}

const styles = StyleSheet.create({
  group: {
    borderWidth: border.quiet,
    borderColor: colors.ink,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  groupAction: {paddingTop: spacing.sm},
});
