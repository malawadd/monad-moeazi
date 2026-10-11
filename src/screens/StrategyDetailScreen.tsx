import React, {useCallback, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, LoadingBlock, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {monadApi} from '../services/monadApi';
import {perplApi} from '../services/perplApi';
import {hasCompletedDeterministicEnrollment} from '../services/strategyEnrollmentHistory';
import {validatePerplRunOwner} from '../services/perplValidation';
import {useApp} from '../state/AppContext';
import type {PerplRun} from '../types/perpl';
import type {StrategyCatalogEntry, StrategyCatalogResponse} from '../types/strategies';
import {colors} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

const OPEN_RUN_STATUSES = new Set(['activation_pending', 'active', 'stopping', 'settling', 'uncertain', 'incomplete_settlement']);

export function StrategyDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {ownerAddress} = useApp();
  const strategyId = String(route.params?.strategyId ?? 'perpl-deterministic');
  const [catalog, setCatalog] = useState<StrategyCatalogResponse | null>(null);
  const [currentRun, setCurrentRun] = useState<PerplRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enrollmentKnown, setEnrollmentKnown] = useState(false);
  const [previouslyEnrolled, setPreviouslyEnrolled] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    let currentKnown = false;
    const [catalogResult, runResult, historyResult] = await Promise.allSettled([
      monadApi.strategies(), perplApi.current(), hasCompletedDeterministicEnrollment(ownerAddress),
    ]);
    if (catalogResult.status === 'fulfilled') setCatalog(catalogResult.value);
    else setError(catalogResult.reason instanceof Error ? catalogResult.reason.message : 'Strategy details could not be loaded.');
    if (runResult.status === 'fulfilled') {
      try {
        if (runResult.value.current && ownerAddress) validatePerplRunOwner(runResult.value.current, ownerAddress);
        setCurrentRun(runResult.value.current); currentKnown = true;
      } catch (reason) {
        setCurrentRun(null); setError(reason instanceof Error ? reason.message : 'Current Perpl status could not be checked.');
      }
    } else {
      setCurrentRun(null); setError(runResult.reason instanceof Error ? runResult.reason.message : 'Current Perpl status could not be checked.');
    }
    if (historyResult.status === 'fulfilled') {
      setPreviouslyEnrolled(historyResult.value); setEnrollmentKnown(currentKnown);
    } else {
      setPreviouslyEnrolled(null); setEnrollmentKnown(false);
      setError(historyResult.reason instanceof Error ? historyResult.reason.message : 'Perpl enrollment history could not be checked.');
    }
    setLoading(false);
  }, [ownerAddress]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const strategy = catalog?.strategies.find(item => item.strategyId === strategyId);
  const activeRun = currentRun && OPEN_RUN_STATUSES.has(currentRun.status.toLowerCase()) ? currentRun : null;
  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }} onBack={() => navigation.goBack()}>
    {loading && !strategy ? <LoadingBlock label="Loading strategy details" lines={3} /> : null}
    {error ? <Notice live tone="orange" title="Strategy details unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {strategy ? <>
      <PageHeader kicker={`Strategy details · ${strategy.creator}`} title={strategy.name}
        copy={strategy.kind === 'deterministic' ? 'A fixed-rule strategy on Perpl Testnet. Selection is separate from enrollment; you approve the exact setup with Mera.' : 'A concept for a possible future strategy. It is not available and has no live execution capability.'} />
      <Card tint={strategy.kind === 'deterministic' ? colors.mintTint : colors.lilacTint}>
        <StatusBadge label={strategy.status === 'available' ? 'Available on Testnet' : 'Planned · unavailable'} tone={strategy.status === 'available' ? 'mint' : 'lilac'} />
        <DataRow label="Strategy ID" value={strategy.strategyId} />
        <DataRow label="Version" value={strategy.version} />
        <DataRow label="Creator" value={strategy.creator} />
        {strategy.kind === 'deterministic' ? <DataRow label="Catalog selection" value="Selected by default · this does not indicate enrollment" /> : null}
        <DataRow label="Moeazi performance fee" value={strategy.fee.description} />
        {strategy.venueFees ? <DataRow label="Perpl venue fees" value="Perpl trading and funding charges are set by Perpl and billed separately." /> : null}
      </Card>
      {strategy.kind === 'deterministic' ? <DeterministicDetails metrics={catalog?.metrics}
        enrollment={activeRun ? 'Enrollment active · run status shown below' : enrollmentLabel(previouslyEnrolled)} /> : <AgenticDetails />}
      {activeRun ? <Card tint={colors.skyTint}>
        <StatusBadge label="Perpl run in progress" tone="sky" />
        <DataRow label="Status" value={activeRun.status.replaceAll('_', ' ')} />
        <Button label="Open Perpl run status" onPress={() => navigation.navigate('PerplStatus')} />
      </Card> : null}
      {strategy.kind === 'deterministic' ? <>
        <Button label="Enable strategy" disabled={Boolean(activeRun) || !enrollmentKnown}
          hint={!enrollmentKnown ? 'Current Perpl status and enrollment history must be checked before setup.' : 'Opens setup for review; does not activate Perpl.'}
          onPress={() => navigation.navigate('PerplSetup')} />
        <Text style={s.body}>Enable opens setup only. It does not enroll or trade. You must review the exact current AUSD transfer and mandate, then approve them with Mera.</Text>
      </> : <Button label="Enable" disabled hint="This planned strategy is unavailable and cannot be enabled." />}
    </> : !loading && !error ? <Notice title="Strategy not found" message="Return to the catalog and choose a listed strategy." tone="orange" /> : null}
  </Screen>;
}

