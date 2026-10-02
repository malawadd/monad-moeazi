import {test} from 'node:test';
import assert from 'node:assert/strict';
import {QuoteService} from '../src/mobile/quotes.js';
import {AdapterRegistry} from '../src/mobile/registry.js';
import {makeQuote} from '../src/mobile/providers/quoteCommon.js';
import {MemoryQuoteStore} from './quoteFixtures.js';
import {MemoryStore} from './storeFixture.js';
import {PurchaseService} from '../src/mobile/purchases.js';
import type {OnRampAdapter} from '../src/mobile/contracts.js';
import type {Registries} from '../src/mobile/configuration.js';
import type {AdapterQuote, QuoteResult} from '../src/mobile/quoteContracts.js';
import {createPublicClient, http} from 'viem';
import {arbitrum} from 'viem/chains';

const owner = '0x1111111111111111111111111111111111111111' as const, subject = `magic:${owner}`;
const input = {provider: 'fake-alpha', amount: '25', fiatCurrency: 'USD'};
function fixture(cacheMs = 30000) {
  let calls = 0, creates = 0, passedQuote: AdapterQuote | undefined;
  const funding = new AdapterRegistry<OnRampAdapter>();
  for (const id of ['fake-alpha', 'fake-beta']) for (const version of ['1', '2']) funding.register({id, version, validate: () => null, create: () => ({
    pin: {id, version}, capabilities: () => ({id, version, name: 'Fake', available: true, checkoutHosts: ['provider.example']}),
    quoteCapabilities: () => ({paymentMethod: 'card', cacheMs}),
    getQuote: async value => {calls++; return makeQuote(value, value.amount, '22', [{label: 'Provider fee', amount: null}]);},
    createCheckout: async value => {creates++; passedQuote = value.quote; return {url: 'https://provider.example/checkout', externalId: value.purchaseId, expiresAt: Date.now() + 300000};},
    getOrder: async () => null, verifyWebhook: async () => {throw new Error('fixture');},
  })});
  const registries = {funding} as Registries;
  const env = {MOBILE_PURCHASES_ENABLED: 'true', MOBILE_FUNDING_QUOTES_ENABLED: 'true', MOBILE_FUNDING_PROVIDERS: 'fake-alpha@2,fake-beta@2', MOBILE_PUBLIC_RETURN_ORIGIN: 'https://moeazi.example', WORKER_SHARED_SECRET: 'synthetic', 'FAKE-ALPHA_SANDBOX': 'true'};
  const store = new MemoryQuoteStore(), service = new QuoteService(registries, env, store);
  return {service, store, registries, env, calls: () => calls, creates: () => creates, passedQuote: () => passedQuote};
}
function ready(result: QuoteResult) {if (result.status !== 'ready') throw new Error(result.message); return result;}
test('two fake connectors replace each other without changes to service or wire shape', async () => {
  const f = fixture();
  for (const provider of ['fake-alpha', 'fake-beta']) assert.equal(ready(await f.service.estimate(subject, {...input, provider})).estimatedUsdc, '22');
  assert.equal(f.calls(), 2);
});
test('cache and concurrent requests avoid repeated provider calls; zero-cache provider never reuses pricing', async () => {
  const f = fixture();
  const first = await Promise.all([f.service.estimate(subject, input), f.service.estimate(subject, input)]);
  assert.equal(ready(first[0]).quoteReference, ready(first[1]).quoteReference); assert.equal(f.calls(), 1);
  await f.service.estimate(subject, {...input, amount: '25.00'}); assert.equal(f.calls(), 1);
  const uncached = fixture(0); await uncached.service.estimate(subject, input); await uncached.service.estimate(subject, input); assert.equal(uncached.calls(), 2);
});
test('rate limit is twelve provider calls, not twelve cached reads', async () => {
  const f = fixture(0);
  for (let n = 0; n < 12; n++) ready(await f.service.estimate(subject, {...input, amount: String(25+n)}));
  const last = await f.service.estimate(subject, {...input, amount: '50'}); assert.equal(last.status === 'unavailable' && last.code, 'RATE_LIMITED'); assert.equal(f.calls(), 12);
});
test('closed rollout, unsupported inputs and retired providers do not reach providers', async () => {
  const f = fixture(); f.env.MOBILE_FUNDING_QUOTES_ENABLED = 'false';
  assert.equal((await f.service.estimate(subject, input)).status, 'unavailable'); assert.equal(f.calls(), 0);
  f.env.MOBILE_FUNDING_QUOTES_ENABLED = 'true';
  for (const patch of [{amount: '0'}, {amount: '1.001'}, {amount: '1e3'}, {chainId: 1}, {contract: owner}, {fiatCurrency: 'XYZ'}]) assert.equal((await f.service.estimate(subject, {...input, ...patch})).status, 'unavailable');
  f.env.MOBILE_FUNDING_PROVIDERS = 'fake-beta@2'; assert.equal((await f.service.estimate(subject, input)).status, 'unavailable'); assert.equal(f.calls(), 0);
});
test('references bind owner, environment, provider version, budget, currency and trusted IP', async () => {
  const f = fixture(), result = ready(await f.service.estimate(subject, input, '203.0.113.1'));
  const withReference = {...input, quoteReference: result.quoteReference};
  assert.ok(await f.service.resolve(subject, withReference, '203.0.113.1'));
  for (const patch of [{amount: '26'}, {fiatCurrency: 'GBP'}, {provider: 'fake-beta'}]) await assert.rejects(f.service.resolve(subject, {...withReference, ...patch}, '203.0.113.1'));
  await assert.rejects(f.service.resolve(`magic:0x${'2'.repeat(40)}`, withReference, '203.0.113.1'));
  await assert.rejects(f.service.resolve(subject, withReference, '203.0.113.2'));
  f.env['FAKE-ALPHA_SANDBOX'] = 'false'; await assert.rejects(f.service.resolve(subject, withReference, '203.0.113.1'));
  f.env['FAKE-ALPHA_SANDBOX'] = 'true';
  f.env.MOBILE_FUNDING_PROVIDERS = 'fake-alpha@1'; await assert.rejects(f.service.resolve(subject, withReference, '203.0.113.1'));
  f.env.MOBILE_FUNDING_PROVIDERS = 'fake-alpha@2';
  const saved = f.store.references.get(result.quoteReference)!; saved.quote.estimate.expiresAt = 1;
  await assert.rejects(f.service.resolve(subject, withReference, '203.0.113.1'));
});

