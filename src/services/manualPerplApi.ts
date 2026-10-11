import {apiRequest} from './apiClient';
import type {ManualPerplAccount, ManualPerplAccountMode, ManualPerplOperationStatus, ManualPerplPreparedOperation} from '../types/manualPerpl';

const base = '/api/mobile/manual/perpl';
async function boundedRequest<T>(path: string, init: RequestInit, milliseconds: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  try { return await apiRequest<T>(path, {...init, signal: controller.signal}); }
  finally { clearTimeout(timeout); }
}

export const manualPerplApi = {
  account: () => apiRequest<ManualPerplAccount>(`${base}/account`),
  prepareAccount: (input: {action: 'approve' | 'open' | 'deposit' | 'withdraw' | 'legacy_withdraw' | 'legacy_rescue'; amountUnits: string; idempotencyKey: string}) =>
    apiRequest<ManualPerplPreparedOperation>(`${base}/account/prepare`, {method: 'POST', body: JSON.stringify(input)}),
  prepareOrder: (input: {kind: 'market_entry' | 'limit_entry' | 'close_position' | 'reduce_size' | 'cancel_limit' | 'add_margin' | 'amend_limit';
    marketId: string; side?: 'long' | 'short'; sizeUnits?: string; limitPrice?: string; leverage?: number; orderId?: string;
    collateralAmountUnits?: string; accountMode?: ManualPerplAccountMode; idempotencyKey: string}) =>
    apiRequest<ManualPerplPreparedOperation>(`${base}/orders/prepare`, {method: 'POST', body: JSON.stringify(input)}),
  submit: (operationId: string, signedTransaction: string) => boundedRequest<ManualPerplOperationStatus>(
    `${base}/operations/${encodeURIComponent(operationId)}/submit`, {method: 'POST', body: JSON.stringify({signedTransaction})}, 25_000),
  operation: (operationId: string) => boundedRequest<ManualPerplOperationStatus>(
    `${base}/operations/${encodeURIComponent(operationId)}`, {}, 15_000),
};

export function createManualPerplIdempotencyKey() {
  return `manual-perpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
