import {apiRequest} from './apiClient';
import type {ManualPerplAccount, ManualPerplOperationStatus, ManualPerplPreparedOperation} from '../types/manualPerpl';

const base = '/api/mobile/manual/perpl';

export const manualPerplApi = {
  account: () => apiRequest<ManualPerplAccount>(`${base}/account`),
  prepareAccount: (input: {action: 'create' | 'fund' | 'open' | 'deposit' | 'withdraw'; amountUnits?: string; idempotencyKey: string}) =>
    apiRequest<ManualPerplPreparedOperation>(`${base}/account/prepare`, {method: 'POST', body: JSON.stringify(input)}),
  prepareOrder: (input: {kind: 'market_entry' | 'limit_entry' | 'close_position' | 'reduce_size' | 'cancel_limit' | 'add_margin' | 'amend_limit';
    marketId: string; side?: 'long' | 'short'; sizeUnits?: string; limitPrice?: string; leverage?: number; orderId?: string;
    collateralAmountUnits?: string; idempotencyKey: string}) =>
    apiRequest<ManualPerplPreparedOperation>(`${base}/orders/prepare`, {method: 'POST', body: JSON.stringify(input)}),
  submit: (operationId: string, signedTransaction: string) => apiRequest<ManualPerplOperationStatus>(
    `${base}/operations/${encodeURIComponent(operationId)}/submit`, {method: 'POST', body: JSON.stringify({signedTransaction})}),
  operation: (operationId: string) => apiRequest<ManualPerplOperationStatus>(
    `${base}/operations/${encodeURIComponent(operationId)}`),
};

export function createManualPerplIdempotencyKey() {
  return `manual-perpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}
