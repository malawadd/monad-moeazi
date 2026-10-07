import {apiRequest} from './apiClient';
import type {PerpCurrentResponse, PerpRunEventsPage, PerpRunsPage, PerpStopResult, PerpStopReview, PreparedPerpEnrollment} from '../types/perpAutonomy';

const base = '/api/mobile/perp-autonomy';
export const perpAutonomyApi = {
  prepare: (input: {amountUnits: string; durationSeconds: number; idempotencyKey: string}) =>
    apiRequest<PreparedPerpEnrollment>(`${base}/prepare`, {method: 'POST', body: JSON.stringify({...input, chainId: 10143})}),
  enroll: (input: {runId: string; usdcAuthorizationSignature: string; mandateSignature: string}) =>
    apiRequest<{runId: string; status: string; phase: string; vaultAddress: string; transactionHash: string | null}>(
      `${base}/enroll`, {method: 'POST', body: JSON.stringify({...input, chainId: 10143})}),
  current: () => apiRequest<PerpCurrentResponse>(`${base}/current`),
  history: (limit = 15, cursor?: string) => apiRequest<PerpRunsPage>(
    `${base}/history?${new URLSearchParams({limit: String(limit), ...(cursor ? {cursor} : {})}).toString()}`),
  runHistory: (runId: string, limit = 50, cursor?: string) => apiRequest<PerpRunEventsPage>(
    `${base}/history/${encodeURIComponent(runId)}?${new URLSearchParams({limit: String(limit), ...(cursor ? {cursor} : {})}).toString()}`),
  prepareStop: (input: {runId: string; idempotencyKey: string}) => apiRequest<PerpStopReview>(
    `${base}/stop/prepare`, {method: 'POST', body: JSON.stringify({...input, chainId: 10143})}),
  stop: (input: {runId: string; idempotencyKey: string; nonce: string; deadline: number; signature: string}) =>
    apiRequest<PerpStopResult>(`${base}/stop`, {method: 'POST', body: JSON.stringify({...input, chainId: 10143})}),
};

export function createPerpIdempotencyKey() {
  return `perp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
