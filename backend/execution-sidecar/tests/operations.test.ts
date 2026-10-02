import {test} from "node:test";
import assert from "node:assert/strict";
import {createPublicClient, http, custom, type Address, type PublicClient} from "viem";
import {arbitrum} from "viem/chains";
import {AdapterRegistry} from "../src/mobile/registry.js";
import {PurchaseService} from "../src/mobile/purchases.js";
import {SponsorshipService} from "../src/mobile/sponsorship.js";
import {MemoryStore} from "./storeFixture.js";
import {ConnectorError, type OnRampAdapter} from "../src/mobile/contracts.js";
import type {Registries} from "../src/mobile/configuration.js";
const owner = "0x1111111111111111111111111111111111111111" as Address, subject = `magic:${owner}`;
const client = createPublicClient({chain: arbitrum, transport: http("http://127.0.0.1:1", {retryCount: 0})});
function fixture(rpc: PublicClient = client) {
  const store = new MemoryStore({userId: "synthetic-user", ownerAddress: owner, profilePaused: true, hasPendingExecution: false, emergencyStop: false});
  const funding = new AdapterRegistry<OnRampAdapter>();
  let creates = 0;
  for (const id of ["fake-alpha", "fake-beta"]) funding.register({id, version: "1", name: id, validate: () => null, create: () => ({pin: {id, version: "1"},
    capabilities: () => ({id, version: "1", name: id, available: true, checkoutHosts: ["provider.example"]}),
    createCheckout: async input => {creates++; return {externalId: input.purchaseId, url: "https://provider.example/checkout", expiresAt: Date.now() + 300000};},
    getOrder: async (externalId, purchaseId) => ({externalId, purchaseId, state: "delivery_pending", occurredAt: Date.now(), eventId: "event"}),
    verifyWebhook: async () => {throw new Error("Forged webhook");}})});
  const env = {MOBILE_PURCHASES_ENABLED: "true", MOBILE_FUNDING_PROVIDERS: "fake-alpha,fake-beta", MOBILE_PUBLIC_RETURN_ORIGIN: "https://moeazi.example", WORKER_SHARED_SECRET: "synthetic"};
  const registries = {funding} as Registries;
  return {store, registries, env, creates: () => creates, service: new PurchaseService(store, registries, env, rpc)};
}
test("same purchase idempotency never creates two payments; changing provider conflicts", async () => {
  const {service, creates} = fixture();
  const input = {provider: "fake-alpha", amount: "25", fiatCurrency: "USD", idempotencyKey: "purchase-idempotency-001"};
  const [first, second] = await Promise.all([service.create(subject, owner, input), service.create(subject, owner, input)]);
  assert.equal(first.purchaseId, second.purchaseId); assert.equal(creates(), 1);
  await assert.rejects(service.create(subject, owner, {...input, provider: "fake-beta"}), /another purchase/);
});
test("cross-owner access and wallet mismatch fail", async () => {
  const {service} = fixture();
  const row = await service.create(subject, owner, {provider: "fake-alpha", amount: "25", fiatCurrency: "USD", idempotencyKey: "purchase-owner-test-001"});
  await assert.rejects(service.get("magic:another-owner", row.purchaseId), /not found/);
  await assert.rejects(service.create(subject, "0x2222222222222222222222222222222222222222", {provider: "fake-alpha", amount: "25", fiatCurrency: "USD", idempotencyKey: "purchase-owner-test-002"}), /identity/);
});
test("provider completion without transaction evidence cannot credit a wallet", async () => {
  const {service, store} = fixture();
  const row = await service.create(subject, owner, {provider: "fake-alpha", amount: "25", fiatCurrency: "USD", idempotencyKey: "purchase-delivery-test-1"});
  const status = await service.reconcile((await store.find(subject, row.purchaseId))!);
  assert.equal(status, "delivery_pending");
});

test("disabled providers retain original purchases and single-use checkout expiry", async () => {
  const {service, env, creates} = fixture();
  const input = {provider: "fake-alpha", amount: "25", fiatCurrency: "USD", idempotencyKey: "purchase-retired-test-1"};
  const original = await service.create(subject, owner, input);
  assert.ok(original.expiresAt <= Date.now() + 300000);
  env.MOBILE_PURCHASES_ENABLED = "false";
  const recovered = await service.create(subject, owner, input);
  assert.equal(recovered.purchaseId, original.purchaseId);
  assert.equal(recovered.expiresAt, original.expiresAt);
  assert.equal(creates(), 1);
  await assert.rejects(service.create(subject, owner, {...input, idempotencyKey: "new-retired-purchase-001"}), error => error instanceof ConnectorError && error.code === "UNAVAILABLE");
});

