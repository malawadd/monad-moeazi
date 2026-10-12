import {isPerplDirectOptimizerDuration, PERPL_DIRECT_OPTIMIZER_MAX_DURATION_SECONDS,
  PERPL_DIRECT_OPTIMIZER_MIN_DURATION_SECONDS} from './perplValidation';
import type {PerplRecoveryAction, PerplRun, PerplVenue} from '../types/perpl';

export const USER_PERPL_DURATION_PRESETS = [10, 30, 120, 360, 720] as const;

export type UserPerplDurationBounds = {minMinutes: number; maxMinutes: number};

/** Intersects the live venue range with User Mode's direct-optimizer policy. */
export function effectiveUserPerplDurationBounds(venue: PerplVenue | null): UserPerplDurationBounds | null {
  const liveMinimum = venue?.limits?.minDurationSeconds;
  const liveMaximum = venue?.limits?.maxDurationSeconds;
  if (!venue || !Number.isSafeInteger(liveMinimum) || !Number.isSafeInteger(liveMaximum)) return null;
  const direct = venue.venueId === 'perpl-direct-testnet-v1';
  const minimumSeconds = Math.max(liveMinimum!, direct ? PERPL_DIRECT_OPTIMIZER_MIN_DURATION_SECONDS : 0);
  const maximumSeconds = Math.min(liveMaximum!, direct ? PERPL_DIRECT_OPTIMIZER_MAX_DURATION_SECONDS : Number.MAX_SAFE_INTEGER);
  const minMinutes = Math.max(1, Math.ceil(minimumSeconds / 60));
  const maxMinutes = Math.floor(maximumSeconds / 60);
  return minMinutes <= maxMinutes ? {minMinutes, maxMinutes} : null;
}

export function supportedUserPerplDurations(venue: PerplVenue | null) {
  const minimum = venue?.limits?.minDurationSeconds;
  const maximum = venue?.limits?.maxDurationSeconds;
  if (!venue || !Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)) return [];
  return USER_PERPL_DURATION_PRESETS.filter(minutes => {
    const seconds = minutes * 60;
    const directAllowed = venue.venueId !== 'perpl-direct-testnet-v1' || isPerplDirectOptimizerDuration(seconds);
    return directAllowed && seconds >= minimum! && seconds <= maximum!;
  });
}

export function userPerplDurationError(value: string, venue: PerplVenue | null) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed)) || Number(trimmed) < 1) {
    return 'Enter a whole number of minutes.';
  }
  const bounds = effectiveUserPerplDurationBounds(venue);
  if (!bounds) return 'Live duration limits are unavailable.';
  if (Number(trimmed) < bounds.minMinutes || Number(trimmed) > bounds.maxMinutes) {
    return `Choose between ${bounds.minMinutes} and ${bounds.maxMinutes} minutes.`;
  }
  return null;
}

export type UserPerplRunState = {title: string; message: string; canAskStop: boolean};

export function userPerplRunState(run: PerplRun): UserPerplRunState {
  const status = run.status.toLowerCase();
  if (status === 'prepared') return {title: 'Setup review saved', message: 'This run is not signed or funded yet. Return to setup to continue.', canAskStop: false};
  if (status === 'activation_pending' || status === 'uncertain') return {title: 'Setup is being confirmed', message: 'Wait for the service to confirm this run before starting another one.', canAskStop: false};
  if (status === 'active') return {title: 'Strategy is active', message: 'A stop request stops new entries. Open positions still need to settle, and returning AUSD is a separate review.', canAskStop: true};
  if (status === 'stopping') return {title: 'Stop requested', message: 'The service is checking the stop. Settlement and returning AUSD happen separately.', canAskStop: false};
  if (status === 'settling' || status === 'incomplete_settlement') return {title: 'Settlement in progress', message: 'The run is no longer taking new entries. Open positions or orders may still need to close before AUSD can return.', canAskStop: false};
  if (status === 'failed') return {title: 'Run needs attention', message: 'Review this run for an available recovery action before starting anything new.', canAskStop: false};
  if (['stopped', 'settled', 'expired', 'inactive', 'complete', 'completed', 'recovered'].includes(status)) {
    return {title: 'Run finished', message: 'Review the run history for its final status and any available AUSD return.', canAskStop: false};
  }
  return {title: 'Status being checked', message: 'Refresh this run before taking another action. Its current state has not been confirmed.', canAskStop: false};
}

export function userPerplHasRecovery(run: PerplRun) {
  return Boolean(run.recoveryActions?.length);
}

/** User recovery requires a fresh owner-validated run and its exact advertised action. */
export function canStartUserPerplRecovery(run: PerplRun, action: PerplRecoveryAction, fresh: boolean,
  pending: ReadonlyArray<{kind: string; id: string}>) {
  return fresh && run.recoveryActions?.includes(action) === true
    && !pending.some(reference => reference.kind === 'perpl-recovery' && reference.id === run.runId);
}
