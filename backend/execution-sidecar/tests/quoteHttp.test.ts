import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestQuoteJson} from '../src/mobile/providers/quoteCommon.js';
import {QuoteError} from '../src/mobile/quoteContracts.js';
import {MoonPayQuoteAdapter} from '../src/mobile/providers/moonpayQuotes.js';

test('quote transport normalizes limit, outage, malformed and rate errors without exposing provider text', async t => {
  const cases = [
    {status: 400, body: {moonPayErrorCode: 'MIN_AMOUNT', message: 'private provider payload'}, code: 'UNSUPPORTED'},
    {status: 429, body: {}, code: 'RATE_LIMITED'},
    {status: 503, body: {}, code: 'UNAVAILABLE'},
    {status: 400, body: {}, code: 'UNSUPPORTED'},
    {status: 200, body: null, code: 'INVALID'},
  ];
  for (const value of cases) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(value.body), {status: value.status}));
    await assert.rejects(requestQuoteJson('https://fixture.invalid/quote'), error => error instanceof QuoteError && error.code === value.code && !error.message.includes('private'));
    fetchMock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => {throw new Error('private credential in synthetic exception');});
  await assert.rejects(requestQuoteJson('https://fixture.invalid/quote'), error => error instanceof QuoteError && error.code === 'UNAVAILABLE' && !error.message.includes('credential'));
});

test('MoonPay owns amount-limit error translation, without leaking raw response text', async t => {
  const adapter = new MoonPayQuoteAdapter({apiKey: 'synthetic', secret: 'synthetic', webhookSecret: 'synthetic', currencyCode: 'usdc_arbitrum', sandbox: true});
  for (const [code, normalized] of [['MIN_AMOUNT', 'MINIMUM_AMOUNT'], ['MAX_AMOUNT', 'MAXIMUM_AMOUNT']]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({moonPayErrorCode: code, message: 'private provider payload'}), {status: 400}));
    await assert.rejects(adapter.getQuote({amount: '25', fiatCurrency: 'USD'}), error => error instanceof QuoteError && error.code === normalized && !error.message.includes('private'));
    mock.mock.restore();
  }
});

test('MoonPay explains its observed sandbox asset restriction instead of inventing an estimate', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({moonPayErrorCode: '1_SYS_UNKNOWN', message: 'Currency not supported in test mode', type: 'BadRequestError'}), {status: 400}));
  const adapter = new MoonPayQuoteAdapter({apiKey: 'synthetic', secret: 'synthetic', webhookSecret: 'synthetic', currencyCode: 'usdc_arbitrum', sandbox: true});
  await assert.rejects(adapter.getQuote({amount: '50', fiatCurrency: 'USD'}), error => error instanceof QuoteError && error.code === 'UNSUPPORTED' && error.message.includes('sandbox mode'));
});
