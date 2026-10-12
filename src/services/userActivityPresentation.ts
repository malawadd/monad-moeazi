import type {MonadActivityEvent} from '../types/monad';

export type UserActivityLifecycleReference =
  | {family: 'wallet_swap'; operationId: string}
  | {family: 'manual_perpl'; operationId: string}
  | {family: 'autonomous_perpl'; venueId: PerplActivityVenue; runId: string; requestId: number}
  | {family: 'autonomous_updates'; venueId: PerplActivityVenue; runId: string};

export type UserActivityLifecycle = UserActivityLifecycleReference & {events: MonadActivityEvent[]};
export type UserActivityItem = {key: string; event: MonadActivityEvent; lifecycle?: UserActivityLifecycle};
export type PerplActivityVenue = 'perpl-direct-testnet-v1' | 'perpl-testnet-v1';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SWAP_STAGE = new RegExp(`^operation:(${UUID}):(prepared|authorized|submitted|uncertain|expired|executed|finalized|failed)(?::0x[0-9a-f]{64})?$`, 'i');
const MANUAL_STAGE = new RegExp(`^manual-perpl:(${UUID}):(prepared|submitted|uncertain|finalized|no_fill|failed)$`, 'i');
const PERPL_ORDER_STAGE = new RegExp(`^(perpl-(?:direct-)?testnet-v1):(${UUID}):order:([1-9]\\d*):(prepared|accepted_for_forwarding|submitted|executed|partially_filled|filled|finalized|no_fill|canceled|failed|uncertain)$`, 'i');
const PERPL_RUN_EVENT = new RegExp(`^(perpl-(?:direct-)?testnet-v1):(${UUID}):`, 'i');
const STAGE_ORDER: Record<string, number> = {
  prepared: 0, authorized: 1, verified: 1, accepted_for_forwarding: 1, submitted: 2, uncertain: 3,
  executed: 4, partially_filled: 4, filled: 4, finalized: 5, no_fill: 5, failed: 5, canceled: 5, expired: 5,
};
const MANUAL_ORDER_ACTION = /manual perpl (?:market entry|limit entry|close position|reduce size|cancel limit|amend limit|add margin) prepared/i;
const PERPL_WORKER_ORDER_SUMMARIES = new Set([
  'perpl_direct_order_finalized', 'perpl_direct_order_no_fill', 'perpl_direct_order_failed',
]);
const AUTONOMOUS_UPDATE_KINDS = new Set(['perpl_direct_optimizer', 'perpl_optimizer_scanner', 'perpl_optimizer_cycle_completed']);
const MATERIAL_OPTIMIZER_REASONS = new Set([
  'optimizer_open_position_recovery_seed_missing', 'optimizer_active_cycle_missing',
  'perpl_direct_market_missing', 'perpl_direct_execution_disabled',
]);

export function isHiddenUserActivityDiagnostic(event: MonadActivityEvent) {
  if (PERPL_WORKER_ORDER_SUMMARIES.has(event.kind)) return true;
  return false;
}

function swapOperationId(event: MonadActivityEvent): string | null {
  if (event.kind !== 'swap' && event.kind !== 'wallet_swap') return null;
  return SWAP_STAGE.exec(event.id)?.[1] ?? null;
}

function manualOperationId(event: MonadActivityEvent): string | null {
  const match = MANUAL_STAGE.exec(event.id);
  if (!match || event.venueId !== 'perpl-direct-testnet-v1' || event.kind !== `manual_perpl_${match[2]}`) return null;
  return match[1]!;
}

function autonomousOrder(event: MonadActivityEvent): Extract<UserActivityLifecycleReference, {family: 'autonomous_perpl'}> | null {
  const match = PERPL_ORDER_STAGE.exec(event.id);
  if (!match || event.venueId !== match[1] || event.kind !== `perpl_order_${match[4]}`) return null;
  const requestId = Number(match[3]);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) return null;
  const detailRequestId = readRequestId(event);
  if (detailRequestId !== null && detailRequestId !== requestId) return null;
  return {family: 'autonomous_perpl', venueId: match[1] as PerplActivityVenue, runId: match[2]!, requestId};
}

