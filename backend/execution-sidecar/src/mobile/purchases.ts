import {createHmac, randomUUID} from "node:crypto";
import {decodeEventLog, type PublicClient} from "viem";
import {CHAIN, ConnectorError, USDC, VERSION, type Environment, type OperationRecord, type OperationStore, type ProviderPin, type PurchaseObservation} from "./contracts.js";
import {fundingCatalog, returnUrl, type Registries} from "./configuration.js";
import {address, amount, digest, httpsUrl, requestId} from "./validation.js";
import {transferEvent} from "./kernel.js";
import type {QuoteService} from "./quotes.js";
import {QuoteError} from "./quoteContracts.js";

export function publicPurchase(row: OperationRecord) {
  const payload = JSON.parse(row.payloadJson);
  const expiresAt = Math.min(row.expiresAt, payload.checkout?.expiresAt ?? row.expiresAt);
  return {schemaVersion: VERSION, purchaseId: row.operationId, status: row.status, provider: JSON.parse(row.providerPinsJson)[0],
    fiatCurrency: payload.fiatCurrency, amount: payload.amount, expiresAt,
    checkoutUrl: row.status === "checkout_ready" && expiresAt > Date.now() ? payload.checkout?.url : undefined,
    checkoutHosts: payload.checkoutHosts ?? [], transactionHash: row.transactionHash, updatedAt: row.updatedAt};
}
export class PurchaseService {
  constructor(private store: OperationStore, private registries: Registries, private env: Environment, private client: PublicClient, private quotes?: QuoteService) {}
  async create(subject: string, sessionOwner: string, input: Record<string, unknown>, ip?: string) {
    const key = requestId(input.idempotencyKey), fiatCurrency = String(input.fiatCurrency);
    amount(input.amount, 2);
    const existing = await this.store.byIdempotency(subject, key);
    if (existing) {
      const payload = JSON.parse(existing.payloadJson), pin = JSON.parse(existing.providerPinsJson)[0];
      if (existing.kind !== "purchase" || pin.id !== input.provider || payload.amount !== input.amount || payload.fiatCurrency !== fiatCurrency || payload.owner.toLowerCase() !== sessionOwner.toLowerCase()) throw new ConnectorError("CONFLICT", "The request ID belongs to another purchase. Check that purchase first.", 409);
      return publicPurchase(existing);
    }
    const catalog = fundingCatalog(this.registries, this.env);
    const selected = catalog.providers.find(provider => provider.id === input.provider);
    if (!selected?.available || !catalog.currencyCodes.includes(fiatCurrency)) throw new ConnectorError("UNAVAILABLE", selected?.reason ?? "This purchase option is unavailable.");
    const context = await this.store.context(subject), owner = address(context.ownerAddress);
    if (owner.toLowerCase() !== sessionOwner.toLowerCase() || subject !== `magic:${owner.toLowerCase()}`) throw new ConnectorError("INVALID", "Wallet identity changed. Sign in again.", 403);
    if (input.quoteReference !== undefined && !this.quotes) throw new QuoteError("UNAVAILABLE", "Estimates are unavailable. Review checkout pricing again.");
    const quote = await this.quotes?.resolve(subject, input, ip);
    const operationId = randomUUID();
    const payload = {owner, fiatCurrency, amount: input.amount, checkoutHosts: this.registries.funding.resolve(selected).capabilities().checkoutHosts};
    const reservation = await this.store.reserve(subject, {operationId, kind: "purchase", status: "creating", idempotencyKey: key,
      providerPinsJson: JSON.stringify([{id: selected.id, version: selected.version}]), payloadJson: JSON.stringify(payload),
      expiresAt: Date.now() + 900_000, bindingHash: digest({provider: selected.id, owner, fiatCurrency, amount: input.amount})});
    if (!reservation.created) return publicPurchase(reservation.row);
    try {
      const checkout = await this.registries.funding.resolve(selected).createCheckout({purchaseId: operationId,
        customerId: createHmac("sha256", this.env.WORKER_SHARED_SECRET!).update(subject).digest("hex"), owner,
        fiatCurrency, amount: String(input.amount), returnUrl: returnUrl(this.env, operationId), clientIp: ip, quote});
      httpsUrl(checkout.url, payload.checkoutHosts);
      if (checkout.expiresAt <= Date.now()) throw new ConnectorError("EXPIRED", "Checkout has expired.");
      const row = await this.store.transition(subject, operationId, ["creating"], {status: "checkout_ready", externalId: checkout.externalId, payloadJson: JSON.stringify({...payload, checkout})});
      return {...publicPurchase(row), expiresAt: checkout.expiresAt};
    } catch {
      // A timeout may have created a chargeable provider order. Never repeat checkout creation.
      await this.store.transition(subject, operationId, ["creating"], {status: "needs_attention"});
      throw new ConnectorError("UNCERTAIN", "Checkout could not be confirmed. Check the purchase before trying again.", 409);
    }
  }
  async get(subject: string, id: string) {
    const row = await this.store.find(subject, id);
    if (!row || row.kind !== "purchase") throw new ConnectorError("INVALID", "Purchase not found.", 404);
    return publicPurchase(row);
  }
  async webhook(providerId: string, raw: string, headers: Record<string, string>, path: string) {
    // Authenticate against retained versions, then bind to the operation's original pin.
    // This is webhook verification, never automatic checkout-provider failover.
    for (const pin of this.registries.funding.list().filter(value => value.id === providerId)) {
      let event: PurchaseObservation;
      try {event = await this.registries.funding.resolve(pin).verifyWebhook(raw, headers, path);} catch {continue;}
      const row = await this.store.byExternal(pin, event.externalId, event.purchaseId);
      if (!row || row.kind !== "purchase") continue;
      // A verified webhook is a prompt to reconcile, never proof that funds arrived.
      await this.store.transition(row.subject, row.operationId, ["checkout_ready", "processing", "needs_attention"], {
        status: "processing", externalId: event.externalId, eventId: event.eventId, observedAt: event.occurredAt});
      return row.operationId;
    }
    throw new ConnectorError("INVALID", "Purchase event was not recognized.", 400);
  }
  async reconcile(row: OperationRecord) {
    if (["received", "cancelled", "failed"].includes(row.status)) return row.status;
    const pin: ProviderPin = JSON.parse(row.providerPinsJson)[0];
    const event = await this.registries.funding.resolve(pin).getOrder(row.externalId ?? row.operationId, row.operationId);
    if (!event) return row.status;
    const payload = JSON.parse(row.payloadJson);
    if (event.purchaseId && event.purchaseId !== row.operationId) throw new ConnectorError("INVALID", "Purchase reference did not match.");
    let status: string = event.state;
    if (event.transactionHash && event.state === "delivery_pending") {
      if (await this.client.getChainId() !== CHAIN) throw new ConnectorError("INVALID", "Purchase settlement must be verified on Arbitrum.");
      const receipt = await this.client.getTransactionReceipt({hash: event.transactionHash}).catch(() => null);
      if (receipt?.status === "success") {
        const block = await this.client.getBlockNumber();
        const matching = receipt.logs.some(log => {
          if (log.address.toLowerCase() !== USDC) return false;
          try { const {args} = decodeEventLog({abi: transferEvent, data: log.data, topics: log.topics}); return args.to.toLowerCase() === payload.owner.toLowerCase() && args.value > 0n; } catch { return false; }
        });
        if (matching && block >= receipt.blockNumber + 1n) status = "received";
      }
    }
    await this.store.transition(row.subject, row.operationId, ["checkout_ready", "processing", "delivery_pending", "needs_attention"], {status, transactionHash: event.transactionHash});
    return status;
  }
}
