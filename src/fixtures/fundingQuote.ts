import type {FundingQuote, FundingQuoteInput} from '../types/fundingQuote';
export function previewQuote(input: FundingQuoteInput): FundingQuote {
  // Explicit synthetic fixture only: never used for an authenticated account.
  const cents = BigInt(input.amount.split('.')[0]) * 100n + BigInt((input.amount.split('.')[1] ?? '').padEnd(2, '0'));
  const received = cents > 100n ? cents - 100n : cents;
  const amount = input.amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return {schemaVersion: '2026-09-29', provider: {id: input.provider, version: '1'}, environment: 'sandbox', status: 'ready',
    quoteReference: '00000000-0000-4000-8000-000000000001', requestedBudget: amount, fiatCurrency: input.fiatCurrency,
    estimatedTotal: amount, estimatedUsdc: `${received / 100n}.${(received % 100n).toString().padStart(2, '0')}`, fees: [{label: 'Illustrative fixture fee', amount: cents > 100n ? '1' : '0'}],
    paymentMethod: 'card', observedAt: Date.now(), expiresAt: Date.now() + 30000};
}
