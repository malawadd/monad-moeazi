import React, {useEffect, useRef, useState} from 'react';
import {AppState, Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, DataRow, FlowScreen, Notice, PageHeader, Panel, StepRow} from '../components/Ui';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {confirmSensitiveAction} from '../services/biometrics';
import {magicWallet} from '../services/wallet/MagicWalletAdapter';
import {formatEthWei, validatePreparedWithdrawal} from '../services/withdrawalPresentation';
import {mobileApi} from '../services/apiClient';
import {PreparedWithdrawal, WithdrawalStatus} from '../types/withdrawal';
import {haptics} from '../services/haptics';
import {useApp} from '../state/AppContext';
import {setSensitiveScreen} from '../services/screenSecurity';

type Stage = 'review' | 'verifying' | 'submitting' | 'confirming' | 'completed' | 'failed' | 'cancelled' | 'uncertain';
const terminal = new Set<Stage>(['completed', 'failed', 'cancelled']);

function shortAddress(value: string) { return `${value.slice(0, 8)}…${value.slice(-6)}`; }
function statusStage(status: WithdrawalStatus['status']): Stage {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'expired' || status === 'needs_attention') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'uncertain') return 'uncertain';
  return 'confirming';
}

export function WithdrawalReviewScreen() {
  const route = useRoute<any>(); const navigation = useNavigation<any>();
  const {refreshHome, refreshActivity} = useApp();
  const prepared = route.params?.prepared as PreparedWithdrawal;
  const expected = route.params?.expected as {owner: string; amount: string; destination: string; idempotencyKey: string};
  const preview = Boolean(route.params?.preview);
  const [stage, setStage] = useState<Stage>('review');
  const [contractAccepted, setContractAccepted] = useState(prepared.destinationKind !== 'contract');
  const [reviewExpired, setReviewExpired] = useState(false);
  const [status, setStatus] = useState<WithdrawalStatus | null>(null);
  const [message, setMessage] = useState('');
  const mounted = useRef(true);

  useEffect(() => () => {mounted.current = false;}, []);
  useEffect(() => {setSensitiveScreen(true); return () => setSensitiveScreen(false);}, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active' && stage === 'review') setReviewExpired(true);
    });
    return () => subscription.remove();
  }, [stage]);
  useEffect(() => navigation.addListener('beforeRemove', (event: any) => {
    if (stage !== 'submitting') return;
    event.preventDefault(); setMessage('Wait for Magic to finish submitting before leaving this screen.');
  }), [navigation, stage]);

  async function poll(operationId: string) {
    const startedAt = Date.now();
    while (mounted.current && Date.now() - startedAt < 120_000) {
      await new Promise<void>(resolve => setTimeout(() => resolve(), 3000));
      try {
        const next = await mobileApi.withdrawalStatus(operationId);
        if (!mounted.current) return;
        setStatus(next); setStage(statusStage(next.status));
        if (next.status === 'completed') {
          haptics.confirm(); await Promise.all([refreshHome(), refreshActivity()]); return;
        }
        if (['failed', 'cancelled', 'expired', 'needs_attention'].includes(next.status)) {haptics.reject(); return;}
      } catch { setMessage('Moeazi is still checking Arbitrum. You can leave and review the result in Activity.'); }
    }
    if (mounted.current) {setStage('uncertain'); setMessage('Confirmation is taking longer than usual. Moeazi will not send the transaction again.');}
  }

  async function report(outcome: 'submitted' | 'cancelled' | 'uncertain', transactionHash?: string) {
    const next = await mobileApi.reportWithdrawalBroadcast({operationId: prepared.operationId, outcome, transactionHash});
    setStatus(next); return next;
  }

  async function verifyAndSend() {
    setMessage('');
    try {
      if (reviewExpired) throw new Error('This review was interrupted. Prepare the withdrawal again before sending.');
      validatePreparedWithdrawal(prepared, expected);
      if (prepared.destinationKind === 'contract' && !contractAccepted) throw new Error('Confirm that this contract accepts Arbitrum USDC.');
      if (preview) {
        setStage('completed'); setMessage('Preview complete. No wallet was opened and no funds moved.'); haptics.confirm(); return;
      }
      setStage('verifying');
      const confirmed = await confirmSensitiveAction(`Send ${prepared.amount} USDC to ${shortAddress(prepared.destination)}`);
      if (!confirmed) {
        await report('cancelled').catch(() => undefined); setStage('cancelled'); setMessage('Device confirmation was cancelled. Nothing was sent.'); haptics.reject(); return;
      }
      const identity = await magicWallet.restoreIdentity();
      if (!identity || identity.address.toLowerCase() !== prepared.owner.toLowerCase()) throw new Error('The current Magic wallet no longer matches this withdrawal.');
      validatePreparedWithdrawal(prepared, expected);
      setStage('submitting');
      try {
        const transactionHash = await magicWallet.sendPreparedTransaction(prepared.transaction);
        await report('submitted', transactionHash);
        setStage('confirming'); setMessage('The transfer was submitted. Moeazi is checking the exact Arbitrum receipt.');
        await poll(prepared.operationId);
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : String(reason);
        const cancelled = /cancel|reject|denied/i.test(detail);
        if (cancelled) {
          await report('cancelled').catch(() => undefined); setStage('cancelled'); setMessage('Magic confirmation was cancelled. Nothing was sent.');
        } else {
          await report('uncertain').catch(() => undefined); setStage('uncertain');
          setMessage('Magic did not return a clear result. Moeazi is checking Arbitrum and will not send again.');
          await poll(prepared.operationId);
        }
        haptics.reject();
      }
    } catch (reason) {setStage('failed'); setMessage(reason instanceof Error ? reason.message : 'The withdrawal could not continue.'); haptics.reject();}
  }

  const actionLabel = stage === 'verifying' ? 'Waiting for device security…' : stage === 'submitting' ? 'Submitting with Magic…' : 'Verify and send';
  const busy = ['verifying', 'submitting', 'confirming'].includes(stage);
  const txHash = status?.transactionHash;

  return <FlowScreen>
    <PageHeader kicker="Review" title={stage === 'completed' ? 'USDC sent' : 'Check every detail'} copy={stage === 'review' ? 'Transfers cannot be reversed after they are broadcast.' : undefined} />
    {message ? <Notice live tone={stage === 'completed' ? 'mint' : stage === 'confirming' ? 'sky' : 'orange'} title={stage === 'completed' ? 'Complete' : stage === 'cancelled' ? 'Cancelled' : stage === 'failed' ? 'Could not continue' : 'Withdrawal update'} message={message} /> : null}
    <Panel tone={stage === 'completed' ? 'mint' : 'lilac'} bodyStyle={styles.heroBody}>
      <Text style={s.meta}>{stage === 'completed' ? 'Sent' : 'You are sending'}</Text>
      <Text accessibilityLabel={`${prepared.amount} USDC`} style={styles.amount}>{prepared.amount} USDC</Text>
      <Text style={styles.to}>TO {shortAddress(prepared.destination)}</Text>
    </Panel>
    {stage === 'review' || stage === 'failed' ? <View style={styles.details}>
      <DataRow label="Asset and network" value="USDC on Arbitrum" />
      <View style={styles.addressBlock}><Text style={s.body}>Recipient</Text><Text selectable style={styles.address}>{prepared.destination}</Text></View>
      <DataRow label="Maximum estimated fee" value={`${formatEthWei(prepared.estimatedFeeWei)} ETH`} />
      <DataRow label="USDC left after sending" value={`${prepared.remainingAmount} USDC`} />
      <DataRow label="Destination type" value={prepared.destinationKind === 'contract' ? 'Contract' : 'Wallet'} />
    </View> : <View style={styles.progress}>
      <StepRow number="01" title="Prepared and reviewed" complete />
      <StepRow number="02" title="Verified on this device" active={stage === 'verifying'} complete={['submitting', 'confirming', 'completed'].includes(stage)} />
      <StepRow number="03" title="Submitted with Magic" active={stage === 'submitting'} complete={['confirming', 'completed'].includes(stage)} />
      <StepRow number="04" title="Confirmed on Arbitrum" active={stage === 'confirming' || stage === 'uncertain'} complete={stage === 'completed'} />
    </View>}
    {prepared.destinationKind === 'contract' && (stage === 'review' || stage === 'failed') ? <Pressable accessibilityRole="checkbox" accessibilityState={{checked: contractAccepted}} onPress={() => setContractAccepted(value => !value)} style={styles.contractCheck}><View style={[styles.checkBox, contractAccepted && styles.checkBoxActive]}><Text style={styles.checkMark}>{contractAccepted ? 'YES' : ''}</Text></View><Text style={styles.checkCopy}>I confirmed this contract accepts canonical USDC on Arbitrum.</Text></Pressable> : null}
    {stage === 'review' || stage === 'failed' ? <>
      <Notice tone="rose" title="Final check" message="Confirm the amount and full address. Sending to the wrong wallet or network may not be recoverable." />
      <Button label={reviewExpired ? 'Review again' : actionLabel} variant="danger" size="hero" disabled={busy || (prepared.destinationKind === 'contract' && !contractAccepted)} loading={busy} onPress={reviewExpired ? () => navigation.goBack() : () => {verifyAndSend().catch(() => undefined);}} />
    </> : null}
    {txHash ? <Button label="View on Arbiscan" variant="secondary" onPress={() => {Linking.openURL(`https://arbiscan.io/tx/${txHash}`).catch(() => undefined);}} /> : null}
    {terminal.has(stage) ? <Button label="Done" variant="secondary" onPress={() => navigation.navigate('Main', {screen: 'Account'})} /> : null}
  </FlowScreen>;
}

const styles = StyleSheet.create({
  heroBody: {padding: spacing.sm, gap: spacing.xs}, amount: {...type.display, color: colors.ink, fontSize: 38, lineHeight: 44}, to: {...type.meta, color: colors.muted, fontSize: 11},
  details: {borderTopWidth: 2, borderColor: colors.ink}, addressBlock: {paddingVertical: 11, borderBottomWidth: 2, borderColor: colors.ink, gap: 6}, address: {...type.meta, color: colors.ink, fontSize: 13, lineHeight: 20},
  progress: {borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paperAlt, paddingHorizontal: spacing.sm},
  contractCheck: {minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.orangeTint, padding: spacing.sm}, checkBox: {width: 42, height: 42, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper}, checkBoxActive: {backgroundColor: colors.mint}, checkMark: {...type.meta, color: colors.ink, fontSize: 9}, checkCopy: {...type.body, color: colors.ink, flex: 1, fontSize: 14, lineHeight: 20},
});
