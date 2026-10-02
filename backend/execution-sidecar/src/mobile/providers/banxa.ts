import type { CheckoutInput, OnRampAdapter } from "../contracts.js";
import { ConnectorError } from "../contracts.js";
import { httpsUrl } from "../validation.js";
import { equal, hmac, observation, record, scalar, webhookBody } from "./common.js";
import { requestJson, type JsonRequest } from "./http.js";

export type BanxaConfig = {partner: string; apiKey: string; webhookKey: string; webhookSecret: string; blockchain: string; sandbox: boolean; checkoutHosts: string[]};
export class BanxaAdapter implements OnRampAdapter {
  readonly pin = {id: "banxa", version: "1"};
  constructor(protected config: BanxaConfig, protected request: JsonRequest = requestJson) {}
  capabilities() { return {...this.pin, name: "Banxa", available: true, checkoutHosts: this.config.checkoutHosts}; }
  protected url(path: string) { return `https://${this.config.sandbox ? "api.banxa-sandbox.com" : "api.banxa.com"}/${encodeURIComponent(this.config.partner)}/v2/${path}`; }
  async createCheckout(input: CheckoutInput) {
    const query = new URLSearchParams({fiat: input.fiatCurrency, crypto: "USDC", fiatAmount: input.amount, blockchain: this.config.blockchain});
    const headers = {"x-api-key": this.config.apiKey, "content-type": "application/json"};
    const quotes = await this.request(this.url(`quotes/buy?${query}`), {headers});
    if (!quotes || (Array.isArray(quotes) && !quotes.length)) throw new ConnectorError("UNSUPPORTED", "This purchase is not supported by the provider.");
    const result = record(await this.request(this.url("buy"), {method: "POST", headers, body: JSON.stringify({crypto: "USDC", blockchain: this.config.blockchain,
      fiat: input.fiatCurrency, fiatAmount: input.amount, walletAddress: input.owner, redirectUrl: input.returnUrl,
      externalCustomerId: input.customerId, externalOrderId: input.purchaseId})}));
    return {externalId: scalar(result.id), url: httpsUrl(scalar(result.checkoutUrl), this.config.checkoutHosts), expiresAt: Date.now() + 900_000};
  }
  async getOrder(externalId: string) {
    const result = await this.request(this.url(`orders/${encodeURIComponent(externalId)}`), {headers: {"x-api-key": this.config.apiKey}});
    return this.normalize(record(result));
  }
  private normalize(order: Record<string, unknown>) {
    return observation(order, {id: "id", reference: "externalId", status: "status", date: "updatedAt", hash: "transactionHash"});
  }
  async verifyWebhook(raw: string, headers: Record<string, string>, path: string) {
    const match = /^Bearer ([^:]+):([0-9a-f]+):(.+)$/i.exec(headers.authorization ?? "");
    if (!match || !equal(match[1], this.config.webhookKey) || !equal(match[2], hmac(this.config.webhookSecret, `POST\n${path}\n${match[3]}\n${raw}`))) {
      throw new ConnectorError("INVALID", "Provider event verification failed.", 401);
    }
    // Nonce is opaque. Event deduplication and ordering live in the durable store.
    const event = webhookBody(raw);
    return observation(event, {id: "order_id", reference: "external_order_id", status: "status", date: "updated_at", hash: "transaction_hash"});
  }
}