function DeterministicDetails({metrics, enrollment}: {metrics: StrategyCatalogResponse['metrics'] | undefined; enrollment: string}) {
  return <>
    <Card>
      <Text style={s.strong}>How the deterministic rules work</Text>
      <Text style={s.body}>It evaluates short-term price movement and requires the 5-minute direction to agree with the 15-minute trend. It checks fresh observations, executable entry and exit book depth, estimated spread, trading fees, funding, slippage impact, and risk-sized order limits before proposing an entry. It does not use an AI model to choose trades.</Text>
      <DataRow label="Strategy profile" value="Duration soak · deterministic rules" />
      <DataRow label="Markets" value="Current live Perpl Testnet markets shown in the exact setup review" />
      <DataRow label="Your enrollment" value={enrollment} />
      <DataRow label="Cycle limit" value="Up to 15 completed cycles or signed run expiry" />
      <DataRow label="Minimum positive cycle" value="0.01 AUSD net" />
      <DataRow label="Cycle hold window" value="10–30 minutes, subject to exit rules" />
    </Card>
    <Card tint={colors.yellow}>
      <Text style={s.strong}>Risk and collateral limits</Text>
      <DataRow label="Starting collateral" value="100 AUSD fixed for this experiment" />
      <DataRow label="Maximum notional" value="30 AUSD; the signed mandate or live book may lower it" />
      <DataRow label="Maximum margin" value="25 AUSD" />
      <DataRow label="Maximum leverage" value="4×; the live market and signed mandate can lower it" />
      <DataRow label="Planned loss limit" value="0.15 AUSD per cycle" />
      <DataRow label="Duration" value="10–720 minutes · default 120 minutes" />
      <DataRow label="Owner controls" value="Mera-approved setup, owner stop, and available recovery flow" />
      <Text style={s.body}>Collateral and trading losses remain at risk. Limits are not a promise that losses cannot exceed the planned amount, especially during execution or settlement problems.</Text>
    </Card>
    <Card tint={colors.mintTint}>
      <Text style={s.strong}>Verified Testnet metrics</Text>
      {metrics ? <>
        <DataRow label="Net realized PnL" value={formatSignedAUsd(metrics.netRealizedPnlUnits)} />
        <DataRow label="Verified completed cycles" value={String(metrics.verifiedCycleCount)} />
        <DataRow label="Unique activated wallets" value={String(metrics.uniqueActivatedWalletCount)} />
        <DataRow label="As of" value={formatObservedAt(metrics.observedAt)} />
        <Text style={s.body}>Aggregated finalized realized AUSD cycle results from verified activations. Prepared, failed, manual, and unrealized activity is excluded.</Text>
      </> : <Text style={s.body}>Not available. The catalog could not verify aggregate results right now.</Text>}
    </Card>
    <Card>
      <Text style={s.strong}>Fee</Text>
      <DataRow label="Moeazi performance fee" value="0%" />
      <DataRow label="Perpl trading and funding fees" value="Set by Perpl; shown separately in the reviewed setup and run activity" />
    </Card>
  </>;
}

function AgenticDetails() {
  return <>
    <Card tint={colors.lilacTint}>
      <Text style={s.strong}>Concept only · no live agentic system</Text>
      <Text style={s.body}>A possible future design could analyze market conditions and relevant context, then send its analysis to a replaceable decision provider. A reviewed risk policy would constrain any proposed action. Before any trading, the owner would have to give explicit Mera opt-in through an exact review. Activity would show what happened, with owner stop and recovery controls available.</Text>
      <Text style={s.body}>These are design goals, not capabilities in the current app. There is no live model, trading authority, or agentic execution path to enable.</Text>
    </Card>
    <Card>
      <Text style={s.strong}>What is not announced</Text>
      <DataRow label="Live decision model" value="Not announced" />
      <DataRow label="Performance history" value="Not announced" />
      <DataRow label="Collateral and custody terms" value="Not announced" />
      <DataRow label="Supported markets" value="Not announced" />
      <DataRow label="Launch date" value="Not announced" />
      <Text style={s.body}>Returns are not guaranteed.</Text>
    </Card>
    <Card tint={colors.yellow}>
      <Text style={s.strong}>Planned fee only</Text>
      <DataRow label="Future performance fee" value="2% of positive net realized profit only" />
      <DataRow label="Loss or unrealized gain" value="No fee" />
      <DataRow label="Charged now" value="No. The strategy is unavailable." />
    </Card>
  </>;
}

function formatSignedAUsd(units: string) {
  try {
    const amount = BigInt(units); const abs = amount < 0n ? -amount : amount;
    const fraction = (abs % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
    const sign = amount > 0n ? '+' : amount < 0n ? '−' : '';
    return `${sign}${abs / 1_000_000n}${fraction ? `.${fraction}` : ''} AUSD`;
  } catch { return 'Unavailable'; }
}

function enrollmentLabel(previouslyEnrolled: boolean | null) {
  if (previouslyEnrolled === null) return 'Enrollment history unavailable';
  return previouslyEnrolled ? 'Previously enrolled · new run needs Mera approval' : 'Not enrolled';
}

function formatObservedAt(value: number) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unavailable';
}
