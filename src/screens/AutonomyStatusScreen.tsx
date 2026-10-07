import React, {useCallback, useRef, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, LoadingBlock, Notice, PageHeader, Screen} from '../components/Ui';
import {autonomyApi} from '../services/autonomyApi';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import {validateAutonomyOwnerChain} from '../services/autonomyValidation';
import {AutonomyRecoveryControl} from './AutonomyRecoveryControl';
import {useApp} from '../state/AppContext';
import type {AutonomyEvent, AutonomyRun} from '../types/autonomyTrading';
import {screenStyles as s} from '../theme/screenStyles';

const TERMINAL = new Set(['completed', 'incomplete_settlement', 'recovered', 'expired', 'failed']);

export function AutonomyStatusScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [current, setCurrent] = useState<AutonomyRun | null>(null);
  const [history, setHistory] = useState<AutonomyRun[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError('');
    try {
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      const [currentResponse, historyResponse] = await Promise.all([autonomyApi.current(), autonomyApi.history()]);
      if (currentResponse.current) validateAutonomyOwnerChain(ownerAddress, currentResponse.current);
      historyResponse.runs.forEach(run => validateAutonomyOwnerChain(ownerAddress, run));
      setCurrent(currentResponse.current);
      setHistory(historyResponse.runs);
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Autonomous run status could not be loaded.');
    } finally { inFlight.current = false; setLoading(false); }
  }, [ownerAddress]);

  useFocusEffect(useCallback(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [refresh]));

  const canEnroll = !current || TERMINAL.has(current.status);
  const priorRuns = history.filter(run => run.enrollmentId !== current?.enrollmentId);
  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker="Autonomous trading · testnet only" title="Run status & history" copy="Updates every 15 seconds while this screen is open. Orders, prices, fills, and settlement details are reported from Monad Testnet receipts." />
    {error ? <Notice live tone="rose" title="Status is unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {loading && !current && !history.length ? <LoadingBlock label="Loading autonomous run history" lines={3} /> : null}
    {current ? <>
      <RunCard run={current} />
      <AutonomyRecoveryControl run={current} navigation={navigation} />
    </> : <Card>
      <Text style={s.strong}>No current autonomous run</Text>
      <Text style={s.body}>Your manual wallet trades remain separate. A new autonomous run needs one fresh Mera approval for its amount and duration.</Text>
    </Card>}
    {current?.latestDecision ? <Card>
      <Text style={s.strong}>Latest finalized price decision</Text>
      <DataRow label="Action" value={current.latestDecision.action?.toUpperCase() ?? 'Not returned'} />
      <DataRow label="Reason" value={current.latestDecision.reasonCode ?? 'Not returned'} />
      <DataRow label="Rule version" value={current.latestDecision.ruleVersion ?? 'Not returned'} />
      <DataRow label="Evaluated at" value={formatMonadTimestamp(current.latestDecision.evaluatedAt ?? '')} />
      <DataRow label="Finalized block" value={current.latestDecision.finalizedBlockNumber ?? 'Not returned'} />
      {current.latestDecision.signal ? <Text style={s.body}>{signalSummary(current.latestDecision.signal)}</Text> : null}
      {current.latestDecision.rejected?.map(item => <Text key={`${item.tokenIndex}:${item.reasonCode}`} style={s.body}>
        Token {item.tokenIndex + 1} skipped: {item.reasonCode}
      </Text>)}
    </Card> : null}
    {current?.events?.length ? <Card>
      <Text style={s.strong}>Current run activity</Text>
      {current.events.slice(0, 12).map((event, index) => <EventRow key={event.id ?? `${event.timestamp}:${event.type}:${index}`} event={event} />)}
    </Card> : null}
    {priorRuns.length ? <Card>
      <Text style={s.strong}>Previous runs</Text>
      {priorRuns.map(run => <RunSummary key={run.enrollmentId} run={run} navigation={navigation} />)}
    </Card> : null}
    {updatedAt ? <Text style={s.meta}>Last refreshed {updatedAt} · finalized-chain data</Text> : null}
    {canEnroll ? <Button label="Choose Spot or Perp" onPress={() => navigation.navigate('AutonomyChoice')} />
      : <Button label="A run is still active" disabled />}
    <Button label="Manual markets and trade review" variant="secondary" onPress={() => navigation.navigate('Main', {screen: 'Markets'})} />
  </Screen>;
}

