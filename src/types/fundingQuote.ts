import type {ProviderPin} from './connectors';
export type FundingQuoteInput = {provider: string; fiatCurrency: string; amount: string};
export type FundingQuote = {schemaVersion: '2026-09-29'; provider: ProviderPin; environment: 'sandbox' | 'production'} & (
  {status: 'ready'; quoteReference: string; requestedBudget: string; fiatCurrency: string; estimatedTotal: string; estimatedUsdc: string;
    fees: {label: string; amount: string | null}[]; paymentMethod: 'card'; observedAt: number; expiresAt: number} |
  {status: 'unavailable'; code: 'UNAVAILABLE' | 'UNSUPPORTED' | 'MINIMUM_AMOUNT' | 'MAXIMUM_AMOUNT' | 'INVALID' | 'RATE_LIMITED' | 'EXPIRED'; message: string; minimumAmount?: string; maximumAmount?: string}
);
