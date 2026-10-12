import React, {ReactNode, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import type {PerplRun, PerplStopReview} from '../../types/perpl';
import type {UserThemeTokens} from '../../theme/userThemes';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../../components/user/UserPrimitives';
import {formatMonadTimestamp, formatMonadUnits} from '../../services/monadFormatting';
import {userPerplHasRecovery, userPerplRunState} from '../../services/userPerplPresentation';

export type PendingUserPerplAction = {id: string; kind: string; action: string; status: string; note: string};

export function UserPerplStatusView({theme, current, currentKnown, history, selectedRun, selectedRunLoading, selectedRunError,
  historyHasMore, loading, error, journalAvailable, busy, canStop, stopReview, stopResult, stopUncertain,
  recoveryReviewOpen, pendingActions, recoveryContent,
  onBack, onRefresh, onPrepareStop, onSignStop, onCancelStop, onSelectRun, onClearSelection,
  onLoadMore, onOpenPending, onOpenSetup, onOpenStrategies, onOpenActivity, onOpenHistory}: {
  theme: UserThemeTokens; current: PerplRun | null; currentKnown: boolean; history: PerplRun[]; selectedRun: PerplRun | null;
  selectedRunLoading: boolean; selectedRunError: string; historyHasMore: boolean; loading: boolean; error: string;
  journalAvailable: boolean; busy: boolean; canStop: boolean;
  stopReview: PerplStopReview | null; stopResult: {status: string; phase: string} | null; stopUncertain: boolean;
  recoveryReviewOpen: boolean; pendingActions: PendingUserPerplAction[]; recoveryContent?: ReactNode;
  onBack(): void; onRefresh(): void; onPrepareStop(): void; onSignStop(): void; onCancelStop(): void;
  onSelectRun(runId: string): void; onClearSelection(): void; onLoadMore(): void; onOpenPending(): void;
  onOpenSetup(): void; onOpenStrategies(): void; onOpenActivity(): void; onOpenHistory(runId: string): void;
}) {
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const [historyDetailsOpen, setHistoryDetailsOpen] = useState(false);
  const [stopTechnicalOpen, setStopTechnicalOpen] = useState(false);
  const target = selectedRun ?? current;
  const targetPending = target ? pendingActions.filter(item => item.id === target.runId && ['perpl-stop', 'perpl-recovery'].includes(item.kind)) : [];
  const currentPending = current ? pendingActions.filter(item => item.id === current.runId && ['perpl-stop', 'perpl-recovery'].includes(item.kind)) : [];
  const currentState = current ? userPerplRunState(current) : null;
  const maxFee = stopReview ? maximumCost(stopReview.stopTransaction.gasLimit, stopReview.stopTransaction.maxFeePerGas) : null;

  return <UserPage theme={theme} refreshing={loading} onRefresh={onRefresh}
    scrollResetKey={selectedRun?.runId ?? (current ? `current:${current.runId}` : 'run-history')}>
    <UserButton label="Back" onPress={onBack} theme={theme} secondary />
    <UserHeading theme={theme} kicker="Perpl · Monad Testnet" title={selectedRun ? 'Run details' : 'Perpl status'}
      copy="A stop request, settlement and returning AUSD are separate steps." />
    {error ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Status could not be refreshed</UserText>
      <UserText theme={theme}>Keep the saved request and check again before taking another action.</UserText>
      <UserButton label="Refresh status" onPress={onRefresh} theme={theme} secondary />
      <UserDisclosure theme={theme} label="More information" value="Status check" expanded={historyDetailsOpen} onPress={() => setHistoryDetailsOpen(value => !value)}>
        <UserText theme={theme}>{error}</UserText>
      </UserDisclosure>
    </UserCard> : null}
    {!journalAvailable ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Saved requests are unavailable</UserText>
      <UserText theme={theme}>This screen will not prepare another signed action until it can read the original request IDs.</UserText>
      <UserButton label="Try saved requests again" onPress={onRefresh} theme={theme} secondary />
    </UserCard> : null}
    {loading && !current && !history.length ? <UserCard theme={theme}><UserText theme={theme}>Checking current status…</UserText></UserCard> : null}

    {current ? <UserCard theme={theme} texture>
      <UserText theme={theme} kind="meta">CURRENT RUN</UserText>
      <UserText theme={theme} kind="title">{currentState?.title}</UserText>
      <UserText theme={theme}>{currentState?.message}</UserText>
      <UserValueRow theme={theme} label="Status" value={humanize(current.status)} />
      {current.expiresAt ? <UserValueRow theme={theme} label="Run ends" value={formatMonadTimestamp(current.expiresAt)} /> : null}
      {current.position ? <UserValueRow theme={theme} label="Open position" value={`${humanize(String(current.position.side ?? ''))} · ${String(current.markets?.find(item => item.id === current.position?.marketId)?.symbol ?? current.position.symbol ?? 'Perpl market')}`} /> : null}
      {current.positionSnapshot?.status === 'finalized' && current.positionSnapshot.verified === true && current.positionSnapshot.balanceUnits !== undefined
        ? <UserValueRow theme={theme} label="Verified Perpl balance" value={`${formatMonadUnits(current.positionSnapshot.balanceUnits, current.collateral.decimals)} AUSD`} detail="Finalized account reading" /> : null}
      {currentPending.length ? <PendingNotice theme={theme} items={currentPending} onOpen={onOpenPending} /> : null}
      {current.status.toLowerCase() === 'prepared' ? <UserButton label="Return to setup" onPress={onOpenSetup} theme={theme} /> : null}
      {canStop && journalAvailable && !stopReview && !stopUncertain && !currentPending.length
        ? <UserButton label="Ask strategy to stop new trades" onPress={onPrepareStop} theme={theme} loading={busy} /> : null}
      <UserButton label="Open full run history" onPress={() => onOpenHistory(current.runId)} theme={theme} secondary />
    </UserCard> : !selectedRun && currentKnown ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">No active Perpl run</UserText>
      <UserText theme={theme}>Previous runs stay here for settlement and recovery checks.</UserText>
      <UserButton label="Browse strategies" onPress={onOpenStrategies} theme={theme} />
    </UserCard> : null}
    {!selectedRun && current ? recoveryContent : null}

    {stopResult ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Stop request sent</UserText>
      <UserText theme={theme}>The service is checking the same run. This is not a settlement or AUSD return confirmation.</UserText>
      <UserValueRow theme={theme} label="Current status" value={humanize(stopResult.status)} detail={humanize(stopResult.phase)} />
      <UserButton label="Refresh status" onPress={onRefresh} theme={theme} secondary />
    </UserCard> : null}
    {stopUncertain && !currentPending.length ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Stop outcome still being checked</UserText>
      <UserText theme={theme}>Refresh this run before preparing another request.</UserText>
      <UserButton label="Refresh status" onPress={onRefresh} theme={theme} secondary />
    </UserCard> : null}
    {stopReview ? <>
      <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Review stop request</UserText>
        <UserValueRow theme={theme} label="Action" value="Stop new entries" detail="Open positions and orders still need settlement" />
        <UserDisclosure theme={theme} label="Request details" value="Technical details" expanded={stopTechnicalOpen} onPress={() => setStopTechnicalOpen(value => !value)}>
          <UserValueRow theme={theme} label="Vault call" value="requestStop() · no MON value sent" />
        </UserDisclosure>
        <UserValueRow theme={theme} label="Maximum Mera network fee" value={maxFee ? `${formatMonadUnits(maxFee, 18)} MON` : 'Unavailable'} />
        <UserValueRow theme={theme} label="Network" value="Monad Testnet" />
        <UserValueRow theme={theme} label="Review expires" value={formatMonadTimestamp(stopReview.preparedExpiresAt)} />
      </UserCard>
      <UserButton label="Stop new trades with Mera" onPress={onSignStop} theme={theme} loading={busy} disabled={!maxFee} />
      <UserButton label="Cancel stop review" onPress={onCancelStop} theme={theme} secondary disabled={busy} />
    </> : null}

    {selectedRun ? <>
      <UserCard theme={theme}>
        <UserText theme={theme} kind="title">{userPerplRunState(selectedRun).title}</UserText>
        <UserText theme={theme}>{userPerplRunState(selectedRun).message}</UserText>
        <UserValueRow theme={theme} label="Status" value={humanize(selectedRun.status)} />
        {selectedRun.expiresAt ? <UserValueRow theme={theme} label="Run ended" value={formatMonadTimestamp(selectedRun.expiresAt)} /> : null}
        {selectedRun.returnedUnits !== null && selectedRun.returnedUnits !== undefined
          ? <UserValueRow theme={theme} label="Returned to Mera wallet" value={`${formatMonadUnits(selectedRun.returnedUnits, selectedRun.collateral.decimals)} AUSD`} /> : null}
        {selectedRun.position ? <UserValueRow theme={theme} label="Open position" value={String(selectedRun.position.symbol ?? 'Perpl market')} /> : null}
        {userPerplHasRecovery(selectedRun) ? <UserText theme={theme} kind="meta">An AUSD recovery action is available for this run.</UserText> : null}
        <UserDisclosure theme={theme} label="Run details" value="Owner and reference" expanded={runDetailsOpen} onPress={() => setRunDetailsOpen(value => !value)}>
          <UserValueRow theme={theme} label="Original run ID" value={selectedRun.runId} />
          <UserValueRow theme={theme} label="Mera owner" value={selectedRun.ownerAddress} />
          <UserValueRow theme={theme} label="Perpl vault" value={selectedRun.vaultAddress} />
          {selectedRun.phase ? <UserValueRow theme={theme} label="Last run phase" value={humanize(selectedRun.phase)} /> : null}
        </UserDisclosure>
        {pendingActions.some(item => item.kind === 'perpl-run' && item.id === selectedRun.runId)
          && ['prepared', 'activation_pending', 'uncertain'].includes(selectedRun.status.toLowerCase())
          ? <PendingNotice theme={theme} items={pendingActions.filter(item => item.kind === 'perpl-run' && item.id === selectedRun.runId)} onOpen={onOpenPending} /> : null}
        {targetPending.length ? <PendingNotice theme={theme} items={targetPending} onOpen={onOpenPending} /> : null}
        <UserButton label="Open full run history" onPress={() => onOpenHistory(selectedRun.runId)} theme={theme} secondary />
      </UserCard>
      {recoveryContent}
      <UserButton label="Back to run history" onPress={onClearSelection} theme={theme} secondary disabled={recoveryReviewOpen} />
    </> : null}

    {selectedRunLoading ? <UserCard theme={theme}><UserText theme={theme}>Loading this run’s history…</UserText></UserCard> : null}
    {selectedRunError ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">This run could not be loaded</UserText>
      <UserText theme={theme}>The saved run ID is unchanged. Refresh Perpl status to try the same ID again.</UserText>
      <UserButton label="Refresh status" onPress={onRefresh} theme={theme} secondary />
      <UserText theme={theme} kind="meta">{selectedRunError}</UserText>
    </UserCard> : null}

    {history.length ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Previous runs</UserText>
      {history.filter(run => run.runId !== current?.runId).map(run => <View key={run.runId} style={styles.historyRow}>
        <UserValueRow theme={theme} label={run.startedAt ? formatMonadTimestamp(run.startedAt) : 'Perpl run'} value={humanize(run.status)} />
        {userPerplHasRecovery(run) ? <UserText theme={theme} kind="meta">Recovery available</UserText> : null}
        <UserButton label="Open run" onPress={() => onSelectRun(run.runId)} theme={theme} secondary disabled={Boolean(stopReview) || recoveryReviewOpen} />
        <UserButton label="Full history" onPress={() => onOpenHistory(run.runId)} theme={theme} secondary disabled={Boolean(stopReview) || recoveryReviewOpen} />
      </View>)}
      {history.every(run => run.runId === current?.runId) ? <UserText theme={theme}>No earlier runs in this page.</UserText> : null}
      {historyHasMore ? <UserButton label="Load more runs" onPress={onLoadMore} theme={theme} secondary loading={busy} /> : null}
    </UserCard> : null}
    <UserButton label="Pending transactions" onPress={onOpenPending} theme={theme} secondary />
    <UserButton label="Open Activity" onPress={onOpenActivity} theme={theme} secondary />
  </UserPage>;
}

function PendingNotice({theme, items, onOpen}: {theme: UserThemeTokens; items: PendingUserPerplAction[]; onOpen(): void}) {
  return <View style={[styles.pendingNotice, {borderColor: theme.border, backgroundColor: theme.neutralSurface}]}>
    <UserText theme={theme}>A signed request for this run is still being checked. Do not send the same action again.</UserText>
    {items.map(item => <UserText key={`${item.kind}:${item.id}:${item.action}`} theme={theme} kind="meta">
      {humanize(item.action)} · {item.status} · {shortId(item.id)}
    </UserText>)}
    <UserButton label="Check saved request" onPress={onOpen} theme={theme} secondary />
  </View>;
}

function maximumCost(gasLimit: string, maxFee: string): string | null {
  try { const value = BigInt(gasLimit) * BigInt(maxFee); return value > 0n ? value.toString() : null; } catch { return null; }
}
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function shortId(value: string) { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }

const styles = StyleSheet.create({
  pendingNotice: {borderWidth: 2, padding: 10, gap: 8}, historyRow: {gap: 4, paddingTop: 8},
});
