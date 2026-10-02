import {BanxaAdapter, type BanxaConfig} from "./banxa.js";
import {QuoteError, type QuoteInput} from "../quoteContracts.js";
import type {CheckoutInput} from "../contracts.js";
import {record, scalar} from "./common.js";
import {httpsUrl} from "../validation.js";
import {requestJson, type JsonRequest} from "./http.js";
import {makeQuote, optionalFee, requestQuoteJson} from "./quoteCommon.js";

export class BanxaQuoteAdapter extends BanxaAdapter {
  readonly pin = {id: "banxa", version: "2"};
  constructor(config: BanxaConfig, request: JsonRequest = requestJson, private quoteRequest: JsonRequest = requestQuoteJson) {super(config, request);}
  quoteCapabilities() {return {paymentMethod: "card" as const, cacheMs: 0};}
  async getQuote(input: QuoteInput) {
    const query = new URLSearchParams({fiat: input.fiatCurrency, crypto: "USDC", fiatAmount: input.amount, blockchain: this.config.blockchain, paymentMethodId: "debit-credit-card"});
    if (input.clientIp) query.set("ipAddress", input.clientIp);
    const result = await this.quoteRequest(this.url(`quotes/buy?${query}`), {headers: {"x-api-key": this.config.apiKey}});
    // No discount code was requested, so multiple/discounted alternatives are ambiguous.
    const data = record(Array.isArray(result) && result.length === 1 ? result[0] : result);
    if (data.paymentMethodId !== "debit-credit-card" || data.crypto && data.crypto !== "USDC" || data.blockchain && data.blockchain !== this.config.blockchain || data.fiat && data.fiat !== input.fiatCurrency) throw new QuoteError("INVALID", "The provider returned a different asset, network, or payment method.");
    return makeQuote(input, data.fiatAmount, data.cryptoAmount, [
      {label: "Provider processing fee", amount: optionalFee(data.processingFee)}, {label: "Delivery network fee", amount: optionalFee(data.networkFee)}, {label: "Moeazi commission", amount: "0"},
    ]);
  }
  async createCheckout(input: CheckoutInput) {
    // Banxa requires a fresh quote per order; never reuse cached display pricing.
    try {await this.getQuote({amount: input.amount, fiatCurrency: input.fiatCurrency, clientIp: input.clientIp});}
    catch (error) {if (!(error instanceof QuoteError) || ["MINIMUM_AMOUNT", "MAXIMUM_AMOUNT", "INVALID"].includes(error.code)) throw error;}
    const result = record(await this.request(this.url("buy"), {method: "POST", headers: {"x-api-key": this.config.apiKey, "content-type": "application/json"}, body: JSON.stringify({
      crypto: "USDC", blockchain: this.config.blockchain, fiat: input.fiatCurrency, fiatAmount: input.amount, paymentMethodId: "debit-credit-card",
      walletAddress: input.owner, redirectUrl: input.returnUrl, externalCustomerId: input.customerId, externalOrderId: input.purchaseId,
    })}));
    return {externalId: scalar(result.id), url: httpsUrl(scalar(result.checkoutUrl), this.config.checkoutHosts), expiresAt: Date.now() + 900_000};
  }
}
