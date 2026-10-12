import {buildUserActivityItems, filterAutonomousActivity, isHiddenUserActivityDiagnostic, userActivityRouteParams, userActivityTitle} from '../src/services/userActivityPresentation';
import type {MonadActivityEvent} from '../src/types/monad';

const operationId = 'aa58b552-cc08-4a04-8553-36d663c031cd';
const txHash = `0x${'f'.repeat(64)}`;

function event(id: string, kind: string, status: string, occurredAt: string, overrides: Partial<MonadActivityEvent> = {}): MonadActivityEvent {
  return {id, kind, status, occurredAt, title: kind, summary: `${status} summary`, fundsMoved: false, ...overrides};
}

test('groups optimizer and scanner updates by exact venue and run while keeping material recovery blockers visible', () => {
  const runId = '11223344-5566-7788-99aa-bbccddeeff00';
  const otherRun = 'aa223344-5566-7788-99aa-bbccddeeff00';
  const venueId = 'perpl-direct-testnet-v1';
  const runEvent = (idRun: string, kind: string, status: string, second: number,
    venue: NonNullable<MonadActivityEvent['venueId']> = venueId) => event(
    `${venue}:${idRun}:optimizer:${second}`, kind, status, `2026-10-12T12:00:0${second}Z`, {venueId: venue},
  );
  const scan = runEvent(runId, 'perpl_optimizer_scanner', 'optimizer_market_scan_not_due', 0);
  const decision = runEvent(runId, 'perpl_direct_optimizer', 'optimizer_momentum_entry', 1);
  const cycle = runEvent(runId, 'perpl_optimizer_cycle_completed', 'completed', 2);
  const separateRun = runEvent(otherRun, 'perpl_optimizer_scanner', 'proposed', 3);
  const separateVenue = runEvent(runId, 'perpl_optimizer_scanner', 'proposed', 4, 'perpl-testnet-v1');
  const recoveryBlock = event(`${venueId}:${runId}:optimizer:block`, 'perpl_direct_optimizer',
    'optimizer_open_position_recovery_seed_missing', '2026-10-12T12:00:05Z', {venueId});
  const failedTrade = event('order-1', 'perpl_order_failed', 'failed', '2026-10-12T12:00:06Z');

  expect([scan, decision, cycle, separateRun, separateVenue].every(item => !isHiddenUserActivityDiagnostic(item))).toBe(true);
  expect(isHiddenUserActivityDiagnostic(recoveryBlock)).toBe(false);
  const items = buildUserActivityItems([scan, decision, cycle, separateRun, separateVenue, recoveryBlock, failedTrade]);
  expect(items.filter(item => item.lifecycle?.family === 'autonomous_updates')).toHaveLength(3);
  expect(items.find(item => item.lifecycle?.family === 'autonomous_updates' && item.lifecycle.runId === runId
    && item.lifecycle.venueId === venueId)?.lifecycle?.events.map(item => item.id)).toEqual([scan.id, decision.id, cycle.id]);
  expect(items.some(item => item.event.id === recoveryBlock.id && !item.lifecycle)).toBe(true);
  expect(items.some(item => item.event.id === failedTrade.id)).toBe(true);
});

test('groups swap lifecycle stages across loaded pages by operation ID and keeps chronological failure evidence', () => {
  const sameTime = '2026-10-12T12:00:00Z';
  const prepared = event(`operation:${operationId}:prepared`, 'swap', 'prepared', sameTime);
  const verified = event(`operation:${operationId}:authorized`, 'swap', 'verified', sameTime);
  const submitted = event(`operation:${operationId}:submitted`, 'swap', 'submitted', sameTime);
  const failed = event(`operation:${operationId}:failed:${txHash}`, 'swap', 'failed', sameTime, {transactionHash: txHash});
  const transfer = event('transfer-1', 'send_mon', 'finalized', '2026-10-12T12:00:04Z');

  const items = buildUserActivityItems([submitted, transfer, prepared, verified, failed, submitted]);
  expect(items).toHaveLength(2);
  expect(items[0]!.event.id).toBe('transfer-1');
  const grouped = items[1]!;
  expect(grouped.key).toBe(`swap:${operationId}`);
  expect(grouped.lifecycle).toMatchObject({family: 'wallet_swap', operationId});
  expect(grouped.lifecycle?.events.map(item => item.status)).toEqual(['prepared', 'verified', 'submitted', 'failed']);
  expect(grouped.event.status).toBe('failed');
  expect(grouped.event.transactionHash).toBe(txHash);
});

test('different swap operations remain separate and unknown non-swap failures remain visible', () => {
  const otherOperation = '11223344-5566-7788-99aa-bbccddeeff00';
  const first = event(`operation:${operationId}:finalized:0x${'a'.repeat(64)}`, 'wallet_swap', 'finalized', '2026-10-12T12:00:00Z');
  const second = event(`operation:${otherOperation}:submitted`, 'swap', 'submitted', '2026-10-12T12:00:01Z');
  const failure = event('action-9', 'send_usdc_failed', 'failed', '2026-10-12T12:00:02Z');
  const items = buildUserActivityItems([first, second, failure]);

  expect(items).toHaveLength(3);
  expect(items.filter(item => item.lifecycle)).toHaveLength(2);
  expect(items[0]!.event.id).toBe('action-9');
});

