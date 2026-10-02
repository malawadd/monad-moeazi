import {formatUnits, parseUnits} from "viem";
import {QuoteError, type AdapterQuote, type QuoteInput} from "../quoteContracts.js";
import {record} from "./common.js";
import type {JsonRequest} from "./http.js";

export function decimal(value: unknown, decimals = 18): string {
  if (typeof value !== "string" && typeof value !== "number") throw new QuoteError("INVALID", "The provider returned incomplete pricing.");
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) throw new QuoteError("INVALID", "The provider returned unsafe pricing.");
  const text = String(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (text.length > 70 || !new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{1,${decimals}})?$`).test(text)) throw new QuoteError("INVALID", "The provider returned unsupported pricing precision.");
  return formatUnits(parseUnits(text, decimals), decimals);
}
export function optionalFee(value: unknown) {return value === undefined || value === null ? null : decimal(value);}
export function verifyFiat(actual: unknown, expected: string) {
  if (typeof actual !== "string" || actual.toUpperCase() !== expected) throw new QuoteError("INVALID", "The provider returned a different currency.");
}
export function makeQuote(input: QuoteInput, total: unknown, usdc: unknown, fees: AdapterQuote["estimate"]["fees"], checkoutAmount: unknown = input.amount, expiry?: number): AdapterQuote {
  const estimatedTotal = decimal(total, 2), requestedBudget = decimal(input.amount, 2), estimatedUsdc = decimal(usdc, 6);
  if (parseUnits(estimatedUsdc, 6) <= 0n) throw new QuoteError("INVALID", "The provider returned no USDC estimate.");
  if (parseUnits(estimatedTotal, 2) !== parseUnits(requestedBudget, 2)) {
    // Never mislabel a provider-clamped quote as the user's requested budget.
    throw new QuoteError("UNSUPPORTED", `The provider cannot quote this exact total budget. Check the amount in checkout.`);
  }
  const now = Date.now();
  return {checkoutAmount: decimal(checkoutAmount, 2), estimate: {requestedBudget, fiatCurrency: input.fiatCurrency,
    estimatedTotal, estimatedUsdc, fees, paymentMethod: "card", observedAt: now, expiresAt: Math.min(now + 30_000, expiry ?? now + 30_000)}};
}
export function quoteRequestWithErrors(translate?: (body: Record<string, unknown>) => QuoteError | undefined): JsonRequest {
 return async (url, init = {}) => {
  let response: Response;
  try {response = await fetch(url, {...init, signal: AbortSignal.timeout(10_000)});} catch {throw new QuoteError("UNAVAILABLE", "The estimate could not be loaded. Check the final amount in checkout.");}
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new QuoteError("RATE_LIMITED", "Too many estimate requests. Try again shortly.");
    const translated = translate?.(body && typeof body === "object" && !Array.isArray(body) ? record(body) : {});
    if (translated) throw translated;
    throw new QuoteError(response.status === 400 ? "UNSUPPORTED" : "UNAVAILABLE", "An estimate is unavailable for this amount and card payment. Review pricing in checkout.");
  }
  if (!body || typeof body !== "object") throw new QuoteError("INVALID", "The provider returned incomplete pricing.");
  return body;
 };
}
export const requestQuoteJson = quoteRequestWithErrors();
