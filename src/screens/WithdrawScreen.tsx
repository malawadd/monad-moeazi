import React, {useCallback, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Field, FlowScreen, LoadingBlock, Notice, PageHeader, Panel, TextLink} from '../components/Ui';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {useApp} from '../state/AppContext';
import {mobileApi, MobileApiError} from '../services/apiClient';
import {scanPaymentQr} from '../services/qrScanner';
import {managedWithdrawalBlocker, parsePaymentQr, validateWithdrawalInput} from '../services/withdrawalPresentation';
import {FundingSnapshot} from '../types/mobile';
import {PreparedWithdrawal, WITHDRAWAL_USDC_ADDRESS} from '../types/withdrawal';
import {haptics} from '../services/haptics';
import {connectorsApi} from '../services/connectorsApi';
import type {GasReadiness} from '../types/connectors';
import type {ManagedCloseResult} from '../types/mobile';
import {getOrCreateManagedCloseKey, clearManagedCloseKey} from '../services/managedCloseRecovery';
import {managedCloseButtonLabel, managedCloseStatusMessage, managedCloseStatusTitle, managedPositionAction} from '../services/managedClosePresentation';
import {sendManagedVaultReturn} from '../services/managedVaultReturn';
import {ManagedVaultReleaseControl} from './ManagedVaultReleaseControl';
import {markVaultReturnAttempted, readManagedVaultReturn} from '../services/managedVaultReturnRecovery';

type VaultRelease = Awaited<ReturnType<typeof mobileApi.managedVaultRelease>>;

function previewFunding(owner: string): FundingSnapshot {
  return {schemaVersion: '2026-09-01', ownerAddress: owner, depositAddress: owner, universalAccount: owner,
    network: 'Arbitrum', chainId: 42161, status: 'available', stale: false,
    tradingAsset: {symbol: 'USDC', amount: '500', amountUsd: '500', contractAddress: WITHDRAWAL_USDC_ADDRESS, decimals: 6},
    feeAsset: {symbol: 'ETH', amount: '0.0012', decimals: 18}, observedBlock: 390000000, observedAt: new Date().toISOString()};
}

