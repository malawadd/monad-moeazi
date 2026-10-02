import type {PublicClient} from "viem";
import {CHAIN, ConnectorError, USDC, type AccountExecutionAdapter, type BundlerAdapter, type Environment, type OnRampAdapter, type PaymasterAdapter, type ProviderPin} from "./contracts.js";
import {AdapterRegistry} from "./registry.js";
import {BanxaAdapter} from "./providers/banxa.js";
import {MoonPayAdapter} from "./providers/moonpay.js";
import {MoonPayQuoteAdapter} from "./providers/moonpayQuotes.js";
import {TransakQuoteAdapter} from "./providers/transakQuotes.js";
import {BanxaQuoteAdapter} from "./providers/banxaQuotes.js";
import {TransakAdapter} from "./providers/transak.js";
import {PimlicoBundler, PimlicoPaymaster, PimlicoTransport} from "./providers/pimlico.js";
import {Kernel033Adapter} from "./kernel.js";
import {httpsUrl} from "./validation.js";
import {RedisTokenVault} from "./providers/tokenVault.js";

export type Registries = {funding: AdapterRegistry<OnRampAdapter>; bundlers: AdapterRegistry<BundlerAdapter>; paymasters: AdapterRegistry<PaymasterAdapter>; accounts: AdapterRegistry<AccountExecutionAdapter>};
export function configuredPin(value?: string): ProviderPin {
  const parts = value?.split("@");
  if (!parts || parts.length !== 2) throw new ConnectorError("UNAVAILABLE", "Covered network fees are not configured.");
  return {id: parts[0], version: parts[1]};
}
function required(env: Environment, names: string[]) { return names.every(name => Boolean(env[name])) ? null : "Provider configuration is incomplete."; }
export function createRegistries(env: Environment, client: PublicClient): Registries {
  const funding = new AdapterRegistry<OnRampAdapter>();
  const runtimeNames = ["WORKER_SHARED_SECRET", "CONVEX_SITE_URL", "AGENT_SERVICE_URL", "ARBITRUM_RPC_URL"];
  const cache = new Map<string, OnRampAdapter>();
  const add = (id: string, name: string, names: string[], factory: () => OnRampAdapter, version = "1") => funding.register({id, name, version, validate: () => {
    if (id === "transak" && version !== "3" && env.TRANSAK_SANDBOX !== "false") return "Transak sandbox USDC cannot fund this Arbitrum One wallet.";
    if (env[`MOBILE_${id.toUpperCase()}_USDC_CONTRACT`]?.toLowerCase() !== USDC) return "Canonical Arbitrum USDC delivery is not verified.";
    if (id === "transak" && (env.PROVIDER_TOKEN_CACHE_SECRET?.length ?? 0) < 32) return "Encrypted provider-token cache needs a strong server secret.";
    return required(env, [...names, ...runtimeNames, "MOBILE_PUBLIC_RETURN_ORIGIN"]);
  }, create: () => { const key = `${id}@${version}`; if (!cache.has(key)) cache.set(key, factory()); return cache.get(key)!; }});
  add("transak", "Transak", ["TRANSAK_API_KEY", "TRANSAK_API_SECRET", "TRANSAK_REFERRER_DOMAIN", "REDIS_URL", "PROVIDER_TOKEN_CACHE_SECRET"], () => new TransakAdapter({apiKey: env.TRANSAK_API_KEY!, secret: env.TRANSAK_API_SECRET!, referrerDomain: env.TRANSAK_REFERRER_DOMAIN!, sandbox: env.TRANSAK_SANDBOX !== "false"}, undefined, new RedisTokenVault(env.REDIS_URL!, env.PROVIDER_TOKEN_CACHE_SECRET!, `moeazi:transak:v1:${env.TRANSAK_SANDBOX !== "false" ? "sandbox" : "production"}`)));
  add("moonpay", "MoonPay", ["MOONPAY_API_KEY", "MOONPAY_API_SECRET", "MOONPAY_WEBHOOK_SECRET", "MOONPAY_ARBITRUM_USDC_CODE"], () => new MoonPayAdapter({apiKey: env.MOONPAY_API_KEY!, secret: env.MOONPAY_API_SECRET!, webhookSecret: env.MOONPAY_WEBHOOK_SECRET!, currencyCode: env.MOONPAY_ARBITRUM_USDC_CODE!, sandbox: env.MOONPAY_SANDBOX !== "false"}));
  add("banxa", "Banxa", ["BANXA_PARTNER_REF", "BANXA_API_KEY", "BANXA_WEBHOOK_KEY", "BANXA_WEBHOOK_SECRET", "BANXA_ARBITRUM_CODE", "BANXA_CHECKOUT_HOSTS"], () => new BanxaAdapter({partner: env.BANXA_PARTNER_REF!, apiKey: env.BANXA_API_KEY!, webhookKey: env.BANXA_WEBHOOK_KEY!, webhookSecret: env.BANXA_WEBHOOK_SECRET!, blockchain: env.BANXA_ARBITRUM_CODE!, sandbox: env.BANXA_SANDBOX !== "false", checkoutHosts: env.BANXA_CHECKOUT_HOSTS!.split(",")}));
  add("transak", "Transak", ["TRANSAK_API_KEY", "TRANSAK_API_SECRET", "TRANSAK_REFERRER_DOMAIN", "REDIS_URL", "PROVIDER_TOKEN_CACHE_SECRET"], () => new TransakQuoteAdapter({apiKey: env.TRANSAK_API_KEY!, secret: env.TRANSAK_API_SECRET!, referrerDomain: env.TRANSAK_REFERRER_DOMAIN!, sandbox: env.TRANSAK_SANDBOX !== "false"}, undefined, new RedisTokenVault(env.REDIS_URL!, env.PROVIDER_TOKEN_CACHE_SECRET!, `moeazi:transak:v1:${env.TRANSAK_SANDBOX !== "false" ? "sandbox" : "production"}`)), "2");
  // Production credentials and token cache are pinned to v3; old versions cannot route sandbox USDC into Arbitrum One.
  add("transak", "Transak", ["TRANSAK_API_KEY_PR", "TRANSAK_API_SECRET_PR", "TRANSAK_REFERRER_DOMAIN", "REDIS_URL", "PROVIDER_TOKEN_CACHE_SECRET"], () => new TransakQuoteAdapter({apiKey: env.TRANSAK_API_KEY_PR!, secret: env.TRANSAK_API_SECRET_PR!, referrerDomain: env.TRANSAK_REFERRER_DOMAIN!, sandbox: false}, undefined, new RedisTokenVault(env.REDIS_URL!, env.PROVIDER_TOKEN_CACHE_SECRET!, "moeazi:transak:v3:production"), undefined, "3"), "3");
  add("moonpay", "MoonPay", ["MOONPAY_API_KEY", "MOONPAY_API_SECRET", "MOONPAY_WEBHOOK_SECRET", "MOONPAY_ARBITRUM_USDC_CODE"], () => new MoonPayQuoteAdapter({apiKey: env.MOONPAY_API_KEY!, secret: env.MOONPAY_API_SECRET!, webhookSecret: env.MOONPAY_WEBHOOK_SECRET!, currencyCode: env.MOONPAY_ARBITRUM_USDC_CODE!, sandbox: env.MOONPAY_SANDBOX !== "false"}), "2");
  add("banxa", "Banxa", ["BANXA_PARTNER_REF", "BANXA_API_KEY", "BANXA_WEBHOOK_KEY", "BANXA_WEBHOOK_SECRET", "BANXA_ARBITRUM_CODE", "BANXA_CHECKOUT_HOSTS"], () => new BanxaQuoteAdapter({partner: env.BANXA_PARTNER_REF!, apiKey: env.BANXA_API_KEY!, webhookKey: env.BANXA_WEBHOOK_KEY!, webhookSecret: env.BANXA_WEBHOOK_SECRET!, blockchain: env.BANXA_ARBITRUM_CODE!, sandbox: env.BANXA_SANDBOX !== "false", checkoutHosts: env.BANXA_CHECKOUT_HOSTS!.split(",")}), "2");
  const transport = () => new PimlicoTransport(env.PIMLICO_API_KEY!, undefined, env.PIMLICO_SPONSORSHIP_POLICY_ID);
  const bundlers = new AdapterRegistry<BundlerAdapter>().register({id: "pimlico", version: "1", validate: () => required(env, ["PIMLICO_API_KEY", ...runtimeNames]), create: () => new PimlicoBundler(transport())});
  const paymasters = new AdapterRegistry<PaymasterAdapter>().register({id: "pimlico", version: "1", validate: () => required(env, ["PIMLICO_API_KEY", "PIMLICO_SPONSORSHIP_POLICY_ID", ...runtimeNames]), create: () => new PimlicoPaymaster(transport())});
  const accounts = new AdapterRegistry<AccountExecutionAdapter>().register({id: "kernel-033", version: "0.3.3", validate: () => required(env, ["MOBILE_KERNEL_CODE_HASH", "MOBILE_ENTRY_POINT_CODE_HASH"]), create: () => new Kernel033Adapter(client)});
  return {funding, bundlers, paymasters, accounts};
}
export function fundingCatalog(registries: Registries, env: Environment) {
  const selected = (env.MOBILE_FUNDING_PROVIDERS ?? "").split(",").map(value => value.trim());
  const registered = registries.funding.list();
  return {schemaVersion: "2026-09-29", commissionBps: 0, currencyCodes: (env.MOBILE_FIAT_CURRENCIES ?? "USD,EUR,GBP").split(","), providers: [...new Set(registered.map(pin => pin.id))].map(id => {
    const versions = registered.filter(pin => pin.id === id), choices = selected.filter(value => value === id || value.startsWith(`${id}@`));
    const version = choices[0]?.includes("@") ? choices[0].split("@")[1] : versions[0].version;
    const pin = versions.find(value => value.version === version) ?? {...versions[0], version};
    let reason: string | null = "Purchases are not enabled yet.";
    if (env.MOBILE_PURCHASES_ENABLED === "true" && choices.length) {
      if (choices.length > 1 || choices[0] === id && versions.length > 1) reason = "Select exactly one explicit integration version.";
      else if (!versions.some(value => value.version === version)) reason = "This integration version is not installed.";
      else reason = registries.funding.reason(pin);
    }
    return {...pin, environment: id === "transak" && version === "3" || env[`${id.toUpperCase()}_SANDBOX`] === "false" ? "production" : "sandbox", available: !reason, reason: reason ?? undefined,
      quoteSupported: !reason && Boolean(registries.funding.resolve(pin).getQuote)};
  })};
}
export function infrastructure(registries: Registries, env: Environment) {
  if (env.MOBILE_SPONSORSHIP_ENABLED !== "true" || env.MOBILE_SPONSORSHIP_CERTIFIED !== "true") throw new ConnectorError("UNAVAILABLE", "Covered network fees are not available yet.");
  for (const key of ["MOBILE_GAS_OPERATION_LIMIT_WEI", "MOBILE_GAS_ACCOUNT_LIMIT_WEI", "MOBILE_GAS_GLOBAL_LIMIT_WEI"]) if (!/^[1-9][0-9]*$/.test(env[key] ?? "")) throw new ConnectorError("UNAVAILABLE", "Network-fee spending limits are not configured.");
  const account = registries.accounts.resolve(configuredPin(env.MOBILE_ACCOUNT_ADAPTER ?? "kernel-033@0.3.3"));
  const bundler = registries.bundlers.resolve(configuredPin(env.MOBILE_BUNDLER));
  const paymaster = registries.paymasters.resolve(configuredPin(env.MOBILE_PAYMASTER));
  for (const adapter of [bundler, paymaster]) {
    const capabilities = adapter.capabilities();
    if (capabilities.chainId !== CHAIN || capabilities.entryPoint.toLowerCase() !== account.entryPoint.toLowerCase() || capabilities.accountId !== account.pin.id || !capabilities.eip7702) throw new ConnectorError("UNSUPPORTED", "Network-fee providers are incompatible with this wallet.");
  }
  return {account, bundler, paymaster};
}
export function returnUrl(env: Environment, id: string) {
  const origin = httpsUrl(env.MOBILE_PUBLIC_RETURN_ORIGIN ?? "");
  if (new URL(origin).pathname !== "/") throw new ConnectorError("INVALID", "Configure a first-party return origin.");
  return `${origin.replace(/\/$/, "")}/mobile/funding/return/${encodeURIComponent(id)}`;
}