test('groups manual Perpl order stages by operation ID but leaves account operations separate', () => {
  const otherOperation = '11223344-5566-7788-99aa-bbccddeeff00';
  const venueId = 'perpl-direct-testnet-v1';
  const prepared = event(`manual-perpl:${operationId}:prepared`, 'manual_perpl_prepared', 'prepared', '2026-10-12T12:00:00Z', {
    venueId, summary: 'Manual Perpl limit entry prepared',
  });
  const submitted = event(`manual-perpl:${operationId}:submitted`, 'manual_perpl_submitted', 'submitted', '2026-10-12T12:00:01Z', {venueId});
  const finalized = event(`manual-perpl:${operationId}:finalized`, 'manual_perpl_finalized', 'finalized', '2026-10-12T12:00:02Z', {
    venueId, details: [{label: 'requestId', value: '42'}],
  });
  const approval = event(`manual-perpl:${otherOperation}:prepared`, 'manual_perpl_prepared', 'prepared', '2026-10-12T12:00:03Z', {
    venueId, summary: 'Manual Perpl approve collateral prepared',
  });

  const items = buildUserActivityItems([finalized, approval, submitted, prepared]);
  expect(items).toHaveLength(2);
  const lifecycle = items.find(item => item.lifecycle?.family === 'manual_perpl')!;
  expect(lifecycle.event.id).toBe(finalized.id);
  expect(lifecycle.lifecycle).toMatchObject({family: 'manual_perpl', operationId});
  expect(lifecycle.lifecycle?.events.map(item => item.status)).toEqual(['prepared', 'submitted', 'finalized']);
  expect(userActivityTitle(lifecycle)).toBe('Manual Perpl order');
  expect(userActivityRouteParams(lifecycle)).toEqual({itemId: finalized.id, manualPerplOperationId: operationId});
  expect(items.find(item => item.event.id === approval.id)?.lifecycle).toBeUndefined();
});

test('autonomous Perpl groups exact venue-run-request identity and never collapses a run', () => {
  const runId = '11223344-5566-7788-99aa-bbccddeeff00';
  const venueId = 'perpl-direct-testnet-v1';
  const stage = (requestId: number, status: string, time: number, detailRequestId = requestId) => event(
    `${venueId}:${runId}:order:${requestId}:${status}`, `perpl_order_${status}`, status,
    `2026-10-12T12:00:0${time}Z`, {venueId, details: [{label: 'requestId', value: String(detailRequestId)}]},
  );
  const firstPrepared = stage(7, 'prepared', 0);
  const firstSubmitted = stage(7, 'submitted', 1);
  const firstFinal = stage(7, 'finalized', 2);
  const secondOrder = stage(8, 'finalized', 3);
  const mismatchedDetails = stage(9, 'finalized', 4, 10);

  const items = buildUserActivityItems([firstFinal, secondOrder, firstSubmitted, mismatchedDetails, firstPrepared]);
  expect(items).toHaveLength(3);
  expect(items.map(item => item.lifecycle?.family ?? 'loose')).toEqual(['loose', 'autonomous_perpl', 'autonomous_perpl']);
  const firstGroup = items.find(item => item.lifecycle?.family === 'autonomous_perpl'
    && item.lifecycle.requestId === 7)!;
  expect(firstGroup.lifecycle?.events.map(item => item.status)).toEqual(['prepared', 'submitted', 'finalized']);
  expect(userActivityTitle(firstGroup)).toBe('Autonomous Perpl order');
  expect(userActivityRouteParams(firstGroup)).toEqual({itemId: firstFinal.id,
    perplOrder: {venueId, runId, requestId: 7}});
});

test('hides duplicate direct worker summaries without hiding finalized cycle results', () => {
  const summaries = ['finalized', 'no_fill', 'failed'].map((phase, index) => event(
    `worker-${index}`, `perpl_direct_order_${phase}`, phase, `2026-10-12T12:00:0${index}Z`, {venueId: 'perpl-direct-testnet-v1'},
  ));
  const cycle = event('cycle-final', 'perpl_optimizer_cycle_completed', 'completed', '2026-10-12T12:00:04Z');
  const order = event('perpl-direct-testnet-v1:11223344-5566-7788-99aa-bbccddeeff00:order:7:finalized',
    'perpl_order_finalized', 'finalized', '2026-10-12T12:00:05Z', {venueId: 'perpl-direct-testnet-v1'});

  expect(summaries.every(isHiddenUserActivityDiagnostic)).toBe(true);
  expect(buildUserActivityItems([...summaries, cycle, order]).map(item => item.event.id)).toEqual([order.id, cycle.id]);
});

test('autonomous visibility preference hides only grouped background checks, not orders or material blockers', () => {
  const runId = '11223344-5566-7788-99aa-bbccddeeff00';
  const venueId = 'perpl-direct-testnet-v1';
  const check = event(`${venueId}:${runId}:optimizer:1`, 'perpl_direct_optimizer', 'optimizer_momentum_entry', '2026-10-12T12:00:00Z', {venueId});
  const blocker = event(`${venueId}:${runId}:optimizer:2`, 'perpl_direct_optimizer', 'perpl_direct_execution_disabled', '2026-10-12T12:00:01Z', {venueId});
  const order = event(`${venueId}:${runId}:order:7:finalized`, 'perpl_order_finalized', 'finalized', '2026-10-12T12:00:02Z', {venueId});
  const swap = event(`operation:${operationId}:finalized`, 'wallet_swap', 'finalized', '2026-10-12T12:00:03Z');
  const items = buildUserActivityItems([check, blocker, order, swap]);
  expect(filterAutonomousActivity(items, true)).toHaveLength(items.length);
  expect(filterAutonomousActivity(items, false).map(item => item.event.id).sort()).toEqual([blocker.id, order.id, swap.id].sort());
});
