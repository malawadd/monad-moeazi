import React, {useCallback, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, Notice, PageHeader, Section, TextLink} from '../components/Ui';
import {confirmSensitiveAction} from '../services/biometrics';
import {allowanceNeedsApproval, formatTokenUnits, magicEnableTypedData, MANAGED_TOKENS,
  scopeActivationAllowanceReady,
  reviewScopes, validateScopedGrantPreparation} from '../services/managedAutopilot';
import {getOrCreateScopedGrantKey} from '../services/scopedGrantKeyStore';
import {mobileApi} from '../services/apiClient';
import {verifiedWalletReadiness, type AutopilotWalletReadiness} from '../services/autopilotWalletReadiness';
import {ManagedSpotMandateCard} from './ManagedSpotMandateCard';
import {magicWallet} from '../services/wallet/MagicWalletAdapter';
import {haptics} from '../services/haptics';
import {useApp} from '../state/AppContext';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import type {ManagedProgramGrantContext, ManagedScopedGrant, ScopedGrantAllowance,
  ScopedGrantPreparation} from '../types/mobile';

type Scope = 'buy' | 'exit';
type ContextResult = ManagedProgramGrantContext | {contextAvailable: false; code?: string; blockingReason?: string};
const tokenFor = (scope: Scope) => scope === 'buy' ? MANAGED_TOKENS.usdc : MANAGED_TOKENS.weth;
const unitsFor = (context: ManagedProgramGrantContext, scope: Scope) => scope === 'buy'
  ? context.bounds.maxUsdcUnits : context.bounds.maxWethUnits;
const decimalsFor = (scope: Scope) => scope === 'buy' ? 6 : 18;

function contextKey(context: ManagedProgramGrantContext) {
  return [context.assignmentId, context.programVersionId, context.contentHash, context.policyHash,
    context.venueAccountId, context.expiresAt, context.bounds.maxUsdcUnits, context.bounds.maxWethUnits,
    context.bounds.minWethOutUnits, context.bounds.minUsdcOutUnits].join(':');
}

