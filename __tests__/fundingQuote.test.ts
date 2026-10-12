import {quoteBlocksCheckout, validFiatAmount, validateFundingQuote} from '../src/services/fundingQuote';
import {previewQuote} from '../src/fixtures/fundingQuote';
import type {FundingQuote} from '../src/types/fundingQuote';
const input = {provider: 'preview-alpha', amount: '25.00', fiatCurrency: 'GBP'};
test('exact positive fiat input rejects excessive precision, negatives, exponent notation and zero', () => {
  for (const value of ['0', '0.00', '-10', '1e3', '01', '1.001', '']) expect(validFiatAmount(value)).toBe(false);
  for (const value of ['10', '25.00', '0.01', '1000000000000.01']) expect(validFiatAmount(value)).toBe(true);
});
test('preview estimate is explicitly sandbox and input/version bound', () => {
  const value = previewQuote(input);
  expect(validateFundingQuote(value, input, '1').environment).toBe('sandbox');
  for (const patch of [{provider: {id: 'another', version: '1'}}, {estimatedTotal: '30'}, {estimatedUsdc: '1.0000001'}, {expiresAt: 1}, {fiatCurrency: 'USD'}, {paymentMethod: 'paypal'}]) {
    expect(() => validateFundingQuote({...value, ...patch} as FundingQuote, input, '1')).toThrow();
  }
  expect(() => validateFundingQuote(value, input, '2')).toThrow();
});
test('unknown fees are preserved and unavailable estimates allow deliberate checkout fallback', () => {
  jest.useFakeTimers();
  try {
    const value = previewQuote(input);
    if (value.status !== 'ready') throw new Error('fixture');
    expect(validateFundingQuote({...value, fees: [{label: 'Provider fee', amount: null}]}, input, '1')).toBeTruthy();
    const unavailable: FundingQuote = {...value, status: 'unavailable', code: 'UNAVAILABLE', message: 'Fixture unavailable'};
    expect(quoteBlocksCheckout(unavailable)).toBe(false);
    expect(quoteBlocksCheckout({...unavailable, code: 'MINIMUM_AMOUNT'})).toBe(true);
    expect(quoteBlocksCheckout({...unavailable, code: 'MAXIMUM_AMOUNT'})).toBe(true);
    expect(quoteBlocksCheckout({...unavailable, code: 'INVALID'})).toBe(true);
  } finally { jest.useRealTimers(); }
});
