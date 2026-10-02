import {TransakAdapter, type TransakConfig} from "./transak.js";
import {QuoteError, type QuoteInput} from "../quoteContracts.js";
import type {CheckoutInput} from "../contracts.js";
import {record} from "./common.js";
import {requestJson, type JsonRequest} from "./http.js";
import {makeQuote, optionalFee, requestQuoteJson, verifyFiat} from "./quoteCommon.js";
import type {TokenVault} from "./tokenVault.js";

export class TransakQuoteAdapter extends TransakAdapter {
  readonly pin: {id: string; version: string};
  constructor(config: TransakConfig, request: JsonRequest = requestJson, vault?: TokenVault, private quoteRequest: JsonRequest = requestQuoteJson, version = "2") {
    super(config, request, vault);
    this.pin = {id: "transak", version};
  }
  quoteCapabilities() {return {paymentMethod: "card" as const, cacheMs: 30_000};}
  async getQuote(input: QuoteInput) {
    if (!input.clientIp) throw new QuoteError("UNAVAILABLE", "A verified connection address is required for an estimate.");
    const query = new URLSearchParams({apiKey: this.config.apiKey, fiatAmount: input.amount, fiatCurrency: input.fiatCurrency,
      cryptoCurrency: "USDC", network: "arbitrum", isBuyOrSell: "BUY", paymentMethod: "credit_debit_card"});
    const data = record(record(await this.quoteRequest(`https://${this.config.sandbox ? "api-gateway-stg.transak.com" : "api-gateway.transak.com"}/api/v2/lookup/quotes?${query}`,
      {headers: {"x-api-key": this.config.apiKey, "x-user-ip": input.clientIp}})).data);
    verifyFiat(data.fiatCurrency, input.fiatCurrency);
    if (data.cryptoCurrency !== "USDC" || data.network !== "arbitrum" || data.paymentMethod !== "credit_debit_card" || data.isBuyOrSell !== "BUY") throw new QuoteError("INVALID", "The provider returned a different asset, network, or payment method.");
    const breakdown = Array.isArray(data.feeBreakdown) ? data.feeBreakdown.map(value => record(value)) : [];
    const fees = breakdown.length ? breakdown.map(fee => ({label: fee.id === "network_fee" ? "Delivery network fee" : "Provider fee", amount: optionalFee(fee.value)})) : [{label: "Provider fees", amount: optionalFee(data.totalFee)}];
    return makeQuote(input, data.fiatAmount, data.cryptoAmount, [...fees, {label: "Moeazi commission", amount: "0"}]);
  }
  protected widgetParameters(input: CheckoutInput) {return {...super.widgetParameters(input), paymentMethod: "credit_debit_card"};}
}