function GrantCard({scope, context, grant, allowance, preparation, busy,
  onAcknowledge, acknowledged, onSign, onCheck, onApprove, onFund}: {
  scope: Scope; context: ManagedProgramGrantContext; grant?: ManagedScopedGrant;
  allowance?: ScopedGrantAllowance; preparation: ScopedGrantPreparation; busy: boolean;
  onAcknowledge(): void; acknowledged: boolean; onSign(): void; onCheck(): void; onApprove(): void; onFund(): void;
}) {
  const units = unitsFor(context, scope), decimals = decimalsFor(scope);
  const balance = allowance?.balanceUnits ?? (scope === 'buy' ? preparation.allowance.usdcBalanceUnits : preparation.allowance.wethBalanceUnits);
  const currentAllowance = allowance?.allowanceUnits ?? (scope === 'buy' ? preparation.allowance.usdcAllowanceUnits : preparation.allowance.wethAllowanceUnits);
  const balanceReady = allowance?.balanceReady ?? BigInt(balance) >= BigInt(units);
  const activationReady = allowance?.activationReady ?? scopeActivationAllowanceReady(scope, balance, currentAllowance, units);
  const approvalNeeded = allowanceNeedsApproval(balance, currentAllowance, units, scope === 'buy');
  const title = scope === 'buy' ? 'Buy scope · USDC to WETH' : 'Exit scope · WETH to USDC';
  return <Card tint={scope === 'buy' ? colors.skyTint : colors.mintTint}>
    <Text style={s.subheading}>{title}</Text>
    <DataRow label="Owner" value={`${context.ownerAddress.slice(0, 8)}…${context.ownerAddress.slice(-6)}`} />
    <DataRow label="Arbitrum Uniswap V3 router" value="0xE592…1564 · fee tier 3000" />
    <DataRow label="Maximum input" value={`${formatTokenUnits(units, decimals)} ${scope === 'buy' ? 'USDC' : 'WETH'}`} />
    <DataRow label="Minimum output" value={`${formatTokenUnits(scope === 'buy' ? context.bounds.minWethOutUnits : context.bounds.minUsdcOutUnits, scope === 'buy' ? 18 : 6)} ${scope === 'buy' ? 'WETH' : 'USDC'}`} />
    <DataRow label="Recipient" value={`${context.ownerAddress.slice(0, 8)}…${context.ownerAddress.slice(-6)}`} />
    <DataRow label="Calls / value" value="1 call · 0 ETH" />
    <DataRow label="Grant expires" value={new Date(context.expiresAt * 1000).toLocaleString()} />
    {grant ? <>
      <DataRow label="Magic session signer" value={grant.sessionAddress} />
      <DataRow label="EIP-712 domain" value={`Arbitrum · ${String(grant.ownerApproval.domain.name ?? 'Enable')} · ${String(grant.ownerApproval.domain.verifyingContract ?? grant.sessionAddress)}`} />
      <Text selectable style={s.body}>Owner approval message: {JSON.stringify(grant.ownerApproval.message)}</Text>
      <DataRow label="Owner signature" value={grant.state === 'active' ? 'Recorded for exact scope' : 'Required'} />
      {grant.state === 'awaiting-owner' ? <>
        <Pressable accessibilityRole="checkbox" accessibilityState={{checked: acknowledged}} onPress={onAcknowledge} style={styles.reviewCheck}>
          <Text style={s.strong}>{acknowledged ? '☑' : '☐'} I reviewed this exact route, recipient, and cap.</Text>
        </Pressable>
        <Button label={`Confirm with device security & sign ${scope}`} variant="secondary" disabled={!acknowledged} loading={busy} onPress={onSign} />
      </> : null}
      {grant.state === 'active' ? <>
        <DataRow label="Finalized owner balance" value={`${formatTokenUnits(balance, decimals)} ${scope === 'buy' ? 'USDC' : 'WETH'}`} />
        <DataRow label="Current router allowance" value={`${formatTokenUnits(currentAllowance, decimals)} ${scope === 'buy' ? 'USDC' : 'WETH'}`} />
        {scope === 'buy' && !balanceReady ? <Notice tone="orange" title="Exact buy cap is not funded" message={`Owner USDC balance must cover ${formatTokenUnits(units, decimals)} before this scope can qualify.`} /> : null}
        {scope === 'buy' && !balanceReady ? <TextLink label="Review wallet funding" onPress={onFund} /> : null}
        {scope === 'exit' && !balanceReady ? <Text style={s.body}>No WETH position is needed before Start. The actual WETH balance is checked again before each sell.</Text> : null}
        {approvalNeeded ? <Button label={`Approve exact ${scope === 'buy' ? 'USDC' : 'WETH'} cap`} variant="secondary" loading={busy} onPress={onApprove} /> : null}
        <Button label={activationReady ? (scope === 'buy' ? 'Buy funding and allowance verified' : 'Exit allowance authorized') : `Recheck finalized ${scope === 'buy' ? 'USDC' : 'WETH'} allowance`} variant={activationReady ? 'secondary' : 'primary'} disabled={activationReady} loading={busy} onPress={onCheck} />
        {activationReady ? <StatusText text={scope === 'buy'
          ? `Buy balance and allowance verified at finalized Arbitrum block ${allowance?.blockNumber ?? preparation.allowance.blockNumber}.`
          : `Exit allowance verified at finalized Arbitrum block ${allowance?.blockNumber ?? preparation.allowance.blockNumber}; WETH balance is checked when a sell executes.`} /> : null}
      </> : null}
    </> : <Text style={s.body}>Prepare both scopes to review the exact owner signatures and token caps.</Text>}
  </Card>;
}

function StatusText({text}: {text: string}) { return <Text style={s.strong}>{text}</Text>; }

