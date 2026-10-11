import React, {useCallback, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
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

const DEFAULT_STRATEGY_ID = 'perpl-deterministic';
const OPEN_RUN_STATUSES = new Set(['activation_pending', 'active', 'stopping', 'settling', 'uncertain', 'incomplete_settlement']);

export function StrategiesScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [catalog, setCatalog] = useState<StrategyCatalogResponse | null>(null);
  const [currentRun, setCurrentRun] = useState<PerplRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [runError, setRunError] = useState('');
  const [previouslyEnrolled, setPreviouslyEnrolled] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setCatalogError(''); setRunError('');
    const [catalogResult, runResult, historyResult] = await Promise.allSettled([
      monadApi.strategies(), perplApi.current(), hasCompletedDeterministicEnrollment(ownerAddress),
    ]);
    if (catalogResult.status === 'fulfilled') setCatalog(catalogResult.value);
    else setCatalogError(catalogResult.reason instanceof Error ? catalogResult.reason.message : 'Strategy catalog could not be loaded.');
    if (runResult.status === 'fulfilled') {
      try {
        if (runResult.value.current && ownerAddress) validatePerplRunOwner(runResult.value.current, ownerAddress);
        setCurrentRun(runResult.value.current);
      } catch (reason) {
        setCurrentRun(null); setRunError(reason instanceof Error ? reason.message : 'Perpl run status could not be checked.');
      }
    } else { setCurrentRun(null); setRunError(runResult.reason instanceof Error ? runResult.reason.message : 'Perpl run status could not be checked.'); }
    if (historyResult.status === 'fulfilled') setPreviouslyEnrolled(historyResult.value);
    else { setPreviouslyEnrolled(null); setRunError(historyResult.reason instanceof Error ? historyResult.reason.message : 'Perpl enrollment history could not be checked.'); }
    setLoading(false);
  }, [ownerAddress]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const deterministic = catalog?.strategies.find(item => item.strategyId === DEFAULT_STRATEGY_ID);
  const activeRun = currentRun && OPEN_RUN_STATUSES.has(currentRun.status.toLowerCase()) ? currentRun : null;

  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Strategies · Monad Testnet" title="Strategy marketplace" copy="Perpl deterministic is selected by default, but selection does not enroll it. Setup remains pending until you review the exact current terms and approve them with Mera." />
    {loading && !catalog ? <LoadingBlock label="Loading strategy catalog" lines={3} /> : null}
    {catalogError ? <Notice live tone="orange" title="Strategy catalog unavailable" message={catalogError} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {activeRun ? <Card tint={colors.skyTint}>
      <StatusBadge label="Perpl run in progress" tone="sky" />
      <DataRow label="Run status" value={activeRun.status.replaceAll('_', ' ')} />
      <DataRow label="Strategy" value={activeRun.optimizer?.version ?? 'Perpl Testnet'} />
      <Button label="Open Perpl run status" onPress={() => navigation.navigate('PerplStatus')} />
    </Card> : null}
    {runError ? <Notice live tone="orange" title="Could not check Perpl status" message={runError} actionLabel="Check again" onAction={() => { void refresh(); }} /> : null}
    {deterministic && catalog?.metrics ? <Card tint={colors.mintTint}>
      <StatusBadge label="Verified Testnet results" tone="mint" />
      <Text style={s.strong}>Perpl deterministic · aggregate net realized PnL</Text>
      <DataRow label="Net realized PnL" value={formatSignedAUsd(catalog.metrics.netRealizedPnlUnits)} />
      <DataRow label="Unique activated wallets" value={String(catalog.metrics.uniqueActivatedWalletCount)} />
      <DataRow label="Verified realized cycles" value={String(catalog.metrics.verifiedCycleCount)} />
      <DataRow label="As of" value={formatObservedAt(catalog.metrics.observedAt)} />
      <Text style={s.body}>Only finalized realized AUSD cycles from verified activations count. Open-position PnL and unsigned or failed setup attempts are excluded.</Text>
    </Card> : deterministic ? <Card>
      <StatusBadge label="Verified Testnet results unavailable" tone="orange" />
      <Text style={s.body}>The catalog could not verify public Perpl result metrics right now.</Text>
    </Card> : null}
    {catalog?.strategies.map(strategy => <StrategyCard key={strategy.strategyId} strategy={strategy}
      selected={strategy.strategyId === DEFAULT_STRATEGY_ID}
      onSelect={() => navigation.navigate('StrategyDetail', {strategyId: strategy.strategyId})} />)}
    <Card tint={colors.yellow}>
      <Text style={s.strong}>{activeRun ? 'Enrollment active · run status above' : enrollmentLabel(previouslyEnrolled)}</Text>
      <Text style={s.body}>Perpl deterministic is selected by default and has a 0% Moeazi fee. Perpl trading and funding fees are separate venue charges. Review its strategy details before deciding whether to open setup.</Text>
    </Card>
    <Button label="Read legacy agent status" variant="secondary" onPress={() => navigation.navigate('AgentStatus')} />
  </Screen>;
}

function StrategyCard({strategy, selected, onSelect}: {strategy: StrategyCatalogEntry; selected: boolean; onSelect: () => void}) {
  const tint = strategy.kind === 'deterministic' ? colors.paperAlt : colors.lilacTint;
  return <Pressable accessibilityRole="button" accessibilityLabel={`${strategy.name} strategy`}
    accessibilityState={{selected}} onPress={onSelect}>
    <Card tint={selected ? colors.yellow : tint}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12}}>
        <Text style={s.strong}>{strategy.name}</Text>
        <StatusBadge label={selected ? 'Selected by default' : strategy.status === 'available' ? 'Available' : 'Planned'}
          tone={strategy.status === 'available' ? 'mint' : 'lilac'} />
      </View>
      <DataRow label="Creator" value={strategy.creator} />
      <DataRow label="Moeazi fee" value={strategy.fee.description} />
      {strategy.venueFees ? <DataRow label="Venue fees" value="Perpl trading and funding fees are separate." /> : null}
      <Text style={s.body}>{strategy.description}</Text>
      <Text style={s.strong}>View strategy details →</Text>
    </Card>
  </Pressable>;
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
