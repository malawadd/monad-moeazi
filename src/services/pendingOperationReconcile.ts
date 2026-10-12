import {autonomyApi} from './autonomyApi';
import {manualPerplApi} from './manualPerplApi';
import {perpAutonomyApi} from './perpAutonomyApi';
import {perplApi} from './perplApi';
import {monadApi} from './monadApi';
import {loadPendingOperationReferences, PendingOperationReference, removePendingOperation} from './pendingOperationJournal';
import {readOwnerMonadOperation, verifiedContinuationFromStatus, type VerifiedMonadContinuation} from './pendingMonadContinuation';
import {monadTimestampMillis} from './monadFormatting';

export type ReconciliationResult = {
  reference: PendingOperationReference;
  disposition: 'resolved' | 'tracked' | 'unavailable';
  status: string;
  note: string;
  continuation?: VerifiedMonadContinuation;
};
const MONAD_DONE = new Set(['finalized', 'failed', 'expired', 'reverted']);
const MANUAL_PERPL_DONE = new Set(['finalized', 'failed', 'no_fill']);
const RUN_DONE = new Set(['completed', 'complete', 'recovered', 'settled', 'failed', 'expired']);
const MANDATE_RECORDED = new Set(['signed', 'active', 'revoked', 'stopped', 'inactive', 'expired']);

export async function reconcilePendingOperation(ownerAddress: string, reference: PendingOperationReference): Promise<ReconciliationResult> {
  try {
    const result = await readReference(ownerAddress, reference);
    if (result.disposition === 'resolved') await removePendingOperation(ownerAddress, reference);
    return {reference, ...result};
  } catch {
    return {reference, disposition: 'unavailable', status: 'unavailable',
      note: 'Read-only status could not be confirmed. The original reference remains saved.'};
  }
}

export async function reconcileAllPendingOperations(ownerAddress: string) {
  const references = await loadPendingOperationReferences(ownerAddress);
  return Promise.all(references.map(reference => reconcilePendingOperation(ownerAddress, reference)));
}

