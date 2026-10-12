import type {MonadActivityEvent} from '../types/monad';

export type UserActivityItem = {
  key: string;
  event: MonadActivityEvent;
  lifecycle?: {operationId: string; events: MonadActivityEvent[]};
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SWAP_STAGE = new RegExp(`^operation:(${UUID}):(prepared|authorized|submitted|uncertain|expired|executed|finalized|failed)(?::0x[0-9a-f]{64})?$`, 'i');
const STAGE_ORDER: Record<string, number> = {
  prepared: 0, authorized: 1, submitted: 2, uncertain: 3, executed: 4,
  finalized: 5, failed: 5, expired: 5,
};
const MATERIAL_OPTIMIZER_REASONS = new Set([
  'optimizer_open_position_recovery_seed_missing',
  'optimizer_active_cycle_missing',
  'perpl_direct_market_missing',
  'perpl_direct_execution_disabled',
]);

export function isHiddenUserActivityDiagnostic(event: MonadActivityEvent) {
  if (event.kind === 'perpl_optimizer_scanner') return true;
  return event.kind === 'perpl_direct_optimizer' && !MATERIAL_OPTIMIZER_REASONS.has(event.status);
}

function swapOperationId(event: MonadActivityEvent): {operationId: string; stage: string} | null {
  if (event.kind !== 'swap' && event.kind !== 'wallet_swap') return null;
  const match = SWAP_STAGE.exec(event.id);
  return match ? {operationId: match[1]!, stage: match[2]!.toLowerCase()} : null;
}

function timestamp(event: MonadActivityEvent) {
  const value = Date.parse(event.occurredAt);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/** Hide scan-only noise and collapse each wallet-swap operation without dropping its lifecycle events. */
export function buildUserActivityItems(events: readonly MonadActivityEvent[]): UserActivityItem[] {
  const unique = new Map<string, MonadActivityEvent>();
  for (const event of events) if (!isHiddenUserActivityDiagnostic(event)) unique.set(event.id, event);

  const groups = new Map<string, Array<{event: MonadActivityEvent; index: number; stage: string}>>();
  const items: Array<{item: UserActivityItem; sortAt: number; order: number}> = [];
  let order = 0;
  for (const event of unique.values()) {
    const eventOrder = order++;
    const identity = swapOperationId(event);
    if (!identity) {
      items.push({item: {key: event.id, event}, sortAt: timestamp(event), order: eventOrder});
      continue;
    }
    const group = groups.get(identity.operationId) ?? [];
    group.push({event, index: eventOrder, stage: identity.stage});
    groups.set(identity.operationId, group);
  }

  for (const [operationId, records] of groups) {
    const lifecycle = records.sort((left, right) => timestamp(left.event) - timestamp(right.event)
      || STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage] || left.index - right.index);
    const eventsInOrder = lifecycle.map(record => record.event);
    const latest = eventsInOrder[eventsInOrder.length - 1]!;
    items.push({item: {key: `swap:${operationId}`, event: latest, lifecycle: {operationId, events: eventsInOrder}},
      sortAt: timestamp(latest), order: Math.min(...records.map(record => record.index))});
  }

  return items.sort((left, right) => right.sortAt - left.sortAt || left.order - right.order).map(({item}) => item);
}
