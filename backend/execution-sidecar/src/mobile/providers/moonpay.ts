import type { CheckoutInput, OnRampAdapter } from "../contracts.js";
import { ConnectorError } from "../contracts.js";
import { equal, hmac, observation, record, webhookBody } from "./common.js";
import { requestJson, type JsonRequest } from "./http.js";

export type MoonPayConfig = {apiKey: string; secret: string; webhookSecret: string; currencyCode: string; sandbox: boolean};
export class MoonPayAdapter implements OnRampAdapter {
  readonly pin = {id: "moonpay", version: "1"};
  constructor(protected config: MoonPayConfig, protected request: JsonRequest = requestJson) {}
  capabilities() { return {...this.pin, name: "MoonPay", available: true, checkoutHosts: [this.config.sandbox ? "buy-sandbox.moonpay.com" : "buy.moonpay.com"]}; }
  async createCheckout(input: CheckoutInput) {
    if (!input.clientIp) throw new ConnectorError("UNAVAILABLE", "A verified connection address is required for checkout.");
    const query = this.checkoutParameters(input);
    const signature = hmac(this.config.secret, `?${query}`, "base64");
    query.set("signature", signature);
    return {externalId: input.purchaseId, url: `https://${this.capabilities().checkoutHosts[0]}/?${query}`, expiresAt: Date.now() + 300_000};
  }
  protected checkoutParameters(input: CheckoutInput) {
    return new URLSearchParams({apiKey: this.config.apiKey, currencyCode: this.config.currencyCode, showOnlyCurrencies: this.config.currencyCode,
      walletAddress: input.owner, baseCurrencyCode: input.fiatCurrency.toLowerCase(), baseCurrencyAmount: input.amount,
      lockAmount: "true",
      externalTransactionId: input.purchaseId, externalCustomerId: input.customerId, redirectURL: input.returnUrl,
      allowedIpAddress: hmac(this.config.secret, input.clientIp!, "base64")});
  }
  async getOrder(_externalId: string, purchaseId: string) {
    const base = this.config.sandbox ? "https://api.moonpay.com" : "https://api.moonpay.com";
    const orders = await this.request(`${base}/v1/transactions/ext/${encodeURIComponent(purchaseId)}?apiKey=${encodeURIComponent(this.config.apiKey)}`);
    const candidate = Array.isArray(orders) ? orders.find(value => record(value).externalTransactionId === purchaseId) : orders;
    if (!candidate) return null;
    const order = record(candidate);
    if (!order || !order.id) return null;
    return this.normalize(order);
  }
  private normalize(order: Record<string, unknown>) {
    return observation(order, {id: "id", reference: "externalTransactionId", status: "status", date: "updatedAt", hash: "cryptoTransactionId"});
  }
  async verifyWebhook(raw: string, headers: Record<string, string>) {
    const header = headers["moonpay-signature-v2"] ?? "";
    const timestamp = /(?:^|,)\s*t=(\d+)/.exec(header)?.[1];
    const signature = /(?:^|,)\s*s=([0-9a-f]+)/i.exec(header)?.[1];
    if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !equal(hmac(this.config.webhookSecret, `${timestamp}.${raw}`), signature)) {
      throw new ConnectorError("INVALID", "Provider event verification failed.", 401);
    }
    const body = webhookBody(raw);
    return this.normalize(record(body.data));
  }
}
