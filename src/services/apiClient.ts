import {API_BASE_URL, MOBILE_SCHEMA_VERSION} from '../config';
import {ActivityItem, AutopilotLimits, FundingSnapshot, ManagedProgramEnrollment, ManagedProgramGrantContext, ManagedScopedGrant,
  ManagedCloseResult, MobileHomeSnapshot, ScopedGrantAllowance, ScopedGrantPreparation} from '../types/mobile';
import {clearSession, getAccessToken, getRefreshToken, saveSession} from './sessionStore';
import {validateHomeSnapshot} from './homeActions';
import type {PreparedMobileActivation, SigningProofPrepared, SigningProofVerified} from '../types/signing';
import type {UaPreparedOperation, UaSignature} from './ua/UniversalAccountAdapter';
import type {PreparedWithdrawal, WithdrawalStatus} from '../types/withdrawal';
import type {HyperliquidBindingChallenge, HyperliquidBindingScope, HyperliquidCredentialRegistration} from '../types/hyperliquidBinding';
import type {AutopilotWalletReadiness} from './autopilotWalletReadiness';
import type {ManagedSpotMandate} from '../types/managedSpotMandate';

type SessionResponse = {accessToken: string; refreshToken: string; expiresIn: number; session: {subject: string; walletAddress: string; deviceId: string}};
let refreshInFlight: Promise<SessionResponse | null> | null = null;

export class MobileApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly body?: unknown) {
    super(message); this.name = 'MobileApiError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (!API_BASE_URL) throw new Error('Moeazi API is not configured.');
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {'Content-Type': 'application/json', Accept: `application/vnd.moeazi.mobile+json;version=${MOBILE_SCHEMA_VERSION}`, ...(token ? {Authorization: `Bearer ${token}`} : {}), ...init.headers},
  });
  if (response.status === 401 && retry) {
    const latestToken = await getAccessToken();
    if (token && latestToken && latestToken !== token) return request<T>(path, init, false);
    if (await refreshSession()) return request<T>(path, init, false);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = isRecord(body) && isRecord(body.detail) ? body.detail : null;
    const message = isRecord(body) && typeof body.error === 'string' ? body.error
      : isRecord(body) && typeof body.message === 'string' ? body.message
        : detail && typeof detail.message === 'string' ? detail.message
          : 'The Moeazi service could not complete this request.';
    const code = isRecord(body) && typeof body.code === 'string' ? body.code
      : detail && typeof detail.code === 'string' ? detail.code : undefined;
    throw new MobileApiError(message, response.status, code, body);
  }
  return body as T;
}

export const apiRequest = request;

export async function refreshSession(): Promise<SessionResponse | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = performSessionRefresh();
  try { return await refreshInFlight; }
  finally { refreshInFlight = null; }
}

async function performSessionRefresh(): Promise<SessionResponse | null> {
  const refreshToken = await getRefreshToken();
  if (!refreshToken || !API_BASE_URL) return null;
  const response = await fetch(`${API_BASE_URL}/api/mobile/auth/refresh`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({refreshToken})});
  if (!response.ok) { await clearSession(); return null; }
  const next = await response.json() as SessionResponse;
  await saveSession(next.accessToken, next.refreshToken);
  return next;
}

export type AccountBootstrap = {
  ownerAddress: string; universalAccount: string; walletProvider: 'magic'; accountMode: 'eip7702';
  strategyReady: boolean; delegationState: 'required' | 'active'; recoveredExistingAccount: boolean;
  chainVerification?: 'finalized' | 'unavailable'; chainBlockNumber?: number | null;
  managedProgramEnrollment?: ManagedProgramEnrollment;
};

