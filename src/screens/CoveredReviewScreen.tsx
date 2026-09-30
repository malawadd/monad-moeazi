import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, Linking, Pressable, StyleSheet, Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, DataRow, FlowScreen, Notice, PageHeader, Panel, TextLink} from '../components/Ui';
import type {ActivationReview, SignedAuthorization, SponsoredOperation, SponsoredStatus} from '../types/connectors';
import {validateActivation, validateSponsored, normalizeMagicAuthorization} from '../services/sponsoredValidation';
import {verifyDeviceSecurity} from '../services/deviceSecurity';
import {magicWallet} from '../services/wallet/MagicWalletAdapter';
import {connectorsApi} from '../services/connectorsApi';
import {setSensitiveScreen} from '../services/screenSecurity';
import {useApp} from '../state/AppContext';
import {haptics} from '../services/haptics';
import {screenStyles as s} from '../theme/screenStyles';
import {saveCoveredRecovery, clearCoveredRecovery} from '../services/coveredRecovery';

export function CoveredReviewScreen() {
  const route = useRoute<any>(), navigation = useNavigation<any>(), {ownerAddress, refreshHome, mode} = useApp();
  const activation = route.params?.activation as ActivationReview | undefined;
  const expected = route.params?.expected;
  const [prepared, setPrepared] = useState<SponsoredOperation | null>(route.params?.prepared ?? null);
  const [status, setStatus] = useState<SponsoredStatus | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [expired, setExpired] = useState(false);
  const [contractAccepted, setContractAccepted] = useState(false);
  const authorization = useRef<SignedAuthorization | undefined>(undefined), submitting = useRef(false), securityOpen = useRef(false);
  const invalidated = useRef(false), sending = useRef(false);
  useEffect(() => {setSensitiveScreen(true); return () => setSensitiveScreen(false);}, []);
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {if (next !== 'active' && !securityOpen.current && !submitting.current) {invalidated.current = true; setExpired(true); authorization.current = undefined;}});
    return () => listener.remove();
  }, []);
  const kind = prepared?.intent.kind ?? route.params?.kind ?? 'activation';
  const checkStatus = useCallback(async () => {
    const id = prepared?.operationId ?? route.params?.operationId;
    if (!id || mode === 'preview') return;
    try {const next = await connectorsApi.status(route.params?.kind ?? kind, id); setStatus(next); if (['completed', 'failed', 'cancelled', 'expired'].includes(next.status) && ownerAddress) await clearCoveredRecovery(ownerAddress); if (next.status === 'completed') {haptics.confirm(); await refreshHome();}}
    catch {setMessage('Connection interrupted. Moeazi is still checking this operation; it will not resend it.');}
  }, [kind, mode, ownerAddress, prepared?.operationId, refreshHome, route.params?.kind, route.params?.operationId]);
  const statusName = status?.status;
  useEffect(() => {
    if (!statusName && !route.params?.operationId) return;
    if (statusName && ['completed', 'failed', 'cancelled', 'expired'].includes(statusName)) return;
    const started = Date.now(); checkStatus().catch(() => undefined);
    const timer = setInterval(() => {if (Date.now() - started > 120000) clearInterval(timer); else if (AppState.currentState === 'active') checkStatus().catch(() => undefined);}, 5000);
    return () => clearInterval(timer);
  }, [checkStatus, route.params?.operationId, statusName]);
  async function verify() {
    if (mode !== 'authenticated' || !ownerAddress || invalidated.current || submitting.current || sending.current) return;
    sending.current = true;
    setBusy(true); setMessage('');
    try {
      if (!expected || ownerAddress.toLowerCase() !== expected.owner.toLowerCase()) throw new Error('Your account changed. Review the operation again.');
      if (prepared) validateSponsored(prepared, expected); else validateActivation(activation!, ownerAddress);
      if (prepared?.withdrawal?.destinationKind === 'contract' && !contractAccepted) throw new Error('Confirm that the destination supports Arbitrum USDC.');
      securityOpen.current = true;
      let confirmed: boolean;
      try {confirmed = await verifyDeviceSecurity(prepared ? 'Approve the exact operation you reviewed' : 'Enable covered network fees without granting AI trading authority');} finally {securityOpen.current = false;}
      if (!confirmed) {haptics.reject(); setMessage('Device confirmation was cancelled. Nothing was submitted.'); return;}
      const identity = await magicWallet.restoreIdentity();
      if (!identity || identity.address.toLowerCase() !== expected.owner.toLowerCase()) throw new Error('The Magic wallet changed. Sign in and review again.');
      if (!prepared) {
        validateActivation(activation!, ownerAddress);
        const signed = normalizeMagicAuthorization(await magicWallet.signEip7702Authorization(activation!.authorization), activation!.authorization);
        if (invalidated.current) throw new Error('Wallet signing was interrupted. Review again.');
        authorization.current = signed;
        const next = await connectorsApi.authorize(activation!.operationId, signed);
        validateSponsored(next, expected); setPrepared(next); haptics.confirm(); setMessage('Review the final covered operation below before signing. No transaction has been submitted.'); return;
      }
      validateSponsored(prepared, expected);
      const signature = await magicWallet.signRootHash(prepared.userOperationHash, prepared.owner);
      if (AppState.currentState !== 'active' || invalidated.current) throw new Error('Signing was interrupted. Review again before submission.');
      validateSponsored(prepared, expected);
      await saveCoveredRecovery(ownerAddress, prepared.operationId, kind);
      submitting.current = true;
      try {await connectorsApi.submit(prepared, signature, authorization.current); setStatus({schemaVersion: '2026-09-29', operationId: prepared.operationId, kind, status: 'checking', updatedAt: Date.now()}); haptics.confirm();}
      catch {setStatus({schemaVersion: '2026-09-29', operationId: prepared.operationId, kind, status: 'uncertain', updatedAt: Date.now()}); setMessage('Checking Arbitrum. The operation will not be sent again automatically.');}
      finally {authorization.current = undefined;}
    } catch (reason) {haptics.reject(); setMessage(reason instanceof Error ? reason.message : 'The operation could not continue.');}
    finally {sending.current = false; setBusy(false);}
  }
  const withdrawal = prepared?.withdrawal ?? status?.withdrawal;
  return <FlowScreen><PageHeader kicker="Review" title={status?.status === 'completed' ? kind === 'withdrawal' ? 'USDC sent' : 'Wallet setup complete' : withdrawal ? 'Check every detail' : 'Enable covered fees'} />
    {message ? <Notice live tone="orange" title="Operation update" message={message} /> : null}
    {expired && !status ? <Notice tone="orange" title="Review interrupted" message="Return and prepare a fresh operation. Nothing will be submitted from this review." /> : null}
    <Panel tone={status?.status === 'completed' ? 'mint' : 'lilac'}>
      <Text style={s.subheading}>{withdrawal ? `${withdrawal.amount} USDC` : 'Your wallet stays yours'}</Text>
      <Text style={s.body}>{withdrawal ? 'USDC on Arbitrum. Transfers cannot be reversed after submission.' : 'This changes wallet execution capabilities. It does not grant AI trading authority, transfer custody, or move your funds.'}</Text>
    </Panel>
    {withdrawal ? <><DataRow label="Full recipient" value={withdrawal.destination} /><DataRow label="Expected remaining USDC" value={withdrawal.remainingAmount} /><DataRow label="Destination" value={withdrawal.destinationKind} /></> : null}
    {prepared ? <DataRow label="Network fee" value="Covered by Moeazi · no ETH charge" /> : activation ? <DataRow label="Network fee" value="Coverage verified before final signing" /> : null}
    {withdrawal?.destinationKind === 'contract' && !status ? <Pressable accessibilityRole="checkbox" accessibilityState={{checked: contractAccepted}} onPress={() => setContractAccepted(value => !value)} style={styles.confirmation}><Text style={s.strong}>{contractAccepted ? 'CONFIRMED' : 'CONFIRM'} · This contract supports Arbitrum USDC.</Text></Pressable> : null}
    {status || route.params?.operationId ? <><Notice live tone={status?.status === 'completed' ? 'mint' : 'sky'} title={status?.status.replaceAll('_', ' ') ?? 'Checking Arbitrum'} message="Completion requires verified on-chain evidence, not just a provider response." /><Button label="Check status" variant="secondary" onPress={() => {checkStatus().catch(() => undefined);}} />{status?.transactionHash ? <TextLink label="View on Arbiscan" onPress={() => {Linking.openURL(`https://arbiscan.io/tx/${status.transactionHash}`).catch(() => undefined);}} /> : null}</> : <Button label={prepared ? 'Verify and send' : 'Verify wallet setup'} loading={busy} disabled={expired || !prepared && !activation || withdrawal?.destinationKind === 'contract' && !contractAccepted} onPress={() => {verify().catch(() => undefined);}} />}
    <TextLink label="Return to Account" onPress={() => navigation.navigate('Main', {screen: 'Account'})} />
  </FlowScreen>;
}
const styles = StyleSheet.create({confirmation: {minHeight: 56, padding: 12, borderWidth: 2}});
