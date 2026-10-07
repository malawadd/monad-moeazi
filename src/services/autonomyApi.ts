import {apiRequest} from './apiClient';
import type {AutonomyCurrentResponse, AutonomyEnrollmentResult, AutonomyHistoryResponse,
  PreparedAutonomyEnrollment} from '../types/autonomyTrading';
import type {PreparedMonadOperation} from '../types/monad';

const base = '/api/mobile/autonomy';

export const autonomyApi = {
  prepare: (input: {amountUnits: string; durationSeconds: number; idempotencyKey: string}) =>
    apiRequest<PreparedAutonomyEnrollment>(`${base}/prepare`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  enroll: (input: {enrollmentId: string; usdcAuthorizationSignature: string; mandateSignature: string}) =>
    apiRequest<AutonomyEnrollmentResult>(`${base}/enroll`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  current: () => apiRequest<AutonomyCurrentResponse>(`${base}/current`),
  history: () => apiRequest<AutonomyHistoryResponse>(`${base}/history`),
  prepareRecovery: (enrollmentId: string) => apiRequest<PreparedMonadOperation>(
    `${base}/${encodeURIComponent(enrollmentId)}/recovery/prepare`, {
      method: 'POST', body: '{}',
    }),
};
