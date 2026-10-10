import React from 'react';
import {Text} from 'react-native';
import {Card, DataRow, StatusBadge} from './Ui';
import {formatMonadUnits} from '../services/monadFormatting';
import type {PerplRun} from '../types/perpl';
import {screenStyles as s} from '../theme/screenStyles';

export function PerplOptimizerCard({run, compact = false}: {run: PerplRun; compact?: boolean}) {
  const optimizer = run.optimizer;
  if (!optimizer) return null;
  const status = optimizer.status === 'target_reached_awaiting_settlement' ? 'Target reached, awaiting settlement'
    : optimizer.status === 'cycle_cap_reached_awaiting_settlement' ? 'Cycle cap reached, awaiting settlement'
    : optimizer.status === 'running' ? 'Running' : humanize(optimizer.status);
  const cycles = run.cycles ?? [];
  const recent = compact ? cycles.slice(-1) : cycles.slice(-3).reverse();
  const active: any = optimizer.activeCycle;
  return <Card tint="#F2EFFB">
    <Text style={s.strong}>Deterministic optimizer · {optimizer.version}</Text>
    <StatusBadge label={status} tone={optimizer.successTargetReached ? 'mint' : 'lilac'} />
    <DataRow label="Completed cycles" value={`${optimizer.cycleCount}/${optimizer.cycleLimit}`} />
    <DataRow label="Success target" value={`${optimizer.targetWinStreak} consecutive cycles with at least ${formatMonadUnits(optimizer.minimumPositivePnlUnits, run.collateral.decimals)} AUSD net each · current streak ${optimizer.winStreak}`} />
    <DataRow label="Cumulative realized PnL" value={`${signedUnits(run.realizedPnlUnits ?? '0', run.collateral.decimals)} AUSD`} />
    {!compact ? <>
      <DataRow label="Current parameters" value={`${optimizer.params.momentumThresholdBps} bps momentum · ${optimizer.params.executionConservatismBps / 100}% execution conservatism`} />
      <DataRow label="Market and exit checks" value={`Scan continues during open positions · every ${(optimizer.scanner?.cadenceMs ?? 300_000) / 60_000} min · executable exit checks every minute`} />
      {optimizer.scanner ? <DataRow label="Scanner" value={`${optimizer.scanner.totalScans} scans · ${optimizer.scanner.totalProposals} proposals · ${optimizer.scanner.consecutiveNoProposal} scans without a proposal`} /> : null}
      {optimizer.scanner?.lastProposal ? <DataRow label="Latest proposal" value={`${String(optimizer.scanner.lastProposal.marketId)} ${String(optimizer.scanner.lastProposal.side)}${optimizer.scanner.lastProposal.blockedByOpenPosition ? ' · deferred while position open' : ''}`} /> : null}
      {active ? <DataRow label="Open cycle" value={`${String(active.symbol ?? `Market ${active.marketId ?? '—'}`)} · ${String(active.leverage ?? '—')}× · margin ${formatMonadUnits(String(active.marginUnits ?? '0'), run.collateral.decimals)} AUSD`} /> : null}
      {run.journal?.length ? <Text style={s.body}>Latest journal: {String(run.journal[run.journal.length - 1]?.workedOrFailed ?? 'cycle recorded')}. {run.journal[run.journal.length - 1]?.changed ? `Changed ${String(run.journal[run.journal.length - 1]?.changed)} for the next cycle.` : 'Parameters stayed fixed for the next cycle.'}</Text> : null}
    </> : null}
    {recent.map((cycle, index) => {
      const number = String(cycle.cycleNumber ?? index + 1);
      const market: any = cycle.selectedMarket;
      const label = `Cycle ${number}${market?.symbol ?? cycle.symbol ? ` · ${String(market?.symbol ?? cycle.symbol)}` : ''}`;
      return <DataRow key={String(cycle.cycleId ?? number)} label={label}
        value={`${signedUnits(String(cycle.realizedPnlUnits ?? '0'), run.collateral.decimals)} AUSD net · fees ${formatMonadUnits(String(cycle.feesUnits ?? '0'), run.collateral.decimals)} · gas ${formatMonadUnits(String(cycle.operatorGasWei ?? '0'), 18)} MON`} />;
    })}
  </Card>;
}

function signedUnits(units: string, decimals: number) {
  try { const value = BigInt(units); return `${value > 0n ? '+' : value < 0n ? '−' : ''}${formatMonadUnits((value < 0n ? -value : value).toString(), decimals)}`; }
  catch { return 'Unavailable'; }
}
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
