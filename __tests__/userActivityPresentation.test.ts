import {buildUserActivityItems, isHiddenUserActivityDiagnostic} from '../src/services/userActivityPresentation';
import type {MonadActivityEvent} from '../src/types/monad';

const operationId = 'aa58b552-cc08-4a04-8553-36d663c031cd';
const txHash = `0x${'f'.repeat(64)}`;

function event(id: string, kind: string, status: string, occurredAt: string, overrides: Partial<MonadActivityEvent> = {}): MonadActivityEvent {
  return {id, kind, status, occurredAt, title: kind, summary: `${status} summary`, fundsMoved: false, ...overrides};
}

test('hides optimizer diagnostics but keeps material recovery blockers and actual result or failure events', () => {
  const scan = event('scan-1', 'perpl_direct_optimizer', 'optimizer_market_scan_not_due', '2026-10-12T12:00:00Z');
  const proposedScan = event('scan-2', 'perpl_optimizer_scanner', 'proposed', '2026-10-12T12:00:01Z');
  const decision = event('decision-1', 'perpl_direct_optimizer', 'optimizer_momentum_entry', '2026-10-12T12:00:02Z');
  const recoveryBlock = event('block-1', 'perpl_direct_optimizer', 'optimizer_open_position_recovery_seed_missing', '2026-10-12T12:00:03Z');
  const cycle = event('cycle-1', 'perpl_optimizer_cycle_completed', 'completed', '2026-10-12T12:00:04Z');
  const failedTrade = event('order-1', 'perpl_order_failed', 'failed', '2026-10-12T12:00:05Z');

  expect(isHiddenUserActivityDiagnostic(scan)).toBe(true);
  expect(isHiddenUserActivityDiagnostic(proposedScan)).toBe(true);
  expect(isHiddenUserActivityDiagnostic(decision)).toBe(true);
  expect(isHiddenUserActivityDiagnostic(recoveryBlock)).toBe(false);
  expect(buildUserActivityItems([scan, proposedScan, decision, recoveryBlock, cycle, failedTrade]).map(item => item.event.id))
    .toEqual(['order-1', 'cycle-1', 'block-1']);
});

test('groups swap lifecycle stages across loaded pages by operation ID and keeps chronological failure evidence', () => {
  const prepared = event(`operation:${operationId}:prepared`, 'swap', 'prepared', '2026-10-12T12:00:00Z');
  const verified = event(`operation:${operationId}:authorized`, 'swap', 'verified', '2026-10-12T12:00:01Z');
  const submitted = event(`operation:${operationId}:submitted`, 'swap', 'submitted', '2026-10-12T12:00:02Z');
  const failed = event(`operation:${operationId}:failed:${txHash}`, 'swap', 'failed', '2026-10-12T12:00:03Z', {transactionHash: txHash});
  const transfer = event('transfer-1', 'send_mon', 'finalized', '2026-10-12T12:00:04Z');

  const items = buildUserActivityItems([submitted, transfer, prepared, verified, failed, submitted]);
  expect(items).toHaveLength(2);
  expect(items[0]!.event.id).toBe('transfer-1');
  const grouped = items[1]!;
  expect(grouped.key).toBe(`swap:${operationId}`);
  expect(grouped.lifecycle?.operationId).toBe(operationId);
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