function RunCard({run}: {run: AutonomyRun}) {
  return <Card>
    <Text style={s.strong}>{humanize(run.status)}</Text>
    <DataRow label="Run" value={run.runId} />
    <DataRow label="Owner vault" value={run.vaultAddress} />
    <DataRow label="Network" value="Monad Testnet · 10143" />
    <DataRow label="Cycle count" value={`${run.cyclesCompleted} of ${run.maxCycles}`} />
    <DataRow label="Starting USDC" value={`${formatMonadUnits(run.startingUsdcUnits, 6)} USDC`} />
    <DataRow label="Available USDC" value={`${formatMonadUnits(run.availableUsdcUnits, 6)} USDC`} />
    <DataRow label="Realized USDC profit / loss" value={`${signedUsdc(run.realizedPnlUsdcUnits)} USDC`} />
    <DataRow label="Operator-paid gas" value={`${formatMonadUnits(run.operatorGasMonWei, 18)} MON · your gas cost is 0`} />
    <DataRow label="Expires" value={run.expiresAt ? formatMonadTimestamp(run.expiresAt) : 'Waiting for finalized vault activation'} />
    {run.openPosition ? <>
      <DataRow label="Open position" value={`${run.openPosition.tokenSymbol} · cycle ${run.openPosition.cycle}`} />
      <DataRow label="Mock-token amount" value={`${run.openPosition.amountUnits} raw units`} />
      <DataRow label="Entry price" value={`${run.openPosition.entryPriceUsdcPerTokenWad} USDC/token · WAD`} />
      <DataRow label="Post-buy peak" value={`${run.openPosition.peakPriceUsdcPerTokenWad} USDC/token · WAD`} />
    </> : null}
    <Text style={s.body}>Realized USDC profit or loss is reported separately from the operator's MON gas. Any loss, fees, and price impact are reflected in your returned assets.</Text>
  </Card>;
}

function EventRow({event}: {event: AutonomyEvent}) {
  const finalizedFill = Boolean(event.txHash && event.finalizedBlockNumber);
  return <Card tint="#FFF8E9">
    <DataRow label={event.type.replace(/_/g, ' ')} value={humanize(event.status)} />
    <DataRow label="Recorded" value={formatMonadTimestamp(event.timestamp)} />
    <Text style={s.body}>{event.summary}</Text>
    {event.signal ? <Text style={s.body}>Signal: {signalSummary(event.signal)}</Text> : null}
    {event.ruleVersion ? <DataRow label="Rule version" value={event.ruleVersion} /> : null}
    {finalizedFill && event.amountInUnits ? <DataRow label="Finalized input" value={`${event.amountInUnits} raw units`} /> : null}
    {finalizedFill && event.amountOutUnits ? <DataRow label="Finalized output" value={`${event.amountOutUnits} raw units`} /> : null}
    {event.finalizedBlockNumber ? <DataRow label="Finalized block" value={event.finalizedBlockNumber} /> : null}
    {event.txHash ? <Text selectable style={s.body}>Transaction: {event.txHash}</Text> : null}
  </Card>;
}

function RunSummary({run, navigation}: {run: AutonomyRun; navigation: any}) {
  return <Card tint="#EEF7FF">
    <DataRow label="Run status" value={humanize(run.status)} />
    <DataRow label="USDC profit / loss" value={`${signedUsdc(run.realizedPnlUsdcUnits)} USDC`} />
    <DataRow label="Cycles" value={`${run.cyclesCompleted} of ${run.maxCycles}`} />
    <DataRow label="Vault" value={run.vaultAddress} />
    {run.events.slice(0, 3).map((event, index) => <EventRow key={event.id ?? `${event.timestamp}:${event.type}:${index}`} event={event} />)}
    <AutonomyRecoveryControl run={run} navigation={navigation} />
  </Card>;
}

function signedUsdc(units: string) {
  try {
    const value = BigInt(units);
    const formatted = formatMonadUnits(value < 0n ? (-value).toString() : value.toString(), 6);
    return `${value > 0n ? '+' : value < 0n ? '−' : ''}${formatted}`;
  } catch { return 'Unavailable'; }
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function signalSummary(signal: {tokenIndex: number; changeBps: number; priceUsdcPerTokenWad: string}) {
  return `Token ${signal.tokenIndex + 1} · ${signal.changeBps} bps · ${signal.priceUsdcPerTokenWad} USDC/token (WAD)`;
}