async function readReference(owner: string, reference: PendingOperationReference): Promise<Omit<ReconciliationResult, 'reference'>> {
  if (reference.kind === 'monad-operation') {
    const operation = await readOwnerMonadOperation(owner, reference.id);
    if (MONAD_DONE.has(operation.status)) return {disposition: 'resolved', status: operation.status, note: 'The same Monad operation reached a terminal status.'};
    if (operation.status === 'verified') {
      const continuation = verifiedContinuationFromStatus(operation, owner, reference.id) ?? undefined;
      return {disposition: 'tracked', status: 'verified',
        note: continuation
          ? 'The service returned the same signed operation and its exact review. Continuing it requires your confirmation.'
          : 'The operation is verified, but its original review or expiry could not be safely confirmed. Its ID remains saved.',
        ...(continuation ? {continuation} : {})};
    }
    return {disposition: 'tracked', status: operation.status, note: 'The same operation remains available for explicit status review.'};
  }
  if (reference.kind === 'manual-perpl-operation') {
    if (reference.action !== 'submit') throw new Error('The saved Manual Perpl action is unsupported.');
    const operation = await manualPerplApi.operation(reference.id);
    if (operation.operationId !== reference.id) throw new Error('Operation ID mismatch.');
    const review = operation.review as Record<string, unknown> | undefined;
    const reviewedAction = typeof review?.action === 'string' ? review.action : '';
    const actionAliases: Record<string, string> = {approve: 'approve_collateral', open: 'open_account', deposit: 'deposit_collateral',
      withdraw: 'withdraw_collateral', legacy_withdraw: 'legacy_withdraw_collateral', legacy_rescue: 'legacy_rescue_tokens'};
    const actionMatches = reviewedAction.length > 0 && (operation.action === reviewedAction
      || actionAliases[reviewedAction] === operation.action);
    const operationExpiry = operation.expiresAt === undefined ? Number.NaN : monadTimestampMillis(operation.expiresAt);
    const reviewExpiry = review?.expiresAt === undefined ? Number.NaN : monadTimestampMillis(review.expiresAt as string | number);
    if (operation.chainId !== 10143 || operation.venueId !== 'perpl-direct-testnet-v1'
        || typeof review?.ownerAddress !== 'string' || review.ownerAddress.toLowerCase() !== owner.toLowerCase()
        || review.chainId !== 10143 || review.venueId !== 'perpl-direct-testnet-v1' || !actionMatches
        || !Number.isFinite(operationExpiry) || operationExpiry !== reviewExpiry
        || !['prepared', 'submitted', 'uncertain', 'finalized', 'failed', 'no_fill', 'expired'].includes(operation.status)) {
      throw new Error('Manual Perpl operation identity, action, expiry, or owner did not match.');
    }
    const done = MANUAL_PERPL_DONE.has(operation.status);
    return {disposition: done ? 'resolved' : 'tracked', status: operation.status,
      note: done ? 'The same Manual Perpl operation reached a terminal status.' : 'The same Manual Perpl operation remains owner-queryable.'};
  }
  if (reference.kind === 'managed-spot-mandate') {
    const snapshot = await monadApi.mandate();
    if (snapshot.mandate?.mandateId !== reference.id) return tracked('not found', 'The owner mandate snapshot does not yet match this mandate ID.');
    if (snapshot.mandate.ownerAddress.toLowerCase() !== owner.toLowerCase()) throw new Error('Owner mismatch.');
    const status = String(snapshot.mandate.status).toLowerCase();
    if (!MANDATE_RECORDED.has(status)) return tracked(status, 'The exact mandate is visible, but its service status does not yet confirm submission acceptance.');
    return {disposition: 'resolved', status: snapshot.mandate.status, note: 'The owner GET found this exact mandate and its current status.'};
  }
  if (reference.kind === 'autonomy-enrollment') {
    const [current, history] = await Promise.all([autonomyApi.current(), autonomyApi.history()]);
    const run = [current.current, ...history.runs].find(item => item?.enrollmentId === reference.id);
    if (!run) return tracked('not found', 'Owner current/history did not return this enrollment ID; it remains saved.');
    if (run.ownerAddress.toLowerCase() !== owner.toLowerCase()) throw new Error('Owner mismatch.');
    const done = RUN_DONE.has(run.status.toLowerCase());
    return {disposition: done ? 'resolved' : 'tracked', status: run.status,
      note: `The same enrollment is owner-queryable as run ${run.runId}.`};
  }
  if (reference.kind === 'perpl-run') {
    const page = await perplApi.runHistory(reference.id);
    assertOwnerRun(page.run.runId, page.run.ownerAddress, reference.id, owner);
    // A failed enrollment can still own recoverable vault funding. Keep the
    // original run ID reachable until the backend says no recovery action is
    // available; a terminal-looking run status alone is not enough evidence.
    const recoveryPending = page.run.recoveryAvailable === true ||
      (Array.isArray(page.run.recoveryActions) && page.run.recoveryActions.length > 0);
    const done = RUN_DONE.has(page.run.status.toLowerCase()) && !recoveryPending;
    return {disposition: done ? 'resolved' : 'tracked', status: page.run.status,
      note: recoveryPending
        ? 'This Perpl run still advertises owner recovery. The original run ID remains saved for that recovery.'
        : done ? 'The same Perpl run reached a terminal status.' : 'This is the same Perpl run ID; its nonterminal state remains saved for later checks.'};
  }
  if (reference.kind === 'perp-run') {
    const page = await perpAutonomyApi.runHistory(reference.id);
    assertOwnerRun(page.run.runId, page.run.ownerAddress, reference.id, owner);
    const done = RUN_DONE.has(page.run.status.toLowerCase());
    return {disposition: done ? 'resolved' : 'tracked', status: page.run.status,
      note: done ? 'The same Perp run reached a terminal status.' : 'This is the same Perp run ID; its nonterminal state remains saved for later checks.'};
  }
  if (reference.kind === 'perpl-stop' || reference.kind === 'perpl-recovery') {
    const page = await perplApi.runHistory(reference.id);
    assertOwnerRun(page.run.runId, page.run.ownerAddress, reference.id, owner);
    if (!reference.txHash) return tracked(page.run.status,
      'Run history was read, but this saved action has no signed-transaction hash to match. Its original reference remains saved.');
    const events = page.events ?? [];
    if (reference.kind === 'perpl-stop') {
      const signed = events.find(event => eventKind(event) === 'perpl_stop_requested'
        && eventStatus(event) === 'signed' && eventHash(event) === reference.txHash
        && occurredAtOrAfter(event, reference.createdAt));
      if (signed && String(page.run.phase ?? '').toLowerCase() === 'stop_finalized') {
        return {disposition: 'resolved', status: 'stop_finalized',
          note: 'The same signed stop hash appears in owner history and the run reached stop_finalized.'};
      }
      return tracked(page.run.status, signed
        ? 'The exact signed stop is visible, but owner history does not yet prove finality. Its original reference remains saved.'
        : 'Owner history does not yet contain this exact signed stop hash. Its original reference remains saved.');
    }

    const signed = events.find(event => eventKind(event) === 'perpl_recovery_signed'
      && eventStatus(event) === 'signed' && eventHash(event) === reference.txHash
      && eventAction(event) === reference.action && occurredAtOrAfter(event, reference.createdAt));
    if (!signed) return tracked(page.run.status,
      'Owner history does not yet contain this exact signed recovery hash and action. Its original reference remains saved.');
    const signedAt = eventTimestamp(signed);
    const terminal = events.find(event => {
      const kind = eventKind(event);
      const isFinalized = kind === 'perpl_recovery_finalized' && eventStatus(event) === 'completed'
        && eventAction(event) === reference.action;
      const isFailed = kind === 'perpl_recovery_failed' && eventStatus(event) === 'failed';
      const timestamp = eventTimestamp(event);
      return (isFinalized || isFailed) && eventHash(event) === reference.txHash
        && timestamp !== null && signedAt !== null && timestamp >= signedAt
        && timestamp >= reference.createdAt;
    });
    if (terminal) return {disposition: 'resolved', status: eventStatus(terminal),
      note: eventKind(terminal) === 'perpl_recovery_finalized'
        ? 'Owner history confirmed finality for this exact signed recovery hash and action.'
        : 'Owner history confirmed failure for this exact signed recovery hash and action.'};
    return tracked(page.run.status,
      'The exact signed recovery is visible, but matching finality is not confirmed yet. Its original reference remains saved.');
  }
  const runId = reference.relatedId;
  if (!runId) throw new Error('Perp stop run ID missing.');
  const page = await perpAutonomyApi.runHistory(runId);
  assertOwnerRun(page.run.runId, page.run.ownerAddress, runId, owner);
  const event = page.events.find(item => eventHasIdempotencyKey(item, reference.id));
  if (event && RUN_DONE.has(event.status.toLowerCase())) {
    return {disposition: 'resolved', status: event.status, note: 'Run history confirmed this exact stop idempotency key at a terminal status.'};
  }
  return tracked(page.run.status, 'Run history was read. This stop remains linked to its original idempotency key; no new stop was sent.');
}