test('redis failures fail closed without provider calls or durable state', async () => {
  const f = fixture();
  f.store.cached = async () => {throw new Error('synthetic redis outage');};
  const result = await f.service.estimate(subject, input);
  assert.equal(result.status === 'unavailable' && result.code, 'UNAVAILABLE');
  assert.equal(f.calls(), 0); assert.equal(f.store.references.size, 0);
});
test('purchase receives only server-owned quote; an expired reference cannot defeat purchase idempotency', async () => {
  const f = fixture(), store = new MemoryStore({userId: 'synthetic', ownerAddress: owner, profilePaused: true, hasPendingExecution: false, emergencyStop: false});
  const purchases = new PurchaseService(store, f.registries, f.env, createPublicClient({chain: arbitrum, transport: http('http://127.0.0.1:1')}), f.service);
  const estimate = ready(await f.service.estimate(subject, input));
  assert.equal(store.rows.size, 0);
  const request = {...input, idempotencyKey: 'purchase-quote-idempotency-01', quoteReference: estimate.quoteReference};
  const original = await purchases.create(subject, owner, request); assert.ok(f.passedQuote());
  f.store.references.clear();
  assert.equal((await purchases.create(subject, owner, request)).purchaseId, original.purchaseId); assert.equal(f.creates(), 1);
  await assert.rejects(purchases.create(subject, owner, {...request, idempotencyKey: 'purchase-quote-idempotency-02'}));
  assert.equal(store.rows.size, 1);
});
