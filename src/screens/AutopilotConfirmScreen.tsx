import React, {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, LoadingBlock, Notice, PageHeader, StatusBadge} from '../components/Ui';
import {confirmSensitiveAction} from '../services/biometrics';
import {useApp} from '../state/AppContext';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {haptics} from '../services/haptics';
import {getCurrentScopedGrantKey, clearScopedGrantKey} from '../services/scopedGrantKeyStore';

export function AutopilotConfirmScreen() {
  const route = useRoute<any>(); const navigation = useNavigation<any>(); const {limits, startAutopilot, stopAutopilot, busy, mode, ownerAddress} = useApp();
  const stopping = Boolean(route.params?.stop); const [error, setError] = useState('');
  const [stopResult, setStopResult] = useState<Awaited<ReturnType<typeof stopAutopilot>>>(undefined);
  async function confirm() {
    setError('');
    try {
      if (!stopping && !await confirmSensitiveAction('Start the AI trader with these limits')) { haptics.reject(); setError('Device confirmation was cancelled. Nothing changed.'); return; }
      if (stopping) {
        const key = await getCurrentScopedGrantKey(ownerAddress ?? undefined);
        const result = await stopAutopilot(key ? [key] : []);
        if (mode === 'preview') { navigation.goBack(); return; }
        setStopResult(result);
        if (result?.stopState?.scopedGrantRevocation === 'buy_revoked_exit_retained'
            || result?.stopState?.scopedGrantRevocation === 'buy_revoked_exit_expired') await clearScopedGrantKey();
      } else await startAutopilot();
      haptics.confirm();
      if (!stopping) navigation.goBack();
    } catch (reason) { haptics.reject(); setError(reason instanceof Error ? reason.message : 'Please try again.'); }
  }
  if (stopping) {
    const state = stopResult?.stopState;
    const vault = state?.vaultStopStatus && state.vaultStopStatus !== 'not_applicable';
    const stopComplete = state?.nativeFinanceAdmissionStopped
      && state.scopedGrantRevocation !== 'pending';
    return <FlowScreen scroll={false} modal><View style={styles.sheet}>
      <ScrollView contentContainerStyle={styles.content}>
        <PageHeader kicker="Stop AI trader" title={stopResult ? 'New entries are paused' : 'Stop new activity?'}
          copy="Stop pauses the managed assignment and financial admission. A Magic-owned trading vault also needs a finalized on-chain stop." />
        <Card tint={colors.roseTint}><Text style={s.strong}>Position closure is not confirmed</Text>
          <Text style={s.body}>An already-submitted operation may still settle. Stop blocks new entries; it does not close a position or release funds for withdrawal.</Text>
        </Card>
        {state ? <Card tint={stopComplete ? colors.mintTint : colors.orangeTint}>
          <DataRow label="Assignment" value={state.assignmentPaused ? 'Paused' : 'Needs retry'} />
          <DataRow label="Native finance admission" value={state.nativeFinanceAdmissionStopped ? state.nativeFinanceAdmissionStopStatus : 'Pending'} />
          {vault ? <DataRow label="Magic vault on-chain stop" value={state.onChainVaultStopConfirmed ? 'Finalized' : 'Pending'} />
            : <DataRow label="Buy grant" value={state.scopedGrantRevocation === 'no_known_grants' ? 'No known grant' : state.failedBuyScopes === 0 ? 'Revoked' : 'Pending revocation'} />}
          <DataRow label="Exit route" value={vault ? 'Vault sell remains possible after Stop'
            : state.exitGrantStatus === 'verified_active' && state.exitGrantExpiresAt
              ? `Retained until ${new Date(state.exitGrantExpiresAt * 1000).toLocaleString()}`
              : state.exitGrantStatus.replaceAll('_', ' ')} />
          <DataRow label="Submitted operation" value={state.submittedOperationMayStillSettle ? 'May still settle' : 'No pending operation reported'} />
          <DataRow label="Position closure" value="Unconfirmed" />
        </Card> : null}
        {error ? <Notice live tone="rose" title="Stop is partially pending" message={error} /> : null}
      </ScrollView>
      <View style={styles.footer}>
        {stopComplete ? <Button label="Done" onPress={() => navigation.goBack()} />
          : <Button label={stopResult ? 'Retry pending stop checks' : 'Stop AI trader'}
            variant="danger" onPress={confirm} loading={busy} />}
        <Button label="Close review" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    </View></FlowScreen>;
  }
  const startReady = mode === 'preview' || limits?.assignmentReady === true;
  return <FlowScreen scroll={false} modal><View style={styles.sheet}><ScrollView contentContainerStyle={styles.content}>
    <PageHeader kicker="One final review" title="Start AI trader" copy="Review the conservative limits supplied by the server." />
    {limits ? <Card tint={colors.mintTint}><DataRow label={limits.managedVaultCapitalUsdc ? 'Magic vault capital committed' : 'Managed amount'} value={limits.managedVaultCapitalUsdc ? `${limits.managedVaultCapitalUsdc} USDC` : `$${limits.managedAmountUsd}`} /><DataRow label="Permitted markets" value={limits.allowedMarkets.join(', ')} />{limits.maxSingleOrderUsd ? <DataRow label="Maximum single order" value={`$${limits.maxSingleOrderUsd}`} /> : null}<DataRow label="Maximum exposure" value={`$${limits.maxPositionUsd}`} />{limits.maxDailyLossUsd ? <DataRow label="Maximum daily loss" value={`$${limits.maxDailyLossUsd}`} /> : null}<DataRow label="Daily drawdown stop" value={limits.dailyLossStopPercent} /><DataRow label="AI schedule" value={limits.cadenceLabel} /><DataRow label="Credits" value={String(limits.availableCredits)} /></Card> : <LoadingBlock label="Loading current limits" lines={4} />}
    <Card><StatusBadge label={mode === 'preview' ? 'Preview' : startReady ? 'Ready' : 'Blocked'} tone={mode === 'preview' || startReady ? 'mint' : 'yellow'} /><Text style={s.body}>{limits?.liveTradingEnabled
      ? 'Start enables managed analysis. A grounded proposal may become a real order only after current risk, account, and venue checks; a position appears only after a confirmed fill.'
      : 'Start does not currently enable live trading for this account. Review the funding and runtime blockers before expecting a real order.'}</Text>{limits?.activationBlockers?.map((blocker, index) => <Text key={`${index}-${blocker}`} style={s.body}>• {blocker}</Text>)}</Card>
    {error ? <Notice live tone="rose" title="Could not start" message={error} /> : null}
  </ScrollView><View style={styles.footer}><Button label="Confirm with biometrics" disabled={!startReady} loading={busy} onPress={confirm} /></View></View></FlowScreen>;
}

const styles = StyleSheet.create({sheet: {flex: 1}, content: {gap: spacing.md, paddingBottom: spacing.lg}, footer: {gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper}});
