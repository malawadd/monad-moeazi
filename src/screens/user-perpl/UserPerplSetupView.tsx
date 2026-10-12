import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import type {PerplPreparedEnrollment, PerplRun, PerplVenue} from '../../types/perpl';
import type {UserThemeTokens} from '../../theme/userThemes';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../../components/user/UserPrimitives';
import {formatMonadTimestamp, formatMonadUnits, shortenAddress} from '../../services/monadFormatting';
import {effectiveUserPerplDurationBounds, supportedUserPerplDurations, userPerplDurationError} from '../../services/userPerplPresentation';
import {effectivePerplMarketSlippageBps} from '../../services/perplValidation';
import {userFonts} from '../../theme/tokens';

export type PendingPerplEnrollment = {id: string; status: string; note: string};

export function UserPerplSetupView({theme, venue, prepared, walletAusd, activeRun, pendingEnrollments,
  checkingActiveRun, busy, uncertain, uncertainRunId, error, activeRunError, durationMinutes, amount, onDurationChange, onAmountChange,
  runConflict, onBack, onPrepare, onSign, onCancel, onOpenRun, onOpenPending, onOpenStatus, onRetry}: {
  theme: UserThemeTokens; venue: PerplVenue | null; prepared: PerplPreparedEnrollment | null;
  walletAusd: string; activeRun: PerplRun | null; pendingEnrollments: PendingPerplEnrollment[];
  checkingActiveRun: boolean; busy: boolean; uncertain: boolean; uncertainRunId: string; error: string; activeRunError: string; runConflict: boolean;
  durationMinutes: string; amount: string; onDurationChange(value: string): void; onAmountChange(value: string): void;
  onBack(): void; onPrepare(): void; onSign(): void; onCancel(): void; onOpenRun(runId?: string): void;
  onOpenPending(): void; onOpenStatus(): void; onRetry(): void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const reviewId = prepared?.runId ?? '';
  useEffect(() => { setPermissionsOpen(false); }, [reviewId]);
  const direct = venue?.venueId === 'perpl-direct-testnet-v1';
  const durationError = userPerplDurationError(durationMinutes, venue);
  const durations = supportedUserPerplDurations(venue);
  const durationBounds = effectiveUserPerplDurationBounds(venue);
  const showSetup = Boolean(venue?.enabled && !activeRun && !activeRunError && !checkingActiveRun
    && !prepared && !uncertain && !runConflict && pendingEnrollments.length === 0);

  return <UserPage key={prepared?.runId ?? 'setup'} theme={theme}>
    <UserButton label="Back" onPress={onBack} theme={theme} secondary />
    <UserHeading theme={theme} kicker="Perpl · Monad Testnet" title={prepared ? 'Review your setup' : 'Set up Perpl'}
      copy={prepared ? 'Check the amount, trading access, risk and fee before opening Mera.'
        : direct ? 'Choose how long this 100 AUSD practice run may trade.' : 'Choose the funding amount and run length.'} />

    {error || runConflict ? <UserCard theme={theme}><UserText theme={theme} kind="title">{runConflict ? 'A Perpl run needs review' : 'Setup needs attention'}</UserText>
      <UserText theme={theme}>{runConflict
        ? 'An earlier Perpl run needs a status check before another can start. No new transaction was sent.'
        : error}</UserText>
      {runConflict ? <>
        <UserButton label="Review Perpl runs" onPress={onOpenStatus} theme={theme} />
        <UserButton label="Pending transactions" onPress={onOpenPending} theme={theme} secondary />
      </> : !prepared && !uncertain ? <UserButton label="Refresh setup details" onPress={onRetry} theme={theme} secondary /> : null}
    </UserCard> : null}
    {activeRunError ? <UserCard theme={theme}><UserText theme={theme} kind="title">Could not check the current run</UserText>
      <UserText theme={theme}>Refresh before preparing another setup.</UserText><UserButton label="Check again" onPress={onRetry} theme={theme} secondary />
    </UserCard> : null}
    {checkingActiveRun && !activeRunError ? <UserCard theme={theme}><UserText theme={theme}>Checking your Perpl status…</UserText></UserCard> : null}

    {pendingEnrollments.length > 0 ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">An earlier setup is still being checked</UserText>
      <UserText theme={theme}>Do not prepare another run yet. Open the original run or check its saved request.</UserText>
      {pendingEnrollments.map(item => <View key={item.id} style={styles.pendingRow}>
        <UserText theme={theme} kind="meta">Original run · {shortId(item.id)} · {item.status}</UserText>
        <UserButton label="Check this run" onPress={() => onOpenRun(item.id)} theme={theme} secondary />
      </View>)}
      <UserButton label="Pending transactions" onPress={onOpenPending} theme={theme} secondary />
    </UserCard> : null}

    {activeRun && pendingEnrollments.length === 0 ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">A Perpl run is already in progress</UserText>
      <UserValueRow theme={theme} label="Status" value={activeRun.status.replaceAll('_', ' ')} />
      {activeRun.expiresAt ? <UserValueRow theme={theme} label="Run ends" value={formatMonadTimestamp(activeRun.expiresAt)} /> : null}
      <UserButton label="Open run status" onPress={() => onOpenRun(activeRun.runId)} theme={theme} />
      <UserButton label="Refresh status" onPress={onRetry} theme={theme} secondary loading={checkingActiveRun} />
    </UserCard> : null}

    {uncertain ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Your setup is being checked</UserText>
      <UserText theme={theme}>The signed request may still be processing. Check the same run before trying again.</UserText>
      <UserButton label="Check Perpl status" onPress={() => onOpenRun(uncertainRunId || pendingEnrollments[0]?.id || activeRun?.runId)} theme={theme} />
      <UserButton label="Pending transactions" onPress={onOpenPending} theme={theme} secondary />
    </UserCard> : null}

    {!venue && !checkingActiveRun && !error ? <UserCard theme={theme}>
      <UserText theme={theme}>Loading current availability and limits…</UserText>
    </UserCard> : null}
    {venue && !venue.enabled ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Perpl setup is unavailable</UserText>
      <UserText theme={theme}>The service has not enabled a new Testnet run right now.</UserText>
      {venue.reasonMessage || venue.reason ? <UserDisclosure theme={theme} label="Availability details" value="From Perpl" expanded={availabilityOpen} onPress={() => setAvailabilityOpen(value => !value)}>
        <UserText theme={theme}>{venue.reasonMessage ?? venue.reason}</UserText>
      </UserDisclosure> : null}
    </UserCard> : null}

    {showSetup && venue ? <>
      <UserCard theme={theme} texture>
        <UserText theme={theme} kind="title">Choose a run length</UserText>
        <UserText theme={theme}>{direct ? '100 AUSD moves from your Mera wallet into a Perpl vault.' : `${amount || 'Your selected amount'} AUSD moves from your Mera wallet into a Perpl vault.`} Choose when the strategy should stop opening new trades.</UserText>
        <UserValueRow theme={theme} label="Mera wallet AUSD" value={walletAusd} />
        <UserValueRow theme={theme} label="Funding amount" value={direct ? '100 AUSD · fixed' : `${amount} AUSD`} />
        {!direct ? <TextInput accessibilityLabel="AUSD funding amount" keyboardType="decimal-pad" value={amount}
          onChangeText={onAmountChange} style={[styles.input, {color: theme.ink, borderColor: theme.border, backgroundColor: theme.raised}]} /> : null}
        <View accessibilityRole="radiogroup" accessibilityLabel="Run duration" style={styles.durationGrid}>
          {durations.map(minutes => {
            const selected = Number(durationMinutes) === minutes;
            return <Pressable key={minutes} accessibilityRole="radio" accessibilityState={{selected}}
              accessibilityLabel={durationLabel(minutes)} onPress={() => onDurationChange(String(minutes))}
              style={[styles.durationChoice, {borderColor: theme.border, backgroundColor: selected ? theme.accentSoft : theme.raised}]}>
              <Text style={[styles.durationText, {color: theme.ink}]}>{durationLabel(minutes)}</Text>
            </Pressable>;
          })}
        </View>
        <UserDisclosure theme={theme} label="Custom duration" value={durationError ?? `${durationLabel(Number(durationMinutes))} selected`}
          expanded={customOpen} onPress={() => setCustomOpen(value => !value)}>
          <UserText theme={theme}>Enter whole minutes within the current Perpl limits.</UserText>
          <TextInput accessibilityLabel="Custom duration in minutes" keyboardType="number-pad" value={durationMinutes}
            onChangeText={onDurationChange} style={[styles.input, {color: theme.ink, borderColor: theme.border, backgroundColor: theme.raised}]} />
          {durationError ? <UserText theme={theme} style={{color: theme.ink}}>{durationError}</UserText> : null}
        </UserDisclosure>
        {durationBounds ? <UserText theme={theme} kind="meta">Live range · {durationBounds.minMinutes}–{durationBounds.maxMinutes} min</UserText> : null}
      </UserCard>
      <UserButton label="Review this setup" onPress={onPrepare} theme={theme} loading={busy} disabled={Boolean(durationError)} />
    </> : null}

    {prepared ? <>
      {(() => {
        const feeUnits = maximumCost(prepared.fundingTransaction.gasLimit, prepared.fundingTransaction.maxFeePerGas);
        return <>
      <UserCard theme={theme} texture>
        <UserText theme={theme} kind="value">{formatMonadUnits(prepared.amountUnits, prepared.collateral.decimals)} test AUSD</UserText>
        <UserText theme={theme}>Mera wallet <Text style={{color: theme.accent}}>→</Text> Perpl vault</UserText>
        <UserValueRow theme={theme} label="Run length" value={durationLabel(prepared.durationSeconds / 60)} />
        <UserValueRow theme={theme} label="Maximum Mera network fee" value={feeUnits === null ? 'Unavailable' : `${formatMonadUnits(feeUnits, 18)} MON`} />
        <UserValueRow theme={theme} label="Trading access" value="Trade only · withdrawals off" />
        <UserValueRow theme={theme} label="Maximum leverage" value={`${prepared.maxLeverage}×`} />
        <UserText theme={theme} kind="meta">Practice trading · the balance can decrease, including the full test allocation.</UserText>
        <UserDisclosure theme={theme} label="Permissions and limits" value={`${prepared.markets.length} markets · up to ${prepared.maxLeverage}×`} expanded={permissionsOpen} onPress={() => setPermissionsOpen(value => !value)}>
          <UserValueRow theme={theme} label="Mera owner" value={shortenAddress(prepared.ownerAddress)} />
          <UserValueRow theme={theme} label="Perpl vault" value={shortenAddress(prepared.vaultAddress)} />
          <UserValueRow theme={theme} label="Maximum position exposure" value={`${formatMonadUnits(prepared.maxPositionExposureUnits, prepared.collateral.decimals)} AUSD`} />
          <UserValueRow theme={theme} label="Market slippage cap" value={`${prepared.maxSlippageBps} bps`} />
          {prepared.optimizerReview ? <UserValueRow theme={theme} label="Planned-loss target" value={`${formatMonadUnits(prepared.optimizerReview.plannedLossUnits, prepared.collateral.decimals)} AUSD · not guaranteed`} /> : null}
          <UserValueRow theme={theme} label="Mandate" value={prepared.operatorPermission.scope} detail={`Withdrawals ${prepared.operatorPermission.withdrawals ? 'enabled' : 'disabled'}`} />
          {prepared.markets.map(market => <UserValueRow key={market.id} theme={theme} label={market.symbol}
            value={`${market.isOpen ? 'Open' : 'Closed'} · up to ${market.maxLeverage ?? prepared.maxLeverage}×`}
            detail={`Slippage ≤${effectivePerplMarketSlippageBps(prepared.maxSlippageBps, market.maxMarketSlippageBps!)} bps`} />)}
          <UserValueRow theme={theme} label="Operator" value={shortenAddress(prepared.operatorPermission.address)} detail="Pays Perpl order gas in MON" />
          <UserValueRow theme={theme} label="Review expires" value={formatMonadTimestamp(prepared.preparedExpiresAt)} />
        </UserDisclosure>
      </UserCard>
      <UserText theme={theme}>A stop request stops new entries. Open positions still need to settle, and returning funds is separate.</UserText>
      <UserButton label="Enable Perpl with Mera" onPress={onSign} theme={theme} loading={busy} disabled={feeUnits === null} />
      <UserButton label="Change run length" onPress={onCancel} theme={theme} secondary disabled={busy} />
        </>;
      })()}
    </> : null}
  </UserPage>;
}

function durationLabel(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 'Choose duration';
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}
function maximumCost(gasLimit: string, maxFee: string): string | null {
  try { const cost = BigInt(gasLimit) * BigInt(maxFee); return cost > 0n ? cost.toString() : null; } catch { return null; }
}
function shortId(value: string) { return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value; }

const styles = StyleSheet.create({
  pendingRow: {gap: 8, paddingTop: 8},
  durationGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  durationChoice: {minWidth: 72, minHeight: 48, flexGrow: 1, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8},
  durationText: {fontFamily: userFonts.body, fontSize: 15, fontWeight: '800'},
  input: {minHeight: 48, borderWidth: 2, paddingHorizontal: 12, fontFamily: userFonts.body, fontSize: 16},
});
