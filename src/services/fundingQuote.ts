import type {FundingQuote, FundingQuoteInput} from '../types/fundingQuote';
export function validFiatAmount(value: string) {
  return value.length <= 70 && /^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value) && /[1-9]/.test(value);
}
export function quoteKey(input: FundingQuoteInput) {return JSON.stringify(input);}
export function validateFundingQuote(value: FundingQuote, input: FundingQuoteInput, expectedVersion?: string): FundingQuote {
  if (!value || value.schemaVersion !== '2026-09-29' || value.provider?.id !== input.provider ||
    !['sandbox', 'production'].includes(value.environment)) throw new Error('The estimate does not match this provider.');
  if (value.status === 'unavailable') {
    if (!['UNAVAILABLE', 'UNSUPPORTED', 'MINIMUM_AMOUNT', 'MAXIMUM_AMOUNT', 'INVALID', 'RATE_LIMITED', 'EXPIRED'].includes(value.code) || typeof value.message !== 'string') throw new Error('The estimate response is incomplete.');
    return value;
  }
  const normalized = input.amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (value.status !== 'ready' || value.provider.version !== expectedVersion || value.requestedBudget !== normalized || value.estimatedTotal !== normalized ||
    value.fiatCurrency !== input.fiatCurrency || value.paymentMethod !== 'card' || !validFiatAmount(value.estimatedTotal) ||
    !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value.estimatedUsdc) || !/[1-9]/.test(value.estimatedUsdc) ||
    !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || !Number.isFinite(value.observedAt) || value.observedAt > Date.now() + 1000 ||
    value.expiresAt > value.observedAt + 30000 || !/^[a-f0-9-]{36}$/.test(value.quoteReference) || !Array.isArray(value.fees) || value.fees.some(f =>
      typeof f.label !== 'string' || f.amount !== null && (typeof f.amount !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(f.amount)))) throw new Error('The estimate changed or expired. Check again.');
  return value;
}
export function quoteBlocksCheckout(quote: FundingQuote | null) {
  return quote?.status === 'unavailable' && ['MINIMUM_AMOUNT', 'MAXIMUM_AMOUNT', 'INVALID'].includes(quote.code);
}
