import {apiRequest, MobileApiError} from './apiClient';
import type {
  MonadActivityPage, MonadAgentSnapshot, MonadMarketsResponse, MonadMandateResponse,
  MonadMandate, MonadOperationKind, MonadOperationStatus, MonadQuote, MonadVenueId, MonadWalletSnapshot,
  PreparedMonadMandate, PreparedMonadOperation,
} from '../types/monad';

const base = '/api/mobile/monad';

export type MonadQuoteInput = {
  accountScope: 'wallet' | 'vault';
  venue: MonadVenueId;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps: number;
};

export type MonadPrepareInput = {
  kind: MonadOperationKind;
  idempotencyKey: string;
  amount?: string;
  amountIn?: string;
  amountUnits?: string;
  recipient?: string;
  vaultAddress?: string;
  asset?: string;
  tokenAddress?: string;
  spender?: string;
  tokenIn?: string;
  tokenOut?: string;
  slippageBps?: number;
  venue?: string;
  quoteId?: string;
  accountScope?: 'wallet' | 'vault';
};

export type MonadApprovalRequirement = {kind: 'approve_token'; tokenAddress: string; spender: string; amountUnits: string};

export function getMonadApprovalRequirement(error: unknown): MonadApprovalRequirement | null {
  if (!(error instanceof MobileApiError) || error.status !== 409) return null;
  const body = error.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const details = record.details;
  if (record.error !== 'approval_required' || !details || typeof details !== 'object' || Array.isArray(details)) return null;
  const approval = details as Record<string, unknown>;
  if (approval.kind !== 'approve_token' || typeof approval.tokenAddress !== 'string'
      || typeof approval.spender !== 'string' || typeof approval.amountUnits !== 'string') return null;
  return {kind: 'approve_token', tokenAddress: approval.tokenAddress, spender: approval.spender, amountUnits: approval.amountUnits};
}

export const monadApi = {
  wallet: () => apiRequest<MonadWalletSnapshot>(`${base}/wallet`),
  markets: () => apiRequest<MonadMarketsResponse>(`${base}/markets`),
  agent: () => apiRequest<MonadAgentSnapshot>(`${base}/agents`),
  activity: (limit = 60, cursor?: string) => apiRequest<MonadActivityPage>(
    `/api/mobile/monad/activity?${new URLSearchParams({limit: String(limit), ...(cursor ? {cursor} : {})}).toString()}`),
  quote: (input: MonadQuoteInput) => apiRequest<MonadQuote>(`${base}/quote`, {
    method: 'POST', body: JSON.stringify(input),
  }),
  prepare: (input: MonadPrepareInput) => apiRequest<PreparedMonadOperation>(`${base}/operations/prepare`, {
    method: 'POST', body: JSON.stringify(input),
  }),
  submit: (operationId: string, signedTransaction: string) => apiRequest<MonadOperationStatus>(
    `${base}/operations/${encodeURIComponent(operationId)}/submit`, {
      method: 'POST', body: JSON.stringify({signedTransaction}),
    }),
  broadcast: (operationId: string) => apiRequest<MonadOperationStatus>(
    `${base}/operations/${encodeURIComponent(operationId)}/broadcast`, {
      method: 'POST', body: '{}',
    }),
  operation: (operationId: string) => apiRequest<MonadOperationStatus>(
    `${base}/operations/${encodeURIComponent(operationId)}`),
  mandate: () => apiRequest<MonadMandateResponse>(`${base}/mandates`),
  prepareMandate: (input: {amount: string; asset: 'USDC' | 'WMON'; durationDays: number; idempotencyKey: string}) =>
    apiRequest<PreparedMonadMandate>(`${base}/mandates/prepare`, {
      method: 'POST', body: JSON.stringify(input),
    }),
  submitMandate: (mandateId: string, typedDataSignature: string) => apiRequest<MonadMandate>(
    `${base}/mandates/${encodeURIComponent(mandateId)}/submit`, {
      method: 'POST', body: JSON.stringify({signature: typedDataSignature}),
    }),
  prepareMandateAuthorization: (mandateId: string, idempotencyKey: string) =>
    apiRequest<PreparedMonadOperation>(`${base}/mandates/${encodeURIComponent(mandateId)}/authorize/prepare`, {
      method: 'POST', body: JSON.stringify({idempotencyKey}),
    }),
  prepareMandateRevoke: (mandateId: string, idempotencyKey: string) =>
    apiRequest<PreparedMonadOperation>(`${base}/mandates/${encodeURIComponent(mandateId)}/revoke/prepare`, {
      method: 'POST', body: JSON.stringify({idempotencyKey}),
    }),
  prepareVaultStop: (idempotencyKey: string) =>
    apiRequest<PreparedMonadOperation>(`${base}/vault/stop/prepare`, {
      method: 'POST', body: JSON.stringify({idempotencyKey}),
    }),
  prepareVaultResume: (idempotencyKey: string) =>
    apiRequest<PreparedMonadOperation>(`${base}/vault/resume/prepare`, {
      method: 'POST', body: JSON.stringify({idempotencyKey}),
    }),
};

export function createMonadIdempotencyKey() {
  return `monad-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}
