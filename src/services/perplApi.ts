import {apiRequest} from './apiClient';
import type {PerplCurrentResponse, PerplPreparedEnrollment, PerplRecoveryAction, PerplRecoveryResult, PerplRecoveryReview, PerplRunHistoryPage, PerplRunsPage, PerplStopResult, PerplStopReview, PerplTestnetVenueId, PerplVenuesResponse} from '../types/perpl';

const base = '/api/mobile/perp';

export const perplApi = {
  venues: () => apiRequest<PerplVenuesResponse>(`${base}/venues`),
  prepare: (input: {venueId: PerplTestnetVenueId; chainId: 10143; amountUnits: string; durationSeconds: number; idempotencyKey: string}) =>
    apiRequest<PerplPreparedEnrollment>(`${base}/prepare`, {method: 'POST', body: JSON.stringify(input)}),
  enroll: (input: {runId: string; fundingRawTransaction: string; mandateSignature: string}) =>
    apiRequest<{runId: string; venueId: PerplTestnetVenueId; status: string; phase: string}>(`${base}/enroll`, {method: 'POST', body: JSON.stringify(input)}),
  current: () => apiRequest<PerplCurrentResponse>(`${base}/current`),
  history: (limit = 20, cursor?: string) => apiRequest<PerplRunsPage>(
    `${base}/history?${new URLSearchParams({limit: String(limit), ...(cursor ? {cursor} : {})})}`),
  runHistory: (runId: string, limit = 50, cursor?: string) => apiRequest<PerplRunHistoryPage>(
    `${base}/history/${encodeURIComponent(runId)}?${new URLSearchParams({limit: String(limit), ...(cursor ? {cursor} : {})})}`),
  prepareStop: (input: {runId: string; idempotencyKey: string}) => apiRequest<PerplStopReview>(
    `${base}/stop/prepare`, {method: 'POST', body: JSON.stringify(input)}),
  stop: (input: {runId: string; signedTransaction: string}) => apiRequest<PerplStopResult>(
    `${base}/stop`, {method: 'POST', body: JSON.stringify(input)}),
  prepareRecovery: (input: {runId: string; action: PerplRecoveryAction; idempotencyKey: string}) => apiRequest<PerplRecoveryReview>(
    `${base}/recovery/prepare`, {method: 'POST', body: JSON.stringify(input)}),
  recovery: (input: {runId: string; action: PerplRecoveryAction; signedTransaction: string}) => apiRequest<PerplRecoveryResult>(
    `${base}/recovery`, {method: 'POST', body: JSON.stringify(input)}),
};

export function createPerplIdempotencyKey() {
  return `perpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
