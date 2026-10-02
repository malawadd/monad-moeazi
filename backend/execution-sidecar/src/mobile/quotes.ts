import {randomUUID} from "node:crypto";
import {CHAIN, USDC, type Environment, type OnRampAdapter} from "./contracts.js";
import {fundingCatalog, type Registries} from "./configuration.js";
import {amount, digest} from "./validation.js";
import {decimal} from "./providers/quoteCommon.js";
import {parseUnits} from "viem";
import {QUOTE_VERSION, QuoteError, type AdapterQuote, type QuoteResult} from "./quoteContracts.js";
import type {QuoteStore} from "./quoteStore.js";

export class QuoteService {
  private inFlight = new Map<string, Promise<QuoteResult>>();
  constructor(private registries: Registries, private env: Environment, private store: QuoteStore) {}
  private selection(input: Record<string, unknown>) {
    if (Object.keys(input).some(key => !["provider", "amount", "fiatCurrency"].includes(key))) throw new QuoteError("INVALID", "Unsupported estimate fields.");
    try {amount(input.amount, 2);} catch {throw new QuoteError("INVALID", "Enter a positive amount with at most two decimals.");}
    const fiatCurrency = String(input.fiatCurrency), budget = decimal(input.amount, 2);
    const catalog = fundingCatalog(this.registries, this.env), provider = catalog.providers.find(pin => pin.id === input.provider);
    if (!provider?.available || !catalog.currencyCodes.includes(fiatCurrency)) throw new QuoteError("UNAVAILABLE", provider?.reason ?? "This payment option is unavailable.");
    const adapter = this.registries.funding.resolve(provider);
    return {provider, adapter, fiatCurrency, budget};
  }
  private binding(subject: string, input: Record<string, unknown>, clientIp?: string) {
    const selected = this.selection(input);
    return {...selected, hash: digest({subject: digest(subject), provider: selected.provider.id, version: selected.provider.version,
      environment: selected.provider.environment, budget: selected.budget, currency: selected.fiatCurrency, method: "card", chain: CHAIN, token: USDC, ip: digest(clientIp ?? "")})};
  }
  async estimate(subject: string, input: Record<string, unknown>, clientIp?: string): Promise<QuoteResult> {
    const fallback = {schemaVersion: QUOTE_VERSION, provider: {id: typeof input.provider === "string" ? input.provider : "", version: ""}, environment: "sandbox" as const};
    let base: Pick<QuoteResult, "schemaVersion" | "provider" | "environment"> = fallback;
    try {
      if (!/^magic:0x[0-9a-f]{40}$/.test(subject)) throw new QuoteError("INVALID", "Authenticated Magic identity is required.");
      const selected = this.binding(subject, input, clientIp), {provider, adapter, hash} = selected;
      base = {schemaVersion: QUOTE_VERSION, provider: {id: provider.id, version: provider.version}, environment: provider.environment as "sandbox" | "production"};
      if (this.env.MOBILE_FUNDING_QUOTES_ENABLED !== "true") throw new QuoteError("UNAVAILABLE", "Estimates are not enabled yet. Check the final amount in checkout.");
      const capability = adapter.quoteCapabilities?.();
      if (!capability || !adapter.getQuote) throw new QuoteError("UNSUPPORTED", "This connector does not provide estimates. Check pricing in checkout.");
      const pending = this.inFlight.get(hash); if (pending) return await pending;
      const work = this.load(subject, selected, base, adapter, clientIp);
      this.inFlight.set(hash, work);
      try {return await work;} finally {this.inFlight.delete(hash);}
    } catch (error) {
      const failure = error instanceof QuoteError ? error : new QuoteError("UNAVAILABLE", "The estimate is unavailable. Retry or check pricing in checkout.");
      return {...base, status: "unavailable", code: failure.code, message: failure.message, ...failure.bounds};
    }
  }
  private async load(subject: string, selected: ReturnType<QuoteService["binding"]>, base: Pick<QuoteResult, "schemaVersion" | "provider" | "environment">, adapter: OnRampAdapter, clientIp?: string): Promise<QuoteResult> {
    const cacheMs = Math.min(30_000, Math.max(0, adapter.quoteCapabilities!().cacheMs));
    const cached = cacheMs > 0 ? await this.store.cached(selected.hash) : null;
    if (cached && cached.quote.estimate.expiresAt > Date.now()) return cached.result;
    const lease = await this.store.claim(selected.hash, digest({subject, provider: selected.provider.id}));
    if (!lease) throw new QuoteError("RATE_LIMITED", "An estimate is in progress or the request limit was reached. Try again shortly.");
    try {
      const quote = await adapter.getQuote!({amount: selected.budget, fiatCurrency: selected.fiatCurrency, clientIp});
      this.validate(quote, selected.budget, selected.fiatCurrency);
      const quoteReference = randomUUID(), result: QuoteResult = {...base, status: "ready", quoteReference, ...quote.estimate};
      await this.store.put(quoteReference, {binding: selected.hash, subjectHash: digest(subject), provider: base.provider, environment: base.environment, quote, result}, cacheMs);
      return result;
    } finally {await this.store.release(selected.hash, lease);}
  }
  private validate(quote: AdapterQuote, budget: string, currency: string) {
    const e = quote.estimate;
    if (e.requestedBudget !== budget || e.fiatCurrency !== currency || decimal(e.estimatedTotal, 2) !== budget || e.paymentMethod !== "card" ||
      e.expiresAt <= Date.now() || e.expiresAt > e.observedAt + 30_000 || e.observedAt > Date.now() + 1000 || !Number.isFinite(e.observedAt) || !Number.isFinite(e.expiresAt) ||
      parseUnits(decimal(quote.checkoutAmount, 2), 2) > parseUnits(budget, 2)) throw new QuoteError("INVALID", "The provider returned inconsistent pricing.");
    amount(e.estimatedUsdc, 6); amount(quote.checkoutAmount, 2);
    for (const fee of e.fees) if (fee.amount !== null) decimal(fee.amount);
  }
  async resolve(subject: string, input: Record<string, unknown>, clientIp?: string): Promise<AdapterQuote | undefined> {
    if (input.quoteReference === undefined) return undefined;
    if (this.env.MOBILE_FUNDING_QUOTES_ENABLED !== "true") throw new QuoteError("EXPIRED", "Estimates are disabled. Review checkout pricing again.");
    if (typeof input.quoteReference !== "string" || !/^[a-f0-9-]{36}$/.test(input.quoteReference)) throw new QuoteError("INVALID", "The estimate reference is invalid.");
    const selected = this.binding(subject, {provider: input.provider, amount: input.amount, fiatCurrency: input.fiatCurrency}, clientIp);
    const saved = await this.store.reference(input.quoteReference);
    if (!saved || saved.binding !== selected.hash || saved.subjectHash !== digest(subject) || saved.quote.estimate.expiresAt <= Date.now()) throw new QuoteError("EXPIRED", "This estimate changed or expired. Review a fresh estimate before continuing.");
    this.validate(saved.quote, selected.budget, selected.fiatCurrency);
    return saved.quote;
  }
}