export const mobileApi = {
  challenge: (address: string, deviceId: string) => request<{message: string; challengeToken: string}>('/api/mobile/auth/challenge', {method: 'POST', body: JSON.stringify({address, deviceId})}),
  createSession: async (input: {address: string; signature: string; challengeToken: string; deviceId: string; deviceName: string; email?: string}) => {
    const result = await request<SessionResponse>('/api/mobile/auth/session', {method: 'POST', body: JSON.stringify(input)});
    await saveSession(result.accessToken, result.refreshToken); return result;
  },
  logout: async () => { const refreshToken = await getRefreshToken(); try { await request('/api/mobile/auth/logout', {method: 'POST', body: JSON.stringify({refreshToken})}); } finally { await clearSession(); } },
  bootstrapAccount: () => request<AccountBootstrap>('/api/mobile/account/bootstrap', {method: 'POST', body: '{}'}),
  verifyMagicChain: () => request<{ownerAddress: string; delegationState: 'required' | 'active';
    delegateAddress: string | null; blockNumber: number; blockHash: string;
    usdcUnits: string; ethWei: string}>('/api/mobile/account/chain-state', {method: 'POST', body: '{}'}),
  home: async () => validateHomeSnapshot(await request<MobileHomeSnapshot>('/api/mobile/home')),
  funding: () => request<FundingSnapshot>('/api/mobile/funding'),
  refreshFunding: () => request<FundingSnapshot>('/api/mobile/funding/refresh', {method: 'POST', body: '{}'}),
  activity: () => request<ActivityItem[]>('/api/mobile/activity'),
  autopilotLimits: () => request<AutopilotLimits>('/api/mobile/autopilot/start'),
  autopilotWalletReadiness: () => request<AutopilotWalletReadiness>('/api/mobile/account/execution-readiness'),
  currentManagedSpotMandate: () => request<{mandate: ManagedSpotMandate | null}>('/api/mobile/autopilot/mandate'),
  requestManagedSpotMandate: (capitalUnits: string, durationDays: number, idempotencyKey: string) =>
    request<{mandate: Pick<ManagedSpotMandate, 'mandateId' | 'mandateHash' | 'status' | 'vaultAddress'>}>(
      '/api/mobile/autopilot/mandate', {method: 'POST',
        body: JSON.stringify({capitalUnits, durationDays}), headers: {'Idempotency-Key': idempotencyKey}}),
  provisionManagedSpotVault: () => request<{status: string; mandateId: string;
    vaultAddress?: string; transactionHash?: string; retryBroadcast?: false}>(
      '/api/mobile/autopilot/mandate/provision', {method: 'POST', body: '{}'}),
  prepareManagedSpotFunding: () => request<{operationId: string; rootHash: string; expiresAt: number;
    ownerAddress: string; vaultAddress: string; capitalUnits: string; programVersionId: string;
    quotedFeeAsset: 'USDC' | 'ETH'; quotedFeeUnits: string;
    maxTotalSourceUnits: string; durationDays: number}>(
      '/api/mobile/autopilot/funding/prepare', {method: 'POST', body: '{}'}),
  submitManagedSpotFunding: (operationId: string, signature: string) =>
    request<{operationId: string; status: 'submitted' | 'uncertain'; retryBroadcast: false}>(
      '/api/mobile/autopilot/funding/submit', {method: 'POST', body: JSON.stringify({operationId, signature})}),
  managedSpotFundingStatus: (operationId: string) => request<{operationId: string; status: string;
    funded: boolean; vaultUsdcUnits: string; vaultWethUnits: string;
    finalizedBlockNumber: string; retryBroadcast: false}>(
      `/api/mobile/autopilot/funding/status?operationId=${encodeURIComponent(operationId)}`),
  managedVaultRelease: () => request<{status: 'not_applicable' | 'awaiting_close' | 'ready' | 'awaiting_finality' | 'reconciliation_needed' | 'released';
    vaultAddress?: string; ownerAddress?: string; vaultUsdcUnits?: string; ownerUsdcUnits?: string;
    finalizedBlockNumber?: string; finalizedBlockHash?: string;
    releaseProof?: {status: 'confirmed'; amountUnits: string; transactionHash: string;
      blockNumber: string; blockHash: string} | null;
    transaction?: {from: string; to: string; data: string; value: string}}>(
      '/api/mobile/autopilot/vault-release'),
  activateManagedSpotVault: () => request<{status: 'ready'; mandateId: string;
    sourceAccountId: string; financeSnapshotHash: string; activationReceiptId: string;
    activationReceiptHash: string; executionQualified: false}>(
      '/api/mobile/autopilot/vault-activation', {method: 'POST', body: '{}'}),
  confirmAutopilotMode: () => request<{snapshot: MobileHomeSnapshot; started: false; liveTradingEnabled: false}>('/api/mobile/autopilot/confirm', {method: 'POST', body: JSON.stringify({confirmed: true})}),
  uniswapGrantContext: () => request<ManagedProgramGrantContext>('/api/mobile/autopilot/grant-context'),
  prepareScopedGrants: (idempotencyKey: string) => request<ScopedGrantPreparation>('/api/mobile/autopilot/scoped-grant/prepare', {
    method: 'POST', body: '{}', headers: {'Idempotency-Key': idempotencyKey},
  }),
  activateScopedGrant: (scope: 'buy' | 'exit', signature: string, idempotencyKey: string) =>
    request<{grant: ManagedScopedGrant; activationReceiptReady: false; liveTradingEnabled: false}>(
      '/api/mobile/autopilot/scoped-grant/activate', {method: 'POST', body: JSON.stringify({scope, signature}), headers: {'Idempotency-Key': idempotencyKey}}),
  readScopedGrantAllowance: (scope: 'buy' | 'exit', idempotencyKey: string) =>
    request<ScopedGrantAllowance>('/api/mobile/autopilot/scoped-grant/allowance', {
      method: 'POST', body: JSON.stringify({scope}), headers: {'Idempotency-Key': idempotencyKey},
    }),
  publishManagedActivationAuthority: (idempotencyKey: string) => request<{
    status: 'ready'; activationReceiptId: string; activationReceiptHash: string;
    executionGrantId: string; executionGrantHash: string; expiresAt: number;
    authority: string; executionQualified: false; liveTradingEnabled: false; nextStep: string;
  }>('/api/mobile/autopilot/activation-authority', {method: 'POST', body: '{}', headers: {'Idempotency-Key': idempotencyKey}}),
  startAutopilot: () => request<{snapshot: MobileHomeSnapshot; limits: AutopilotLimits}>('/api/mobile/autopilot/start', {method: 'POST', body: JSON.stringify({confirmed: true})}),
  stopAutopilot: (idempotencyKeys: string[] = []) => request<{snapshot: MobileHomeSnapshot; stopState?: {
    assignmentPaused: boolean; temporalCleanupRequested: boolean; scopedGrantRevocation: 'buy_revoked_exit_retained' | 'buy_revoked_exit_expired' | 'vault_stopped_close_available' | 'pending' | 'no_known_grants';
    nativeFinanceAdmissionStopped: boolean; nativeFinanceAdmissionStopStatus: 'stopped' | 'not_registered' | 'pending';
    submittedOperationMayStillSettle: boolean; positionClosure: 'unconfirmed';
    revokedBuyScopes: number; failedBuyScopes: number; verifiedExitScopes: number;
    expiredExitScopes: number; unverifiedExitScopes: number;
    exitGrantStatus: 'verified_active' | 'expired' | 'partial_or_unverified' | 'no_known_grants' | 'vault_close_available';
    exitGrantExpiresAt: number | null;
    vaultStopStatus?: 'confirmed' | 'pending' | 'not_applicable';
    onChainVaultStopConfirmed?: boolean;
  }}>('/api/mobile/autopilot/stop', {method: 'POST', body: JSON.stringify({idempotencyKeys})}),
  closeManagedPosition: (assignmentId: string, idempotencyKey: string) => request<ManagedCloseResult>(
    '/api/mobile/autopilot/close-position', {method: 'POST', body: JSON.stringify({assignmentId, idempotencyKey})}),
  hyperliquidBindingChallenge: (scope: HyperliquidBindingScope) =>
    request<HyperliquidBindingChallenge>('/api/mobile/venues/hyperliquid/binding-challenge',
      {method: 'POST', body: JSON.stringify(scope)}),
  registerHyperliquidApiWallet: (input: {attemptId: string; challengeId: string;
    ownerSignature: string; apiWalletPrivateKey: string}) =>
    request<HyperliquidCredentialRegistration>('/api/mobile/venues/hyperliquid/credentials',
      {method: 'POST', body: JSON.stringify(input)}, false),
  prepareSigningProof: () => request<SigningProofPrepared>('/api/mobile/signing-proof/prepare', {method: 'POST', body: '{}'}),
  verifySigningProof: (proofId: string, typedDataSignature: string, rootHashSignature: string) => request<SigningProofVerified>('/api/mobile/signing-proof/verify', {method: 'POST', body: JSON.stringify({proofId, typedDataSignature, rootHashSignature})}),
  prepareActivation: () => request<PreparedMobileActivation>('/api/mobile/account/activation/prepare', {method: 'POST', body: '{}'}),
  confirmActivation: (operationId: string, transactionHash: string) => request('/api/mobile/account/activation/confirm', {method: 'POST', body: JSON.stringify({operationId, transactionHash})}),
  activationStatus: (operationId: string) => request(`/api/mobile/account/activation/${encodeURIComponent(operationId)}`),
  prepareUa: (intent: unknown, idempotencyKey: string) => request<UaPreparedOperation>('/api/mobile/ua/prepare', {method: 'POST', body: JSON.stringify({intent, idempotencyKey})}),
  submitUa: (operationId: string, signatures: UaSignature[]) => request('/api/mobile/ua/submit', {method: 'POST', body: JSON.stringify({operationId, signatures})}),
  prepareWithdrawal: (amount: string, destination: string, idempotencyKey: string) => request<PreparedWithdrawal>('/api/mobile/withdrawals/prepare', {method: 'POST', body: JSON.stringify({amount, destination, idempotencyKey})}),
  reportWithdrawalBroadcast: (input: {operationId: string; outcome: 'submitted' | 'cancelled' | 'uncertain'; transactionHash?: string}) => request<WithdrawalStatus>('/api/mobile/withdrawals/broadcast-result', {method: 'POST', body: JSON.stringify(input)}),
  withdrawalStatus: (operationId: string) => request<WithdrawalStatus>(`/api/mobile/withdrawals/${encodeURIComponent(operationId)}`),
};