test("adapter upgrades affect new purchases only; retired webhook versions still reconcile", async () => {
  const {service, env, registries, store} = fixture();
  const old = registries.funding.resolve({id: "fake-alpha", version: "1"});
  const retained = new AdapterRegistry<OnRampAdapter>();
  for (const version of ["1", "2"]) retained.register({id: "fake-alpha", version, name: "Fake", validate: () => null, create: () => ({...old,
    pin: {id: "fake-alpha", version}, verifyWebhook: async raw => {
      if (raw !== version) throw new Error("Forged fixture");
      return {externalId: "external-original", purchaseId: original.purchaseId, state: "processing", occurredAt: Date.now(), eventId: `event-v${version}`};
    },
  })});
  registries.funding = retained;
  env.MOBILE_FUNDING_PROVIDERS = "fake-alpha@1";
  const input = {provider: "fake-alpha", amount: "25", fiatCurrency: "USD", idempotencyKey: "purchase-version-test-01"};
  const original = await service.create(subject, owner, input);
  env.MOBILE_FUNDING_PROVIDERS = "fake-alpha@2";
  const fresh = await service.create(subject, owner, {...input, idempotencyKey: "purchase-version-test-02"});
  assert.equal(original.provider.version, "1"); assert.equal(fresh.provider.version, "2");
  assert.equal((await service.create(subject, owner, input)).provider.version, "1");
  assert.equal(await service.webhook("fake-alpha", "1", {}, "/hook"), original.purchaseId);
  assert.equal((await store.find(subject, original.purchaseId))!.status, "processing");
  assert.equal((await store.find(subject, fresh.purchaseId))!.status, "checkout_ready");
  await assert.rejects(service.webhook("fake-alpha", "forged", {}, "/hook"), /not recognized/);
});

test("a purchase cannot settle against a different RPC chain", async () => {
  let receiptReads = 0;
  const wrongChain = createPublicClient({chain: arbitrum, transport: custom({request: async ({method}) => {
    if (method === "eth_chainId") return "0x1";
    receiptReads++; throw new Error("Receipt lookup must not happen on this network.");
  }}, {retryCount: 0})});
  const {service, store, registries} = fixture(wrongChain);
  const row = await service.create(subject, owner, {provider: "fake-alpha", amount: "25", fiatCurrency: "USD", idempotencyKey: "purchase-chain-test-001"});
  const provider = registries.funding.resolve({id: "fake-alpha", version: "1"});
  provider.getOrder = async externalId => ({externalId, state: "delivery_pending", occurredAt: Date.now(), eventId: "event", transactionHash: `0x${"1".repeat(64)}`});
  // Registry factories are fresh: retain this synthetic adapter for the assertion.
  registries.funding.resolve = () => provider;
  await assert.rejects(service.reconcile((await store.find(subject, row.purchaseId))!), /Arbitrum/);
  assert.equal(receiptReads, 0);
  assert.equal((await store.find(subject, row.purchaseId))!.status, "checkout_ready");
});
test("a CAS claim permits exactly one broadcaster", async () => {
  const {store} = fixture();
  const result = await store.reserve(subject, {operationId: "operation-cas-001", kind: "withdrawal", status: "prepared", idempotencyKey: "cas-idempotency-001", bindingHash: "binding", providerPinsJson: "[]", payloadJson: "{}", expiresAt: Date.now()+1000});
  const claims = await Promise.all([store.transition(subject, result.row.operationId, ["prepared"], {status: "submitting"}), store.transition(subject, result.row.operationId, ["prepared"], {status: "submitting"})]);
  assert.equal(claims.filter(row => row.transitionApplied).length, 1);
});
test("sponsorship closed by default; no RPC or provider access", async () => {
  const {store, registries} = fixture();
  const service = new SponsorshipService(store, registries, {}, client);
  assert.equal((await service.readiness(subject, owner)).available, false);
  await assert.rejects(service.prepare(subject, owner, "withdrawal", {idempotencyKey: "disabled-sponsorship-001"}), /not available/);
  assert.equal(store.rows.size, 0);
});
