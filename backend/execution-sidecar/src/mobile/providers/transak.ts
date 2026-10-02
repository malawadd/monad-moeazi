import { createHmac } from "node:crypto";
import type { CheckoutInput, OnRampAdapter } from "../contracts.js";
import { ConnectorError } from "../contracts.js";
import { httpsUrl } from "../validation.js";
import { equal, observation, record, scalar, webhookBody } from "./common.js";
import { requestJson, type JsonRequest } from "./http.js";
import type {TokenVault} from "./tokenVault.js";

export type TransakConfig = {apiKey: string; secret: string; referrerDomain: string; sandbox: boolean};
export class TransakAdapter implements OnRampAdapter {
  readonly pin = {id: "transak", version: "1"};
  private token?: {value: string; expiresAt: number};
  private refreshing?: Promise<string>;
  constructor(protected config: TransakConfig, protected request: JsonRequest = requestJson, private vault?: TokenVault) {}
  capabilities() { return {...this.pin, name: "Transak", available: true, checkoutHosts: [this.config.sandbox ? "global-stg.transak.com" : "global.transak.com"]}; }
  private async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    if (!this.refreshing) this.refreshing = (async () => {
      const cached = (await this.vault?.read())?.[0];
      if (cached && cached.expiresAt > Date.now() + 30_000) {this.token = cached; return cached.value;}
      const create = async () => {
      const response = record(await this.request(`https://${this.config.sandbox ? "api-stg.transak.com" : "api.transak.com"}/partners/api/v2/refresh-token`, {
        method: "POST", headers: {"api-secret": this.config.secret, "x-api-key": this.config.apiKey, "content-type": "application/json"},
        body: JSON.stringify({apiKey: this.config.apiKey})}));
      const data = record(response.data), value = data.accessToken, expiresAt = Number(data.expiresAt) * 1000;
      if (typeof value !== "string" || value.length > 8192 || !value.length) throw new ConnectorError("INVALID", "Provider returned an invalid token.");
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new ConnectorError("INVALID", "Provider token has expired.");
      return {value, expiresAt};
      };
      this.token = this.vault ? await this.vault.refresh(create) : await create();
      return this.token.value;
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  async createCheckout(input: CheckoutInput) {
    if (!input.clientIp) throw new ConnectorError("UNAVAILABLE", "A verified connection address is required for checkout.");
    const result = await this.request(`https://${this.config.sandbox ? "api-gateway-stg.transak.com" : "api-gateway.transak.com"}/api/v2/auth/session`, {
      method: "POST", headers: {"access-token": await this.accessToken(), "x-api-key": this.config.apiKey, "x-user-ip": input.clientIp, "content-type": "application/json"},
      body: JSON.stringify({widgetParams: this.widgetParameters(input)})});
    return {externalId: input.purchaseId, url: httpsUrl(scalar(record(record(result).data).widgetUrl), this.capabilities().checkoutHosts), expiresAt: Date.now() + 300_000};
  }
  protected widgetParameters(input: CheckoutInput) {
    return {apiKey: this.config.apiKey, referrerDomain: this.config.referrerDomain,
        fiatAmount: input.amount, fiatCurrency: input.fiatCurrency, cryptoCurrencyCode: "USDC", cryptoCurrencyList: "USDC", network: "arbitrum", networks: "arbitrum",
        walletAddress: input.owner, disableWalletAddressForm: true, productsAvailed: "BUY", partnerOrderId: input.purchaseId, redirectURL: input.returnUrl};
  }
  async getOrder(externalId: string, purchaseId: string) {
    const query = new URLSearchParams({"filter[partnerOrderId]": purchaseId, limit: "1"});
    const path = externalId !== purchaseId ? `order/${encodeURIComponent(externalId)}` : `orders?${query}`;
    const result = await this.request(`https://${this.config.sandbox ? "api-stg.transak.com" : "api.transak.com"}/partners/api/v2/${path}`, {headers: {"access-token": await this.accessToken(), "x-api-key": this.config.apiKey}});
    const orders = record(result).data;
    const candidate = Array.isArray(orders) ? orders.find(o => record(o).partnerOrderId === purchaseId) : orders;
    if (!candidate) return null;
    const order = record(candidate);
    return order?.id || order?._id ? this.normalize({...order, id: order.id ?? order._id}) : null;
  }
  private normalize(order: Record<string, unknown>) { return observation(order, {id: "id", reference: "partnerOrderId", status: "status", date: "updatedAt", hash: "transactionHash"}); }
  async verifyWebhook(raw: string) {
    const token = webhookBody(raw).data;
    if (typeof token !== "string" || token.length > 65536) throw new ConnectorError("INVALID", "Invalid provider event.", 400);
    const parts = token.split(".");
    const tokens = this.vault ? await this.vault.read() : this.token ? [this.token] : [];
    if (parts.length !== 3 || !tokens.length) throw new ConnectorError("INVALID", "Provider event verification failed.", 401);
    const header = webhookBody(Buffer.from(parts[0], "base64url").toString());
    if (header.alg !== "HS256") throw new ConnectorError("INVALID", "Unsupported provider signature.", 401);
    if (!tokens.some(token => equal(parts[2], createHmac("sha256", token.value).update(`${parts[0]}.${parts[1]}`).digest("base64url")))) throw new ConnectorError("INVALID", "Provider event verification failed.", 401);
    const data = webhookBody(Buffer.from(parts[1], "base64url").toString());
    if ((typeof data.exp === "number" && data.exp * 1000 < Date.now()) || !data.webhookData) throw new ConnectorError("EXPIRED", "Provider event has expired.", 401);
    return this.normalize(record(data.webhookData));
  }
}
