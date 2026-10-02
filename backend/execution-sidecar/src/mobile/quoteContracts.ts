import type {ProviderPin} from "./contracts.js";

export const QUOTE_VERSION = "2026-09-29" as const;
export type QuoteInput = {fiatCurrency: string; amount: string; clientIp?: string};
export type QuoteCapabilities = {paymentMethod: "card"; cacheMs: number};
export type QuoteFailureCode = "UNAVAILABLE" | "UNSUPPORTED" | "MINIMUM_AMOUNT" | "MAXIMUM_AMOUNT" | "INVALID" | "RATE_LIMITED" | "EXPIRED";
export type QuoteFailure = {status: "unavailable"; code: QuoteFailureCode; message: string; minimumAmount?: string; maximumAmount?: string};
export type QuoteEstimate = {
  requestedBudget: string; fiatCurrency: string; estimatedTotal: string; estimatedUsdc: string;
  fees: {label: string; amount: string | null}[]; paymentMethod: "card";
  observedAt: number; expiresAt: number;
};
// These prefill fields belong to the connector, never to an Android request.
export type AdapterQuote = {estimate: QuoteEstimate; checkoutAmount: string};
export type QuoteResult = ({schemaVersion: typeof QUOTE_VERSION; provider: ProviderPin; environment: "sandbox" | "production"} &
  (({status: "ready"; quoteReference: string} & QuoteEstimate) | QuoteFailure));
export class QuoteError extends Error {
  constructor(readonly code: QuoteFailureCode, message: string, readonly bounds: {minimumAmount?: string; maximumAmount?: string} = {}) {super(message);}
}