function previewPrepared(owner: string, amount: string, destination: string, idempotencyKey: string): PreparedWithdrawal {
  const [whole, fraction = ''] = amount.split('.');
  const raw = (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0')).toString();
  const data = `0xa9059cbb${destination.toLowerCase().slice(2).padStart(64, '0')}${BigInt(raw).toString(16).padStart(64, '0')}`;
  return {schemaVersion: '2026-09-14', operationId: `preview-${Date.now()}`, idempotencyKey, owner,
    chainId: 42161, network: 'Arbitrum', asset: {symbol: 'USDC', contractAddress: WITHDRAWAL_USDC_ADDRESS, decimals: 6},
    amount, amountRaw: raw, destination, destinationKind: 'wallet', remainingAmount: String(500 - Number(amount)),
    estimatedFeeWei: '14000000000000', observedBlock: 390000000, expiresAt: Date.now() + 300000,
    preparedHash: `0x${'1'.repeat(64)}`, transaction: {from: owner, to: WITHDRAWAL_USDC_ADDRESS,
      data, value: '0x0', gas: '0x186a0', maxFeePerGas: '0x3b9aca00', nonce: '0x0'}};
}

export function WithdrawScreen() {
  const navigation = useNavigation<any>();
  const {mode, ownerAddress, home, stopAutopilot, refreshHome} = useApp();
  const [funding, setFunding] = useState<FundingSnapshot | null>(null);
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [suggested, setSuggested] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pausePrompt, setPausePrompt] = useState(false);
  const [closeResult, setCloseResult] = useState<ManagedCloseResult | null>(null);
  const [gas, setGas] = useState<GasReadiness | null>(null);
  const [vaultRelease, setVaultRelease] = useState<VaultRelease | null>(null);
  const [releaseSent, setReleaseSent] = useState(false);
  const requestId = useRef<string | null>(null);

  const refreshVaultRelease = useCallback(async () => {
    const {release, sent, funding: refreshed} = await readManagedVaultReturn();
    setVaultRelease(release); setReleaseSent(sent);
    if (refreshed) setFunding(refreshed);
    return release;
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    setPausePrompt(false);
    if (mode !== 'preview') connectorsApi.gas().then(value => {if (active) setGas(value);}).catch(() => {if (active) setGas({schemaVersion: '2026-09-29', available: false, activated: false, requiresActivation: false, reason: 'Fee coverage could not be checked.'});});
    if (mode === 'preview') setFunding(previewFunding(ownerAddress ?? `0x${'1'.repeat(40)}`));
    else mobileApi.funding().then(value => {if (active) setFunding(value);}).catch(reason => {if (active) setError(reason.message);})
      .finally(() => mobileApi.refreshFunding().then(value => {if (active) setFunding(value);}).catch(() => undefined));
    if (mode === 'authenticated' && home.assignmentId) {
      refreshVaultRelease().catch(reason => {if (active) setError(reason instanceof Error ? reason.message : 'Managed capital could not be checked.');});
    } else setVaultRelease({status: 'not_applicable'});
    return () => {active = false;};
  }, [mode, ownerAddress, home.assignmentId, refreshVaultRelease]));

  const formChanged = (setter: (value: string) => void, value: string) => {
    setter(value); requestId.current = null; setError('');
  };
  const managedClosureBlocked = mode !== 'preview' && Boolean(home.assignmentId)
    && home.managedPositionClosureUnconfirmed !== false;
  const vaultReleaseBlocked = mode === 'authenticated' && Boolean(home.assignmentId)
    && vaultRelease?.status !== 'not_applicable' && vaultRelease?.status !== 'released';
  const managedAction = managedPositionAction(home);
  const paste = async () => {
    const value = (await Clipboard.getString()).trim();
    formChanged(setDestination, value); setSuggested(false); haptics.selection();
  };
  const scan = async () => {
    setError('');
    try {
      const parsed = parsePaymentQr(await scanPaymentQr());
      formChanged(setDestination, parsed.destination);
      if (parsed.suggestedAmount) setAmount(parsed.suggestedAmount);
      setSuggested(Boolean(parsed.suggestedAmount)); haptics.confirm();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The QR code could not be read.';
      if (!message.toLowerCase().includes('cancel')) {setError(message); haptics.reject();}
    }
  };
  const prepare = async () => {
    if (!funding || !ownerAddress) return;
    const managedBlocker = mode === 'preview' ? null : managedWithdrawalBlocker(home);
    if (managedBlocker) {
      if (home.primaryAction === 'stop') setPausePrompt(true);
      else setError(managedBlocker);
      return;
    }
    if (vaultReleaseBlocked) {
      setError('Return settled USDC from the managed vault to Magic before preparing this withdrawal.');
      return;
    }
    const validation = validateWithdrawalInput(amount, destination, funding.tradingAsset.amount);
    if (validation) {setError(validation); haptics.reject(); return;}
    setBusy(true); setError('');
    try {
      const latest = mode === 'preview' ? funding : await mobileApi.refreshFunding();
      setFunding(latest);
      const freshValidation = validateWithdrawalInput(amount, destination, latest.tradingAsset.amount);
      if (freshValidation) throw new Error(freshValidation);
      const id = requestId.current ?? `withdrawal-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
      requestId.current = id;
      if (mode === 'preview') {
        navigation.navigate('WithdrawalReview', {prepared: previewPrepared(ownerAddress, amount, destination, id), expected: {owner: ownerAddress, amount, destination, idempotencyKey: id}, preview: true});
      } else {
        const readiness = await connectorsApi.gas(); setGas(readiness);
        if (!readiness.available || !readiness.activated) throw new Error(readiness.reason ?? 'Enable covered network fees before sending.');
        const prepared = await connectorsApi.withdrawal(amount, destination, id);
        navigation.navigate('CoveredReview', {prepared, expected: {owner: ownerAddress, kind: 'withdrawal', amount, destination, idempotencyKey: id}});
      }
    } catch (reason) {if (reason instanceof Error && /unsigned review expired/i.test(reason.message)) requestId.current = null; setError(reason instanceof Error ? reason.message : 'The withdrawal could not be prepared.'); haptics.reject();}
    finally {setBusy(false);}
  };
  const pauseAndPrepare = async () => {
    setBusy(true); setError('');
    try {
      const result = await stopAutopilot();
      setPausePrompt(false);
      if (!result?.stopState?.assignmentPaused) throw new Error('The managed assignment pause could not be verified. No withdrawal was prepared.');
      setCloseResult(null);
      setError(result.stopState.nativeFinanceAdmissionStopped
        ? '' : 'The assignment is paused, but native finance admission stop is still pending. Position closure remains unconfirmed.');
    }
    catch (reason) {setError(reason instanceof Error ? reason.message : 'The AI trader could not be paused. No withdrawal was prepared.');}
    finally {setBusy(false);}
  };
  const closeManagedPosition = async () => {
    const assignmentId = home.assignmentId;
    if (mode !== 'authenticated' || !ownerAddress || !assignmentId
        || home.assignmentState !== 'paused' || home.managedPositionClosureUnconfirmed !== true) {
      setError('Stop new entries first and refresh the exact paused assignment before closing. Withdrawal remains blocked.');
      return;
    }
    setBusy(true); setError('');
    let idempotencyKey: string | null = null;
    try {
      idempotencyKey = await getOrCreateManagedCloseKey(ownerAddress, assignmentId);
      const result = await mobileApi.closeManagedPosition(assignmentId, idempotencyKey);
      setCloseResult(result);
      if (result.status === 'confirmed_flat' && result.positionClosure === 'confirmed_flat') {
        const latest = await refreshHome();
        if (latest?.assignmentId !== assignmentId) {
          setCloseResult({status: 'blocked', code: 'CLOSE_ASSIGNMENT_CHANGED',
            message: 'The managed assignment changed before the refreshed account status arrived.',
            positionClosure: 'unconfirmed'});
          setError('Review the current managed assignment before withdrawing.');
        } else if (latest.assignmentState === 'paused' && latest.managedPositionClosureUnconfirmed === false) {
          await clearManagedCloseKey(ownerAddress, assignmentId, idempotencyKey);
          await refreshVaultRelease();
          haptics.confirm();
        } else {
          setCloseResult({status: 'pending', code: 'CLOSE_PROJECTION_NOT_VISIBLE',
            message: 'Finalized close proof was received. Waiting for the trusted account projection to confirm it.',
            operationId: result.operationId, admissionStopped: true,
            submittedOperationMayStillSettle: false, positionClosure: 'unconfirmed'});
        }
      } else haptics.selection();
    } catch (reason) {
      if (reason instanceof MobileApiError) {
        if (reason.code === 'CLOSE_ASSIGNMENT_MISMATCH' || reason.code === 'CLOSE_ASSIGNMENT_CHANGED') {
          const latest = await refreshHome().catch(() => undefined);
          if (latest?.assignmentId !== assignmentId) {
            setCloseResult(null);
            setError('The managed assignment changed. Account status was refreshed; check its current close state before continuing.');
            return;
          }
        }
        if (reason.code === 'CLOSE_NOT_REQUIRED') {
          const latest = await refreshHome().catch(() => undefined);
          if (latest?.assignmentId === assignmentId && latest.managedPositionClosureUnconfirmed === false) {
            if (idempotencyKey) await clearManagedCloseKey(ownerAddress, assignmentId, idempotencyKey);
            setCloseResult(null); setError(''); return;
          }
        }
        const body = reason.body && typeof reason.body === 'object' ? reason.body as Record<string, unknown> : {};
        if (body.status === 'blocked' && typeof body.code === 'string') {
          setCloseResult({status: 'blocked', code: body.code,
            message: typeof body.error === 'string' ? body.error : reason.message,
            positionClosure: body.positionClosure === 'confirmed_flat' ? 'confirmed_flat' : 'unconfirmed',
            submittedOperationMayStillSettle: body.submittedOperationMayStillSettle === true,
            ...(typeof body.operationId === 'string' ? {operationId: body.operationId} : {})});
          setError(''); haptics.reject(); return;
        }
      }
      setError(reason instanceof Error ? reason.message : 'The managed close could not be confirmed. Withdrawal remains blocked.');
      haptics.reject();
    } finally {setBusy(false);}
  };

  const returnVaultUsdc = async () => {
    if (!ownerAddress || vaultRelease?.status !== 'ready' || !vaultRelease.transaction
        || releaseSent) return;
    setBusy(true); setError('');
    try {
      const fresh = await refreshVaultRelease();
      if (await sendManagedVaultReturn(fresh, ownerAddress, async () => {
        await markVaultReturnAttempted(ownerAddress, fresh.vaultAddress!);
        setReleaseSent(true);
      })) {
        setError('Magic submitted the vault return. Check finalized status before withdrawing.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The vault return is uncertain. Check finalized status before retrying.');
    } finally {setBusy(false);}
  };

  return <FlowScreen>
    <PageHeader kicker="Money" title="Withdraw USDC" copy="Send your USDC to another wallet on Arbitrum." />
    {error ? <Notice live tone="rose" title="Check the withdrawal" message={error} /> : null}
    {closeResult?.status === 'confirmed_flat' && closeResult.positionClosure === 'confirmed_flat'
        && home.managedPositionClosureUnconfirmed === false
      ? <Notice live tone="mint" title="Position closure confirmed" message="The trusted account projection confirms a flat position. Return any vault USDC to Magic before the wallet withdrawal." /> : null}
    {!funding ? <LoadingBlock label="Loading available balance" lines={3} /> : <>
      <Panel tone="lilac" bodyStyle={styles.heroBody}>
        <Text style={s.meta}>Available to send</Text>
        <Text accessibilityLabel={`${funding.tradingAsset.amount} USDC available`} style={styles.balance}>{funding.tradingAsset.amount} USDC</Text>
        <Text style={s.body}>USDC · Arbitrum</Text>
      </Panel>
      <View style={styles.formSection}>
        <View style={styles.labelRow}><Text style={styles.label}>Amount</Text><Pressable accessibilityRole="button" onPress={() => formChanged(setAmount, funding.tradingAsset.amount)} style={styles.miniAction}><Text style={styles.miniText}>MAX</Text></Pressable></View>
        <Field label="USDC amount" accessibilityLabel="USDC amount" value={amount} onChangeText={value => formChanged(setAmount, value.replace(',', '.'))} keyboardType="decimal-pad" placeholder="0.00" style={styles.amountInput} />
      </View>
      <View style={styles.formSection}>
        <Field label="Recipient wallet" accessibilityLabel="Recipient wallet address" value={destination} onChangeText={value => {formChanged(setDestination, value); setSuggested(false);}} autoCapitalize="none" autoCorrect={false} placeholder="0x…" />
        {suggested ? <Text style={styles.suggested}>AMOUNT SUGGESTED BY QR · REVIEW CAREFULLY</Text> : null}
        <View style={styles.actionPair}>
          <Pressable accessibilityRole="button" onPress={() => {paste().catch(() => undefined);}} style={({pressed}) => [styles.smallButton, pressed && styles.smallPressed]}><Text style={styles.smallButtonText}>PASTE ADDRESS</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => {scan().catch(() => undefined);}} style={({pressed}) => [styles.smallButton, styles.scanButton, pressed && styles.smallPressed]}><Text style={styles.smallButtonText}>SCAN QR</Text></Pressable>
        </View>
      </View>
      <View style={styles.feeRow}><View style={styles.feeCopy}><Text style={s.strong}>Network fee</Text><Text style={s.body}>{mode === 'preview' ? 'Preview only · no funds move' : gas?.available && gas.activated ? 'Coverage checked at review · no ETH charge' : gas?.reason ?? 'Checking fee coverage…'}</Text></View></View>
      {mode !== 'preview' && gas?.requiresActivation ? <TextLink label="Enable covered network fees" onPress={() => navigation.navigate('CoveredFees')} /> : null}
      <ManagedVaultReleaseControl release={vaultRelease} sent={releaseSent} busy={busy}
        onSend={() => {returnVaultUsdc().catch(() => undefined);}}
        onRefresh={() => {refreshVaultRelease().catch(() => undefined);}} />
      {pausePrompt ? <View style={styles.pauseBox}><Text style={s.subheading}>Stop new entries first</Text><Text style={s.body}>Stop blocks new managed entries and may retain the verified exit grant until expiry. It does not close a position or confirm that submitted operations settled.</Text><Button label="Stop new entries" loading={busy} onPress={() => {pauseAndPrepare().catch(() => undefined);}} /></View>
        : managedClosureBlocked
          ? <View style={styles.closeSection}>
              <Notice live tone="orange" title={managedAction === 'stop' ? 'Stop entries before closing' : 'Close and settle before withdrawing'} message={home.managedPositionClosureUnconfirmed === true
                ? managedAction === 'stop'
                  ? 'Managed entries may still be scheduled. Stop them first; Stop does not close exposure or settle submitted operations.'
                  : 'New entries are blocked. Native close and settlement have not confirmed a flat position, so no withdrawal review can be prepared.'
                : 'Managed position closure status is unavailable. Withdrawal review stays blocked until native close reconciliation can be verified.'} />
              {closeResult ? <View accessibilityLiveRegion="polite" style={styles.closeStatus}>
                <Text style={s.subheading}>{managedCloseStatusTitle(closeResult)}</Text>
                <Text style={s.body}>{managedCloseStatusMessage(closeResult)}</Text>
                <Text style={s.meta}>STATUS · {closeResult.status.replaceAll('_', ' ').toUpperCase()} · {closeResult.code}</Text>
                {closeResult.operationId ? <Text style={s.meta}>CLOSE OPERATION · {closeResult.operationId}</Text> : null}
                {closeResult.exitGrant?.expiresAt ? <Text style={s.meta}>OWNER-APPROVED EXIT GRANT EXPIRES · {new Date(closeResult.exitGrant.expiresAt * 1000).toLocaleString()}</Text> : null}
              </View> : null}
              {managedAction === 'stop'
                ? <Button label="Stop new entries" loading={busy} onPress={() => {pauseAndPrepare().catch(() => undefined);}} />
                : managedAction === 'close'
                ? <Button label={managedCloseButtonLabel(closeResult)} loading={busy} onPress={() => {closeManagedPosition().catch(() => undefined);}} />
                : null}
            </View>
          : <Button label={vaultReleaseBlocked ? 'Return managed USDC first' : 'Review withdrawal'} size="hero" loading={busy}
            disabled={vaultReleaseBlocked || !amount || !destination || mode !== 'preview' && (!gas?.available || !gas.activated)}
            onPress={() => {prepare().catch(() => undefined);}} />}
    </>}
  </FlowScreen>;
}

const styles = StyleSheet.create({
  heroBody: {padding: spacing.sm, gap: spacing.xs}, balance: {...type.display, color: colors.ink, fontSize: 34, lineHeight: 40},
  formSection: {gap: spacing.sm, borderTopWidth: 2, borderColor: colors.ink, paddingTop: spacing.sm},
  labelRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, label: {...type.body, fontWeight: '800', color: colors.ink},
  miniAction: {minWidth: 52, minHeight: 48, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.mint, justifyContent: 'center', alignItems: 'center'}, miniText: {...type.meta, color: colors.ink, fontSize: 11},
  amountInput: {...type.display, fontSize: 28, lineHeight: 34}, suggested: {...type.meta, color: colors.muted, fontSize: 10},
  actionPair: {flexDirection: 'row', gap: spacing.sm}, smallButton: {flex: 1, minHeight: 52, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paperAlt, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8}, scanButton: {backgroundColor: colors.sky}, smallPressed: {transform: [{translateY: 2}]}, smallButtonText: {...type.meta, color: colors.ink, textAlign: 'center', fontSize: 11},
  feeRow: {minHeight: 68, borderTopWidth: 2, borderBottomWidth: 2, borderColor: colors.ink, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.sm}, fee: {...type.body, color: colors.ink, fontWeight: '800', textAlign: 'right'},
  feeCopy: {flex: 1},
  pauseBox: {borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.orangeTint, padding: spacing.md, gap: spacing.sm},
  closeSection: {gap: spacing.sm}, closeStatus: {borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.skyTint, padding: spacing.sm, gap: spacing.xs},
});
