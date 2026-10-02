import {parseUnits} from "viem";
import {MoonPayAdapter, type MoonPayConfig} from "./moonpay.js";
import type {CheckoutInput} from "../contracts.js";
import {QuoteError, type QuoteInput} from "../quoteContracts.js";
import {record} from "./common.js";
import {requestJson, type JsonRequest} from "./http.js";
import {decimal, makeQuote, optionalFee, quoteRequestWithErrors, verifyFiat} from "./quoteCommon.js";

const requestMoonPayQuote = quoteRequestWithErrors(body => {
  // Translate stable machine codes only; never expose provider messages/payloads.
  const code = String(body.moonPayErrorCode ?? "");
  if (code === "1_SYS_UNKNOWN" && body.message === "Currency not supported in test mode") return new QuoteError("UNSUPPORTED", "MoonPay cannot estimate Arbitrum USDC in sandbox mode. This asset needs a supported production configuration.");
  if (/MIN.*AMOUNT/i.test(code)) return new QuoteError("MINIMUM_AMOUNT", "This amount is below the provider's minimum.");
  if (/MAX.*AMOUNT/i.test(code)) return new QuoteError("MAXIMUM_AMOUNT", "This amount exceeds the provider's maximum.");
});

export class MoonPayQuoteAdapter extends MoonPayAdapter {
  readonly pin = {id: "moonpay", version: "2"};
  constructor(config: MoonPayConfig, request: JsonRequest = requestJson, private quoteRequest: JsonRequest = requestMoonPayQuote) {super(config, request);}
  quoteCapabilities() {return {paymentMethod: "card" as const, cacheMs: 30_000};}
  async getQuote(input: QuoteInput) {
    const query = new URLSearchParams({apiKey: this.config.apiKey, baseCurrencyCode: input.fiatCurrency.toLowerCase(),
      baseCurrencyAmount: input.amount, areFeesIncluded: "true", paymentMethod: "credit_debit_card", extraFeePercentage: "0"});
    const data = record(await this.quoteRequest(`https://api.moonpay.com/v3/currencies/${encodeURIComponent(this.config.currencyCode)}/buy_quote?${query}`));
    verifyFiat(data.baseCurrencyCode ?? record(data.baseCurrency ?? {}).code, input.fiatCurrency);
    if ((data.quoteCurrencyCode ?? record(data.quoteCurrency ?? {}).code) !== this.config.currencyCode || data.paymentMethod !== "credit_debit_card") throw new QuoteError("INVALID", "The provider returned a different asset or payment method.");
    const total = decimal(data.totalAmount, 2), base = decimal(data.baseCurrencyAmount, 2);
    if (parseUnits(total, 2) > parseUnits(input.amount, 2)) throw new QuoteError("MINIMUM_AMOUNT", `This provider requires at least ${total} ${input.fiatCurrency}.`, {minimumAmount: total});
    const extra = optionalFee(data.extraFeeAmount);
    if (extra !== null && parseUnits(extra, 18) !== 0n) throw new QuoteError("INVALID", "The provider returned an unexpected added commission.");
    const expiry = data.expiresAt ? Date.parse(String(data.expiresAt)) : undefined;
    if (expiry !== undefined && (!Number.isFinite(expiry) || expiry <= Date.now())) throw new QuoteError("EXPIRED", "This estimate has expired. Check again.");
    return makeQuote(input, total, data.quoteCurrencyAmount, [
      {label: "Provider fee", amount: optionalFee(data.feeAmount)}, {label: "Delivery network fee", amount: optionalFee(data.networkFeeAmount)},
      {label: "Moeazi commission", amount: "0"},
    ], base, expiry);
  }
  protected checkoutParameters(input: CheckoutInput) {
    const query = super.checkoutParameters({...input, amount: input.quote?.checkoutAmount ?? input.amount});
    query.set("paymentMethod", "credit_debit_card"); query.set("extraFeePercentage", "0");
    return query;
  }
}
