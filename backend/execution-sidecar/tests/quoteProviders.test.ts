import {test} from "node:test";
import assert from "node:assert/strict";
import {MoonPayQuoteAdapter} from "../src/mobile/providers/moonpayQuotes.js";
import {TransakQuoteAdapter} from "../src/mobile/providers/transakQuotes.js";
import {BanxaQuoteAdapter} from "../src/mobile/providers/banxaQuotes.js";
import {decimal} from "../src/mobile/providers/quoteCommon.js";
import {QuoteError} from "../src/mobile/quoteContracts.js";
import type {OnRampAdapter} from "../src/mobile/contracts.js";
import type {JsonRequest} from "../src/mobile/providers/http.js";

const owner = '0x1111111111111111111111111111111111111111' as const;
const input = {amount: '25.00', fiatCurrency: 'USD', clientIp: '203.0.113.1'};
const moonConfig = {apiKey: 'synthetic', secret: 'synthetic', webhookSecret: 'synthetic', currencyCode: 'usdc_arbitrum', sandbox: true};
const transakConfig = {apiKey: 'synthetic', secret: 'synthetic', referrerDomain: 'moeazi.example', sandbox: true};
const banxaConfig = {apiKey: 'synthetic', partner: 'synthetic', webhookKey: 'synthetic', webhookSecret: 'synthetic', blockchain: 'ARB', sandbox: true, checkoutHosts: ['checkout.banxa.com']};
function moon(fiat = 'USD') {return {baseCurrencyCode: fiat.toLowerCase(), quoteCurrencyCode: 'usdc_arbitrum', baseCurrencyAmount: '22', totalAmount: '25', quoteCurrencyAmount: '22.000000', feeAmount: '2', networkFeeAmount: '1', extraFeeAmount: '0', paymentMethod: 'credit_debit_card'};}
function transak(fiat = 'USD') {return {data: {fiatCurrency: fiat, fiatAmount: '25', cryptoCurrency: 'USDC', network: 'arbitrum', isBuyOrSell: 'BUY', cryptoAmount: '22', paymentMethod: 'credit_debit_card', feeBreakdown: [{id: 'transak_fee', value: '2'}, {id: 'network_fee', value: '1'}]}};}
function banxa() {return {fiatAmount: '25', cryptoAmount: '22.00000000', processingFee: '2', networkFee: '1', paymentMethodId: 'debit-credit-card'};}
function adapters(request: JsonRequest): OnRampAdapter[] {
  return [new MoonPayQuoteAdapter(moonConfig, request, request), new TransakQuoteAdapter(transakConfig, request, undefined, request), new BanxaQuoteAdapter(banxaConfig, request, request)];
}
for (const fiat of ['USD', 'EUR', 'GBP']) {
  for (const provider of ['moonpay', 'transak', 'banxa']) test(`${provider}: normalized ${fiat} total-budget card quote`, async () => {
    const request: JsonRequest = async url => {
      const query = new URL(url).searchParams;
      if (provider === 'moonpay') {assert.equal(query.get('areFeesIncluded'), 'true'); assert.equal(query.get('extraFeePercentage'), '0'); return moon(fiat);}
      if (provider === 'transak') {assert.equal(query.get('network'), 'arbitrum'); return transak(fiat);}
      assert.equal(query.get('paymentMethodId'), 'debit-credit-card'); return banxa();
    };
    const adapter = adapters(request).find(a => a.pin.id === provider)!;
    const quote = await adapter.getQuote!({...input, fiatCurrency: fiat});
    assert.equal(adapter.pin.version, '2'); assert.equal(quote.estimate.requestedBudget, '25');
    assert.equal(quote.estimate.estimatedTotal, '25'); assert.equal(quote.estimate.estimatedUsdc, '22');
    assert.equal(quote.estimate.paymentMethod, 'card'); assert.ok(quote.estimate.expiresAt <= Date.now() + 30000);
    assert.equal(adapter.quoteCapabilities!().cacheMs, provider === 'banxa' ? 0 : 30000);
  });
}
test('MoonPay minimum clamping cannot pretend a small budget buys more', async () => {
  const adapter = new MoonPayQuoteAdapter(moonConfig, undefined, async () => ({...moon(), baseCurrencyAmount: '40', totalAmount: '43'}));
  await assert.rejects(adapter.getQuote({...input, amount: '10'}), e => e instanceof QuoteError && e.code === 'MINIMUM_AMOUNT' && e.bounds.minimumAmount === '43');
  await assert.rejects(new MoonPayQuoteAdapter(moonConfig, undefined, async () => ({...moon(), baseCurrencyAmount: '9', totalAmount: '12'})).getQuote({...input, amount: '10'}), e => e instanceof QuoteError && e.code === 'MINIMUM_AMOUNT');
});
test('unknown fees stay unknown; unsafe precision, negative and exponential values fail', async () => {
  const adapter = new MoonPayQuoteAdapter(moonConfig, undefined, async () => ({...moon(), feeAmount: undefined, networkFeeAmount: null}));
  assert.equal((await adapter.getQuote(input)).estimate.fees[0].amount, null);
  for (const value of ['1e3', '-1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1.0000001']) assert.throws(() => decimal(value, 6));
  assert.equal(decimal('1000000000000000.000001', 6), '1000000000000000.000001');
});
test('wrong asset, currency, network and payment method are rejected', async () => {
  for (const patch of [{quoteCurrencyCode: 'usdc.e'}, {baseCurrencyCode: 'eur'}, {paymentMethod: 'paypal'}, {extraFeeAmount: '1'}, {quoteCurrencyAmount: '1.0000001'}]) {
    await assert.rejects(new MoonPayQuoteAdapter(moonConfig, undefined, async () => ({...moon(), ...patch})).getQuote(input));
  }
  await assert.rejects(new TransakQuoteAdapter(transakConfig, undefined, undefined, async () => ({data: {...transak().data, network: 'ethereum'}})).getQuote(input));
  await assert.rejects(new TransakQuoteAdapter(transakConfig).getQuote({...input, clientIp: undefined}));
  await assert.rejects(new BanxaQuoteAdapter(banxaConfig, undefined, async () => ({...banxa(), crypto: 'USDC.e'})).getQuote(input));
  await assert.rejects(new BanxaQuoteAdapter(banxaConfig, undefined, async () => [banxa(), banxa()]).getQuote(input));
});
test('MoonPay checkout uses provider-owned base amount and signs its card/zero-commission parameters', async () => {
  const adapter = new MoonPayQuoteAdapter(moonConfig, undefined, async () => moon());
  const quote = await adapter.getQuote(input);
  const url = new URL((await adapter.createCheckout({...input, owner, purchaseId: 'purchase-quote-test', customerId: 'opaque', returnUrl: 'https://moeazi.example/return', quote})).url);
  assert.equal(url.searchParams.get('baseCurrencyAmount'), '22'); assert.equal(url.searchParams.get('paymentMethod'), 'credit_debit_card');
  assert.equal(url.searchParams.get('extraFeePercentage'), '0'); assert.ok(url.searchParams.get('signature'));
});
test('Banxa requests fresh per-order pricing and preserves checkout-only fallback', async () => {
  let quoteReads = 0, body: Record<string, unknown> = {};
  const request: JsonRequest = async (_url, init) => {body = JSON.parse(String(init?.body)); return {id: 'order', checkoutUrl: 'https://checkout.banxa.com/order'};};
  const adapter = new BanxaQuoteAdapter(banxaConfig, request, async () => {quoteReads++; return banxa();});
  const quote = await adapter.getQuote(input);
  await adapter.createCheckout({...input, owner, purchaseId: 'purchase-quote-test', customerId: 'opaque', returnUrl: 'https://moeazi.example/return', quote});
  assert.equal(quoteReads, 2); assert.equal(body.paymentMethodId, 'debit-credit-card'); assert.equal(body.walletAddress, owner);
  await new BanxaQuoteAdapter(banxaConfig, request, async () => {throw new QuoteError('UNAVAILABLE', 'fixture');}).createCheckout({...input, owner, purchaseId: 'fallback', customerId: 'opaque', returnUrl: 'https://moeazi.example/return'});
});
