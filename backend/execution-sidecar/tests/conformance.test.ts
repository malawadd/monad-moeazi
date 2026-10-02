import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {MoonPayAdapter} from "../src/mobile/providers/moonpay.js";
import {BanxaAdapter} from "../src/mobile/providers/banxa.js";
import {TransakAdapter} from "../src/mobile/providers/transak.js";
import {AdapterRegistry} from "../src/mobile/registry.js";
import {createRegistries, fundingCatalog, infrastructure} from "../src/mobile/configuration.js";
import {CHAIN, ENTRY_POINT, type OnRampAdapter} from "../src/mobile/contracts.js";
import type {Registries} from "../src/mobile/configuration.js";
import {address, amount, httpsUrl} from "../src/mobile/validation.js";

const owner = "0x1111111111111111111111111111111111111111";
const input = {owner, purchaseId: "purchase-test-0001", customerId: "opaque", fiatCurrency: "USD", amount: "10.00", returnUrl: "https://moeazi.example/return", clientIp: "203.0.113.1"} as const;
const date = new Date().toISOString();
const secret = "synthetic-secret";
const bodies: Record<string, string> = {}, headers: Record<string, HeadersInit> = {};
const transport = async (url: string, init?: RequestInit) => {
  if (init?.body) bodies[url] = String(init.body);
  if (init?.headers) headers[url] = init.headers;
  if (url.includes("refresh-token")) return {data: {accessToken: secret, expiresAt: Math.floor(Date.now()/1000) + 3600}};
  if (url.includes("auth/session")) return {data: {widgetUrl: "https://global-stg.transak.com/?session=synthetic"}};
  if (url.includes("transak.com")) return {data: [{id: "external-transak", partnerOrderId: input.purchaseId, status: "COMPLETED", updatedAt: date}]};
  if (url.includes("quotes/buy")) return [{crypto: "USDC"}];
  if (url.endsWith("/buy")) return {id: "external-banxa", checkoutUrl: "https://checkout.banxa.com/synthetic"};
  if (url.includes("banxa")) return {id: "external-banxa", externalId: input.purchaseId, status: "complete", updatedAt: date};
  return {id: "external-moonpay", externalTransactionId: input.purchaseId, status: "completed", updatedAt: date};
};
const adapters: OnRampAdapter[] = [
  new MoonPayAdapter({apiKey: "synthetic", secret, webhookSecret: secret, currencyCode: "usdc_arbitrum", sandbox: true}, transport),
  new BanxaAdapter({apiKey: "synthetic", partner: "test", webhookKey: "key", webhookSecret: secret, blockchain: "ARB", sandbox: true, checkoutHosts: ["checkout.banxa.com"]}, transport),
  new TransakAdapter({apiKey: "synthetic", secret, referrerDomain: "moeazi.example", sandbox: true}, transport),
];
for (const adapter of adapters) {
  test(`${adapter.pin.id}: shared checkout/order conformance`, async () => {
    const checkout = await adapter.createCheckout(input);
    assert.ok(checkout.expiresAt > Date.now());
    httpsUrl(checkout.url, adapter.capabilities().checkoutHosts);
    const order = await adapter.getOrder(checkout.externalId, input.purchaseId);
    assert.equal(order?.purchaseId, input.purchaseId);
    assert.equal(order?.state, "delivery_pending"); // Never received from provider completion alone.
    await assert.rejects(adapter.verifyWebhook("{}", {}, "/hook"));
  });
}
test("MoonPay: IP and URL are separately signed", async () => {
  const checkout = await adapters[0].createCheckout(input), url = new URL(checkout.url);
  assert.equal(url.searchParams.get("walletAddress"), owner);
  assert.ok(url.searchParams.get("allowedIpAddress"));
  assert.equal(url.searchParams.get("currencyCode"), "usdc_arbitrum");
  assert.equal(url.searchParams.get("showOnlyCurrencies"), "usdc_arbitrum");
  assert.equal(url.searchParams.get("lockAmount"), "true");
  await assert.rejects(adapters[0].createCheckout({...input, clientIp: undefined}));
});
test("all payloads lock owner/network/asset; no card or email data", async () => {
  await adapters[1].createCheckout(input); await adapters[2].createCheckout(input);
  const banxa = JSON.parse(Object.entries(bodies).find(([url]) => url.endsWith("/buy"))![1]);
  assert.equal(banxa.walletAddress, owner); assert.equal(banxa.crypto, "USDC"); assert.equal(banxa.blockchain, "ARB");
  const transak = JSON.parse(Object.entries(bodies).find(([url]) => url.includes("auth/session"))![1]).widgetParams;
  assert.equal(transak.walletAddress, owner); assert.equal(transak.networks, "arbitrum"); assert.equal(transak.disableWalletAddressForm, true);
  assert.equal(transak.email, undefined); assert.equal(banxa.card, undefined);
  const sessionHeaders = headers[Object.keys(headers).find(url => url.includes("auth/session"))!] as Record<string, string>;
  assert.equal(sessionHeaders["x-user-ip"], input.clientIp);
  assert.equal(sessionHeaders["x-api-key"], "synthetic");
});
test("Transak rejects checkout without trusted visitor IP before refreshing its access token", async () => {
  let calls = 0;
  const adapter = new TransakAdapter({apiKey: "synthetic", secret, referrerDomain: "moeazi.example", sandbox: false}, async () => { calls++; return {}; });
  await assert.rejects(adapter.createCheckout({...input, clientIp: undefined}), /verified connection address/);
  assert.equal(calls, 0);
});
test("Transak order recovery uses the documented exact partner-order filter", async () => {
  const urls: string[] = [];
  const adapter = new TransakAdapter({apiKey: "synthetic", secret, referrerDomain: "moeazi.example", sandbox: true}, async (url) => {
    urls.push(url);
    if (url.includes("refresh-token")) return {data: {accessToken: secret, expiresAt: Math.floor(Date.now()/1000) + 3600}};
    return {data: []};
  });
  assert.equal(await adapter.getOrder(input.purchaseId, input.purchaseId), null);
  const request = new URL(urls.at(-1)!);
  assert.equal(request.searchParams.get("filter[partnerOrderId]"), input.purchaseId);
  assert.equal(request.searchParams.get("limit"), "1");
  assert.equal(request.searchParams.get("partnerOrderId"), null);
});
test("Transak production v3 uses separate keys and blocks testnet delivery from the old sandbox", () => {
  const env = {MOBILE_PURCHASES_ENABLED: "true", MOBILE_FUNDING_PROVIDERS: "transak@3", MOBILE_TRANSAK_USDC_CONTRACT: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    TRANSAK_API_KEY: "sandbox-key", TRANSAK_API_SECRET: "sandbox-secret", TRANSAK_SANDBOX: "true", TRANSAK_API_KEY_PR: "production-key", TRANSAK_API_SECRET_PR: "production-secret",
    TRANSAK_REFERRER_DOMAIN: "moeazi.example", REDIS_URL: "redis://127.0.0.1:6379", PROVIDER_TOKEN_CACHE_SECRET: "strong-synthetic-cache-secret-32-bytes",
    WORKER_SHARED_SECRET: "synthetic", CONVEX_SITE_URL: "https://synthetic.example", AGENT_SERVICE_URL: "http://127.0.0.1:8100",
    ARBITRUM_RPC_URL: "https://synthetic.example", MOBILE_PUBLIC_RETURN_ORIGIN: "https://moeazi.example"};
  const registries = createRegistries(env, {} as Parameters<typeof createRegistries>[1]);
  const catalog = fundingCatalog(registries, env), selected = catalog.providers.find(provider => provider.id === "transak");
  assert.equal(selected?.version, "3"); assert.equal(selected?.environment, "production"); assert.equal(selected?.available, true);
  assert.match(registries.funding.reason({id: "transak", version: "2"}) ?? "", /sandbox USDC/);
  assert.throws(() => registries.funding.resolve({id: "transak", version: "2"}), /sandbox USDC/);
  assert.equal(registries.funding.resolve({id: "transak", version: "3"}).pin.version, "3");
});
test("provider-specific webhook signatures, forged bodies rejected", async () => {
  const moon = JSON.stringify({data: {id: "external-moonpay", externalTransactionId: input.purchaseId, status: "completed", updatedAt: date}});
  const timestamp = Math.floor(Date.now()/1000), signature = createHmac("sha256", secret).update(`${timestamp}.${moon}`).digest("hex");
  assert.equal((await adapters[0].verifyWebhook(moon, {"moonpay-signature-v2": `t=${timestamp},s=${signature}`}, "/hook")).state, "delivery_pending");
  await assert.rejects(adapters[0].verifyWebhook(moon + " ", {"moonpay-signature-v2": `t=${timestamp},s=${signature}`}, "/hook"));
  const banxa = JSON.stringify({order_id: "external-banxa", external_order_id: input.purchaseId, status: "complete", updated_at: date});
  const nonce = "opaque-not-a-timestamp", signed = createHmac("sha256", secret).update(`POST\n/hook\n${nonce}\n${banxa}`).digest("hex");
  assert.equal((await adapters[1].verifyWebhook(banxa, {authorization: `Bearer key:${signed}:${nonce}`}, "/hook")).purchaseId, input.purchaseId);
  await assert.rejects(adapters[1].verifyWebhook(banxa, {authorization: `Bearer key:${signed}:${nonce}`}, "/other"));
  const header = Buffer.from(JSON.stringify({alg: "HS256"})).toString("base64url");
  const payload = Buffer.from(JSON.stringify({webhookData: {id: "external-transak", partnerOrderId: input.purchaseId, status: "COMPLETED", updatedAt: date}})).toString("base64url");
  const jwtSignature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  assert.equal((await adapters[2].verifyWebhook(JSON.stringify({data: `${header}.${payload}.${jwtSignature}`}), {}, "/hook")).state, "delivery_pending");
});
test("provider replacement and retirement do not change catalog business rules", () => {
  const funding = new AdapterRegistry<OnRampAdapter>();
  for (const id of ["fake-alpha", "fake-beta"]) funding.register({id, version: "1", name: id, validate: () => null, create: () => ({
    pin: {id, version: "1"}, capabilities: () => ({...adapters[0].capabilities(), id, version: "1"}),
    createCheckout: value => adapters[0].createCheckout(value), getOrder: (externalId, purchaseId) => adapters[0].getOrder(externalId, purchaseId),
    verifyWebhook: (raw, headers, path) => adapters[0].verifyWebhook(raw, headers, path),
  })});
  const registries = {funding} as Registries;
  const first = fundingCatalog(registries, {MOBILE_PURCHASES_ENABLED: "true", MOBILE_FUNDING_PROVIDERS: "fake-alpha"});
  const second = fundingCatalog(registries, {MOBILE_PURCHASES_ENABLED: "true", MOBILE_FUNDING_PROVIDERS: "fake-beta"});
  assert.equal(first.providers.filter(p => p.available)[0].id, "fake-alpha");
  assert.equal(second.providers.filter(p => p.available)[0].id, "fake-beta");
  assert.equal(funding.resolve({id: "fake-alpha", version: "1"}).pin.id, "fake-alpha"); // Retained adapter.
});
test("compatible mixed bundler/paymaster IDs pass; incompatible capabilities fail", () => {
  const compatible = {chainId: CHAIN, entryPoint: ENTRY_POINT, accountId: "kernel-033", eip7702: true};
  const registries = {accounts: new AdapterRegistry().register({id: "kernel-033", version: "0.3.3", validate: () => null, create: () => ({pin: {id: "kernel-033"}, entryPoint: ENTRY_POINT})}),
    bundlers: new AdapterRegistry().register({id: "fake-alpha", version: "1", validate: () => null, create: () => ({capabilities: () => compatible})}),
    paymasters: new AdapterRegistry().register({id: "fake-beta", version: "1", validate: () => null, create: () => ({capabilities: () => compatible})})} as Registries;
  const env = {MOBILE_SPONSORSHIP_ENABLED: "true", MOBILE_SPONSORSHIP_CERTIFIED: "true", MOBILE_BUNDLER: "fake-alpha@1", MOBILE_PAYMASTER: "fake-beta@1", MOBILE_GAS_OPERATION_LIMIT_WEI: "1", MOBILE_GAS_ACCOUNT_LIMIT_WEI: "2", MOBILE_GAS_GLOBAL_LIMIT_WEI: "3"};
  assert.ok(infrastructure(registries, env)); compatible.eip7702 = false;
  assert.throws(() => infrastructure(registries, env), /incompatible/);
});
test("exact amounts, unsafe URLs and checksum validation", () => {
  assert.equal(amount("1000000000000000.000001", 6), 1000000000000000000001n);
  for (const value of ["0", "1e3", "01", "1.0000001", "-1"]) assert.throws(() => amount(value, 6));
  assert.equal(address(owner).toLowerCase(), owner);
  assert.throws(() => address("0xaf88d065e77c8CC2239327C5EDb3A432268e5831"));
  for (const url of ["http://checkout.example", "https://user:pass@checkout.example", "https://checkout.example:444"]) assert.throws(() => httpsUrl(url, ["checkout.example"]));
});