function assertOwnerRun(actualId: string, actualOwner: string, expectedId: string, expectedOwner: string) {
  if (actualId !== expectedId || actualOwner.toLowerCase() !== expectedOwner.toLowerCase()) throw new Error('Run identity mismatch.');
}

function tracked(status: string, note: string): Omit<ReconciliationResult, 'reference'> {
  return {disposition: 'tracked', status, note};
}

function eventKind(event: unknown) { return field(event, 'kind'); }
function eventStatus(event: unknown) { return field(event, 'status'); }
function eventAction(event: unknown) {
  const value = event as Record<string, unknown> | null;
  const details = value?.details && typeof value.details === 'object' ? value.details as Record<string, unknown> : {};
  return typeof details.action === 'string' ? details.action : '';
}
function eventHash(event: unknown) {
  const value = event as Record<string, unknown> | null;
  const hash = value?.txHash ?? value?.transactionHash;
  return typeof hash === 'string' ? hash.toLowerCase() : '';
}
function eventTimestamp(event: unknown): number | null {
  const value = event as Record<string, unknown> | null;
  const timestamp = value?.occurredAt ?? value?.timestamp;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) return timestamp;
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function occurredAtOrAfter(event: unknown, timestamp: number) {
  const occurredAt = eventTimestamp(event);
  return occurredAt !== null && occurredAt >= timestamp;
}
function field(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const fieldValue = (value as Record<string, unknown>)[key];
  return typeof fieldValue === 'string' ? fieldValue.toLowerCase() : '';
}

function eventHasIdempotencyKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const details = event.details && typeof event.details === 'object' ? event.details as Record<string, unknown> : {};
  const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {};
  return event.idempotencyKey === key || details.idempotencyKey === key || payload.idempotencyKey === key;
}
