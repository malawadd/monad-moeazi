import {apiRequest} from './apiClient';
import type {ActivationReview, FundingOptions, GasReadiness, Purchase, SignedAuthorization, SponsoredOperation, SponsoredStatus} from '../types/connectors';
import type {FundingQuote, FundingQuoteInput} from '../types/fundingQuote';
const post = (input: unknown) => ({method: 'POST', body: JSON.stringify(input)});
export const connectorsApi = {
  options: () => apiRequest<FundingOptions>('/api/mobile/funding/options'),
  quote: (input: FundingQuoteInput, signal?: AbortSignal) => apiRequest<FundingQuote>('/api/mobile/funding/quotes', {...post(input), signal}),
  purchase: (input: {provider: string; fiatCurrency: string; amount: string; idempotencyKey: string; quoteReference?: string}) => apiRequest<Purchase>('/api/mobile/funding/purchases', post(input)),
  pending: () => apiRequest<Purchase[]>('/api/mobile/funding/purchases'),
  purchaseStatus: (id: string) => apiRequest<Purchase>(`/api/mobile/funding/purchases/${encodeURIComponent(id)}`),
  gas: () => apiRequest<GasReadiness>('/api/mobile/gas/readiness'),
  activation: (idempotencyKey: string) => apiRequest<ActivationReview>('/api/mobile/v2/account/activation/prepare', post({idempotencyKey})),
  authorize: (operationId: string, authorization: SignedAuthorization) => apiRequest<SponsoredOperation>('/api/mobile/v2/account/activation/authorize', post({operationId, authorization})),
  withdrawal: (amount: string, destination: string, idempotencyKey: string) => apiRequest<SponsoredOperation>('/api/mobile/v2/withdrawals/prepare', post({amount, destination, idempotencyKey})),
  submit: (prepared: SponsoredOperation, signature: string, authorization?: SignedAuthorization) => apiRequest<SponsoredStatus>(`/api/mobile/v2/${prepared.intent.kind === 'activation' ? 'account/activation' : 'withdrawals'}/submit`, post({operationId: prepared.operationId, reviewHash: prepared.reviewHash, signature, ...(authorization ? {authorization} : {})})),
  status: (kind: 'activation' | 'withdrawal', id: string) => apiRequest<SponsoredStatus>(`/api/mobile/v2/${kind === 'activation' ? 'account/activation' : 'withdrawals'}/${encodeURIComponent(id)}`),
};