export function ManagedAutopilotSetupScreen() {
  const navigation = useNavigation<any>();
  const {mode, account, ownerAddress, limits, loadLimits, refreshHome} = useApp();
  const [context, setContext] = useState<ContextResult | null>(null);
  const [walletReadiness, setWalletReadiness] = useState<AutopilotWalletReadiness | null>(null);
  const [walletReadinessError, setWalletReadinessError] = useState('');
  const [showLegacyScopedFlow, setShowLegacyScopedFlow] = useState(false);
  const [preparation, setPreparation] = useState<ScopedGrantPreparation | null>(null);
  const [allowances, setAllowances] = useState<Partial<Record<Scope, ScopedGrantAllowance>>>({});
  const [acknowledged, setAcknowledged] = useState<Partial<Record<Scope, boolean>>>({});
  const [busyKey, setBusyKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const loadLimitsRef = useRef(loadLimits); loadLimitsRef.current = loadLimits;

  const refresh = useCallback(async () => {
    setError(''); setMessage(''); setContext(null); setWalletReadiness(null); setWalletReadinessError('');
    await loadLimitsRef.current();
    if (mode !== 'authenticated') return;
    await Promise.all([
      showLegacyScopedFlow ? mobileApi.uniswapGrantContext().then(setContext).catch(reason =>
        setContext({contextAvailable: false, blockingReason: reason instanceof Error ? reason.message : 'Managed grant context is unavailable.'})) : Promise.resolve(),
      mobileApi.autopilotWalletReadiness().then(value => {
        if (!ownerAddress) throw new Error('The signed-in Magic wallet is unavailable.');
        setWalletReadiness(verifiedWalletReadiness(value, ownerAddress));
      }).catch(reason => setWalletReadinessError(reason instanceof Error ? reason.message : 'The live Arbitrum account could not be read.')),
    ]);
  }, [mode, ownerAddress, showLegacyScopedFlow]);

  useFocusEffect(useCallback(() => { let active = true; refresh().catch(reason => {if (active) setError(reason instanceof Error ? reason.message : 'Readiness could not be refreshed.');}); return () => {active = false;}; }, [refresh]));

  const usableContext = context && 'contextAvailable' in context && context.contextAvailable ? context : null;
  const blockedContext = context && context.contextAvailable === false ? context : null;
  const grants = preparation ? reviewScopes(preparation.grants) : {buy: undefined, exit: undefined};
  async function confirmMode() {
    setBusyKey('mode'); setError('');
    try { await mobileApi.confirmAutopilotMode(); await refresh(); setMessage('Autopilot mode confirmed for the exact paused assignment. Cadence remains off.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Mode confirmation was blocked.'); }
    finally { setBusyKey(''); }
  }

  async function prepareScopes() {
    if (!usableContext || !ownerAddress) return;
    setBusyKey('prepare'); setError('');
    try {
      if (usableContext.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error('The authenticated Magic owner does not match this managed grant.');
      const key = await getOrCreateScopedGrantKey(contextKey(usableContext), ownerAddress);
      const response = await mobileApi.prepareScopedGrants(key);
      validateScopedGrantPreparation(response, usableContext);
      setPreparation(response); setAllowances({}); setAcknowledged({}); setMessage('Review the buy and exit caps below. No wallet action has been sent.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Scoped grant preparation failed.'); }
    finally { setBusyKey(''); }
  }

  async function signScope(scope: Scope) {
    if (!usableContext || !preparation || !ownerAddress) return;
    const grant = scope === 'buy' ? grants.buy : grants.exit;
    if (!grant || grant.state !== 'awaiting-owner') return;
    setBusyKey(`sign-${scope}`); setError('');
    try {
      if (!await confirmSensitiveAction(`Sign the reviewed ${scope} grant for the exact managed cap`)) throw new Error('Device confirmation was cancelled. No grant signature was sent.');
      const signature = await magicWallet.signTypedData(magicEnableTypedData(grant), ownerAddress);
      if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) throw new Error('Magic returned an invalid owner signature.');
      const key = await getOrCreateScopedGrantKey(contextKey(usableContext), ownerAddress);
      const result = await mobileApi.activateScopedGrant(scope, signature, key);
      setPreparation(current => current ? {...current, grants: current.grants.map(item => item.scope === scope ? result.grant : item)} : current);
      setMessage(`${scope === 'buy' ? 'Buy' : 'Exit'} scope owner signature is recorded. Token allowance is still checked separately.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Owner signing did not complete.'); }
    finally { setBusyKey(''); }
  }

  async function checkAllowance(scope: Scope) {
    if (!usableContext || !ownerAddress) return;
    setBusyKey(`allowance-${scope}`); setError('');
    try {
      const key = await getOrCreateScopedGrantKey(contextKey(usableContext), ownerAddress);
      const result = await mobileApi.readScopedGrantAllowance(scope, key);
      if (result.owner.toLowerCase() !== ownerAddress.toLowerCase() || result.token.toLowerCase() !== tokenFor(scope)
          || result.requiredUnits !== unitsFor(usableContext, scope) || !/^0x[a-fA-F0-9]{64}$/.test(result.blockHash)) {
        throw new Error('The finalized allowance response did not match this owner, token, and exact cap.');
      }
      const balanceReady = BigInt(result.balanceUnits) >= BigInt(result.requiredUnits);
      const allowanceReady = BigInt(result.allowanceUnits) >= BigInt(result.requiredUnits);
      const activationReady = scopeActivationAllowanceReady(scope, result.balanceUnits, result.allowanceUnits, result.requiredUnits);
      if (result.balanceReady !== balanceReady || result.allowanceReady !== allowanceReady
          || result.spendReady !== (balanceReady && allowanceReady) || result.ready !== result.spendReady
          || result.activationReady !== activationReady) {
        throw new Error('The finalized balance and allowance readiness fields do not match their exact unit values.');
      }
      setAllowances(current => ({...current, [scope]: result}));
      setMessage(result.activationReady ? scope === 'buy'
        ? `Buy balance and allowance verified at finalized block ${result.blockNumber}.`
        : `Exit allowance verified at finalized block ${result.blockNumber}; WETH balance is checked at sell execution.`
        : scope === 'buy' ? 'The finalized USDC balance and router allowance must both meet the cap.'
          : 'The finalized WETH router allowance must meet the exit cap. WETH balance is checked only when a sell executes.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Finalized token allowance check failed.'); }
    finally { setBusyKey(''); }
  }

  async function approveCap(scope: Scope) {
    if (!usableContext || !preparation || !ownerAddress) return;
    const allowance = allowances[scope];
    const units = unitsFor(usableContext, scope);
    const balance = allowance?.balanceUnits ?? (scope === 'buy' ? preparation.allowance.usdcBalanceUnits : preparation.allowance.wethBalanceUnits);
    const current = allowance?.allowanceUnits ?? (scope === 'buy' ? preparation.allowance.usdcAllowanceUnits : preparation.allowance.wethAllowanceUnits);
    if (!allowanceNeedsApproval(balance, current, units, scope === 'buy')) return;
    setBusyKey(`approve-${scope}`); setError('');
    try {
      if (!await confirmSensitiveAction(`Approve exactly ${formatTokenUnits(units, decimalsFor(scope))} ${scope === 'buy' ? 'USDC' : 'WETH'} for the Uniswap router`)) throw new Error('Device confirmation was cancelled. No token approval was sent.');
      const hash = await magicWallet.sendScopedTokenApproval({owner: ownerAddress, scope, context: usableContext});
      setMessage(`Approval transaction ${hash.slice(0, 12)}… was submitted. Recheck after it appears at a finalized Arbitrum block.`);
      setAllowances(currentAllowances => ({...currentAllowances, [scope]: undefined}));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The exact token cap approval was not submitted.'); }
    finally { setBusyKey(''); }
  }

  async function publishAuthority() {
    if (!usableContext || !ownerAddress || !preparation || !grants.buy || !grants.exit
        || grants.buy.state !== 'active' || grants.exit.state !== 'active'
        || !allowances.buy?.activationReady || !allowances.exit?.activationReady) return;
    setBusyKey('authority'); setError('');
    try {
      const key = await getOrCreateScopedGrantKey(contextKey(usableContext), ownerAddress);
      const result = await mobileApi.publishManagedActivationAuthority(key);
      if (result.executionQualified !== false || result.liveTradingEnabled !== false) throw new Error('Activation response did not preserve the live-execution gate.');
      setMessage('Native activation authority was recorded. Refreshing the final Start gate; live trading remains gated.');
      await refresh(); await refreshHome();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Native activation authority remains unavailable.'); }
    finally { setBusyKey(''); }
  }

  const hasAssignment = Boolean(limits?.assignmentId && ['paused', 'active'].includes(limits.assignmentState ?? ''));
  const enrollment = account?.managedProgramEnrollment;
  const anyBusy = Boolean(busyKey);
  if (mode === 'preview') return <FlowScreen><PageHeader kicker="Managed Autopilot" title="Preview stays separate" copy="This setup journey is available only for a signed-in Magic account. Preview never calls a wallet or service." /><Card><Text style={s.body}>No managed program actions are available in preview.</Text></Card></FlowScreen>;
  return <FlowScreen refreshing={false} onRefresh={() => {refresh().catch(() => undefined);}}>
    <PageHeader kicker="Managed Autopilot setup" title="Account and program readiness" copy="Choose managed capital and a period below. The older scoped-grant qualification is still available separately. Trading remains off until the signed funding, finance, and native execution paths are verified." />
    <Card tint={colors.skyTint}><Text style={s.subheading}>Signup and managed assignment</Text><DataRow label="Allowlisted enrollment" value={enrollment?.state?.replaceAll('_', ' ') ?? 'No enrollment receipt reported'} />{enrollment?.reason ? <Text style={s.body}>{enrollment.reason}</Text> : null}<DataRow label="Assignment" value={limits?.assignmentId ?? 'Not assigned'} /><DataRow label="Frozen version" value={limits?.programVersionId ?? 'Unavailable'} /><DataRow label="Mode" value={limits?.controllerRef?.controllerKind === 'managed_program' ? 'Managed program' : limits?.assignmentId ? 'Managed assignment' : 'Not assigned'} /></Card>
    <Card><Text style={s.subheading}>Signed-in Magic wallet · live Arbitrum read</Text>
      {walletReadiness ? <>
        <DataRow label="Funding owner" value={walletReadiness.owner} />
        <DataRow label="Finalized USDC" value={`${formatTokenUnits(walletReadiness.finalized.usdcUnits, 6)} USDC`} />
        <DataRow label="Finalized ETH for network fees" value={`${formatTokenUnits(walletReadiness.finalized.ethWei, 18)} ETH`} />
        <DataRow label="Finalized block" value={walletReadiness.finalized.blockNumber} />
        <DataRow label="Existing delegation" value={walletReadiness.finalized.delegation.kind.replaceAll('_', ' ')} />
        {walletReadiness.finalized.delegation.target ? <DataRow label="Delegate target" value={walletReadiness.finalized.delegation.target} /> : null}
        <Text style={s.body}>This is the Magic wallet that supplies USDC and signs funding. A delegation or transaction relay does not become a second funded owner. Funding compatibility is checked when the exact transaction is prepared.</Text>
      </> : <Text style={s.body}>{walletReadinessError || 'Reading finalized Arbitrum balance and delegation…'}</Text>}
    </Card>
    <ManagedSpotMandateCard ownerAddress={ownerAddress} walletReadiness={walletReadiness}
      assignmentId={limits?.assignmentId} modeConfirmationRequired={Boolean(limits?.modeConfirmationRequired)}
      onModeConfirmed={refresh}
      onActivated={async () => {await refresh(); await refreshHome();}} />
    {limits?.modeConfirmationRequired ? <Card tint={colors.yellow}><Text style={s.strong}>Customer mode confirmation</Text><Text style={s.body}>This confirms Autopilot for this exact paused assignment only. It does not start cadence, sign a grant, or enable trading.</Text><Button label="Confirm this managed program for Autopilot" loading={busyKey === 'mode'} onPress={confirmMode} /></Card> : null}
    <Button label={showLegacyScopedFlow ? 'Hide older scoped-grant setup' : 'Show older scoped-grant setup'}
      variant="secondary" onPress={() => setShowLegacyScopedFlow(value => !value)} />
    {showLegacyScopedFlow ? <>
    {blockedContext ? <Notice live tone="orange" title="Scoped setup is blocked" message={blockedContext.blockingReason ?? 'The exact owner, assignment, version, venue authority, or native caps are not ready.'} /> : null}
    {!context ? <Notice title="Checking current managed authority" message="The server is validating the exact assignment and native venue limits." tone="lilac" /> : null}
    {usableContext ? <>
      <Card><Text style={s.strong}>Server-derived grant bounds</Text><DataRow label="Frozen content hash" value={usableContext.contentHash} /><DataRow label="Policy hash" value={`0x${usableContext.policyHash}`} /><DataRow label="Owner" value={usableContext.ownerAddress} /><DataRow label="Venue account" value={usableContext.venueAccountId} /><DataRow label="Buy cap" value={`${formatTokenUnits(usableContext.bounds.maxUsdcUnits, 6)} USDC`} /><DataRow label="Exit cap" value={`${formatTokenUnits(usableContext.bounds.maxWethUnits, 18)} WETH`} /><Text style={s.body}>The client cannot choose caps. No USD-to-WETH conversion is inferred.</Text></Card>
      {!preparation ? <Button label="Prepare buy and exit owner review" loading={busyKey === 'prepare'} onPress={prepareScopes} /> : <>
        <Section><Text style={s.subheading}>Review and authorize each scope</Text><Text style={s.body}>Magic will sign only each scope's EIP-712 Enable payload after device confirmation. The review is one Uniswap V3 call with zero ETH value.</Text>
          <GrantCard scope="buy" context={usableContext} grant={grants.buy} allowance={allowances.buy} preparation={preparation} busy={anyBusy} acknowledged={Boolean(acknowledged.buy)} onAcknowledge={() => {haptics.selection(); setAcknowledged(value => ({...value, buy: !value.buy}));}} onSign={() => signScope('buy')} onCheck={() => checkAllowance('buy')} onApprove={() => approveCap('buy')} onFund={() => navigation.navigate('Funding')} />
          <GrantCard scope="exit" context={usableContext} grant={grants.exit} allowance={allowances.exit} preparation={preparation} busy={anyBusy} acknowledged={Boolean(acknowledged.exit)} onAcknowledge={() => {haptics.selection(); setAcknowledged(value => ({...value, exit: !value.exit}));}} onSign={() => signScope('exit')} onCheck={() => checkAllowance('exit')} onApprove={() => approveCap('exit')} onFund={() => navigation.navigate('Funding')} />
        </Section>
        <Button label="Request native activation authority" loading={busyKey === 'authority'} disabled={!grants.buy || !grants.exit || grants.buy.state !== 'active' || grants.exit.state !== 'active' || !allowances.buy?.activationReady || !allowances.exit?.activationReady} onPress={publishAuthority} />
      </>}
    </> : null}
    </> : null}
    {limits?.activationBlockers?.length ? <Card tint={colors.orangeTint}><Text style={s.strong}>Current Start blockers</Text>{limits.activationBlockers.map((blocker, index) => <Text key={`${index}-${blocker}`} style={s.body}>• {blocker}</Text>)}</Card> : null}
    {error ? <Notice live tone="rose" title="Setup stopped safely" message={error} /> : null}
    {message ? <Notice live tone="mint" title="Setup progress" message={message} /> : null}
    <Card><Text style={s.strong}>Current execution status</Text><Text style={s.body}>{limits?.liveTradingEnabled
      ? 'This Magic vault has a funded assignment and both trading services currently report their live order and Stop paths ready. Every proposal still needs a fresh risk and venue check.'
      : limits?.managedVaultCapitalUsdc
        ? 'Magic vault capital is recorded, but a live backend or executor check is still blocking Start. Review the blockers above.'
        : 'Fund and activate the Magic-owned vault before checking live trading readiness. Older scoped-grant setup remains separate.'}</Text>{limits?.assignmentReady ? <Button label={limits.liveTradingEnabled ? 'Review live Autopilot Start' : 'Review scheduled analysis Start'} onPress={() => navigation.navigate('AutopilotConfirm')} /> : null}</Card>
    {!limits?.walletReady ? <TextLink label="Review account security" onPress={() => navigation.navigate('Main', {screen: 'Account'})} /> : null}
    {limits && limits.availableCredits <= 0 ? <TextLink label="Review Moeazi credits" onPress={() => navigation.navigate('Credits')} /> : null}
    {hasAssignment ? <TextLink label="Pause assignment and revoke setup authority" onPress={() => navigation.navigate('AutopilotConfirm', {stop: true})} /> : null}
    <TextLink label="Refresh managed readiness" onPress={() => {refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Readiness refresh failed.'));}} />
  </FlowScreen>;
}

const styles = StyleSheet.create({reviewCheck: {minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.xs}});