function autonomousUpdate(event: MonadActivityEvent): Extract<UserActivityLifecycleReference, {family: 'autonomous_updates'}> | null {
  if (!AUTONOMOUS_UPDATE_KINDS.has(event.kind)) return null;
  if (event.kind === 'perpl_direct_optimizer' && MATERIAL_OPTIMIZER_REASONS.has(event.status)) return null;
  const match = PERPL_RUN_EVENT.exec(event.id);
  if (!match || event.venueId !== match[1]) return null;
  return {family: 'autonomous_updates', venueId: match[1] as PerplActivityVenue, runId: match[2]!};
}

function readRequestId(event: MonadActivityEvent) {
  const value = event.details?.find(item => item.label.toLowerCase() === 'requestid')?.value;
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function hasManualOrderEvidence(event: MonadActivityEvent) {
  return readRequestId(event) !== null || MANUAL_ORDER_ACTION.test(event.summary);
}

function timestamp(event: MonadActivityEvent) {
  const value = Date.parse(event.occurredAt);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function lifecycleKey(reference: UserActivityLifecycleReference) {
  if (reference.family === 'wallet_swap') return `swap:${reference.operationId}`;
  if (reference.family === 'manual_perpl') return `manual-perpl:${reference.operationId}`;
  if (reference.family === 'autonomous_updates') return `autonomous-updates:${reference.venueId}:${reference.runId}`;
  return `perpl-order:${reference.venueId}:${reference.runId}:${reference.requestId}`;
}

function compareEvents(first: MonadActivityEvent, second: MonadActivityEvent) {
  return timestamp(first) - timestamp(second)
    || (STAGE_ORDER[first.status] ?? 20) - (STAGE_ORDER[second.status] ?? 20);
}

/** IDs and request IDs here mirror the authenticated backend event emitters. */
export function activityLifecycleReferenceFromParams(params: unknown): UserActivityLifecycleReference | null {
  if (!params || typeof params !== 'object') return null;
  const record = params as Record<string, unknown>;
  if (typeof record.operationId === 'string' && new RegExp(`^${UUID}$`, 'i').test(record.operationId)) {
    return {family: 'wallet_swap', operationId: record.operationId};
  }
  if (typeof record.manualPerplOperationId === 'string' && new RegExp(`^${UUID}$`, 'i').test(record.manualPerplOperationId)) {
    return {family: 'manual_perpl', operationId: record.manualPerplOperationId};
  }
  const order = record.autonomousUpdates ?? record.perplOrder;
  if (!order || typeof order !== 'object') return null;
  const candidate = order as Record<string, unknown>;
  if (record.autonomousUpdates && (candidate.venueId === 'perpl-direct-testnet-v1' || candidate.venueId === 'perpl-testnet-v1')
      && typeof candidate.runId === 'string' && new RegExp(`^${UUID}$`, 'i').test(candidate.runId)
      && Object.keys(candidate).every(key => key === 'venueId' || key === 'runId')) {
    return {family: 'autonomous_updates', venueId: candidate.venueId, runId: candidate.runId};
  }
  if ((candidate.venueId !== 'perpl-direct-testnet-v1' && candidate.venueId !== 'perpl-testnet-v1')
      || typeof candidate.runId !== 'string' || !new RegExp(`^${UUID}$`, 'i').test(candidate.runId)
      || typeof candidate.requestId !== 'number' || !Number.isSafeInteger(candidate.requestId) || candidate.requestId <= 0) return null;
  return {family: 'autonomous_perpl', venueId: candidate.venueId, runId: candidate.runId, requestId: candidate.requestId};
}

export function lifecycleEventPrefix(reference: UserActivityLifecycleReference) {
  if (reference.family === 'wallet_swap') return `operation:${reference.operationId}:`;
  if (reference.family === 'manual_perpl') return `manual-perpl:${reference.operationId}:`;
  if (reference.family === 'autonomous_updates') return `${reference.venueId}:${reference.runId}:`;
  return `${reference.venueId}:${reference.runId}:order:${reference.requestId}:`;
}

export function eventMatchesLifecycle(event: MonadActivityEvent, reference: UserActivityLifecycleReference) {
  if (reference.family === 'wallet_swap') return event.id.startsWith(lifecycleEventPrefix(reference));
  if (reference.family === 'manual_perpl') return manualOperationId(event) === reference.operationId;
  if (reference.family === 'autonomous_updates') {
    const identity = autonomousUpdate(event);
    return identity?.venueId === reference.venueId && identity.runId === reference.runId;
  }
  const identity = autonomousOrder(event);
  return identity?.venueId === reference.venueId && identity.runId === reference.runId && identity.requestId === reference.requestId;
}

export function isAutonomousBackgroundLifecycle(item: UserActivityItem) {
  return item.lifecycle?.family === 'autonomous_updates';
}

export function filterAutonomousActivity(items: readonly UserActivityItem[], show: boolean) {
  return show ? [...items] : items.filter(item => !isAutonomousBackgroundLifecycle(item));
}

export function userActivityTitle(item: UserActivityItem) {
  if (!item.lifecycle) return item.event.title;
  if (item.lifecycle.family === 'wallet_swap') return 'Wallet swap';
  if (item.lifecycle.family === 'manual_perpl') return 'Manual Perpl order';
  if (item.lifecycle.family === 'autonomous_updates') return 'Autonomous updates';
  return 'Autonomous Perpl order';
}

export function userActivityRouteParams(item: UserActivityItem) {
  if (!item.lifecycle) return {itemId: item.event.id, event: item.event};
  const reference = item.lifecycle;
  if (reference.family === 'wallet_swap') return {itemId: item.event.id, operationId: reference.operationId};
  if (reference.family === 'manual_perpl') return {itemId: item.event.id, manualPerplOperationId: reference.operationId};
  if (reference.family === 'autonomous_updates') return {itemId: item.event.id,
    autonomousUpdates: {venueId: reference.venueId, runId: reference.runId}};
  return {itemId: item.event.id, perplOrder: {venueId: reference.venueId, runId: reference.runId, requestId: reference.requestId}};
}

type Group = {reference: UserActivityLifecycleReference; events: MonadActivityEvent[]; firstOrder: number};

/** Hide diagnostic noise and collapse each wallet or Perpl order without merging a whole run. */
export function buildUserActivityItems(events: readonly MonadActivityEvent[]): UserActivityItem[] {
  const unique = new Map<string, MonadActivityEvent>();
  for (const event of events) if (!isHiddenUserActivityDiagnostic(event)) unique.set(event.id, event);

  const groups = new Map<string, Group>();
  const manualCandidates = new Map<string, {events: MonadActivityEvent[]; firstOrder: number}>();
  const loose: Array<{event: MonadActivityEvent; index: number}> = [];
  let order = 0;
  for (const event of unique.values()) {
    const index = order++;
    const swapId = swapOperationId(event);
    const manualId = manualOperationId(event);
    const updates = autonomousUpdate(event);
    const perplOrder = autonomousOrder(event);
    const reference: UserActivityLifecycleReference | null = swapId ? {family: 'wallet_swap', operationId: swapId}
      : updates ?? perplOrder ?? null;
    if (reference) {
      addToGroup(groups, reference, event, index);
    } else if (manualId) {
      const prior = manualCandidates.get(manualId) ?? {events: [], firstOrder: index};
      prior.events.push(event);
      manualCandidates.set(manualId, prior);
    } else {
      loose.push({event, index});
    }
  }

  for (const [operationId, candidate] of manualCandidates) {
    if (candidate.events.some(hasManualOrderEvidence)) {
      const reference: UserActivityLifecycleReference = {family: 'manual_perpl', operationId};
      const group = {reference, events: candidate.events, firstOrder: candidate.firstOrder};
      groups.set(lifecycleKey(reference), group);
    } else {
      for (const event of candidate.events) loose.push({event, index: candidate.firstOrder});
    }
  }

  const looseWithOrder = loose.map(({event, index}) => ({item: {key: event.id, event}, sortAt: timestamp(event), order: index}));
  const items = [...groups.values()].map(group => {
    const ordered = [...group.events].sort(compareEvents);
    const latest = ordered[ordered.length - 1]!;
    return {item: {key: lifecycleKey(group.reference), event: latest,
      lifecycle: {...group.reference, events: ordered}}, sortAt: timestamp(latest), order: group.firstOrder};
  });

  return [...items, ...looseWithOrder].sort((left, right) => right.sortAt - left.sortAt || left.order - right.order)
    .map(({item}) => item);
}

function addToGroup(groups: Map<string, Group>, reference: UserActivityLifecycleReference, event: MonadActivityEvent, index: number) {
  const key = lifecycleKey(reference);
  const group = groups.get(key) ?? {reference, events: [], firstOrder: index};
  if (!group.events.some(item => item.id === event.id)) group.events.push(event);
  groups.set(key, group);
}
