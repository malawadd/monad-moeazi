import { createHmac, timingSafeEqual } from "node:crypto";
import { ConnectorError, type PurchaseObservation, type PurchaseState } from "../contracts.js";

export function hmac(secret: string, data: string, encoding: "hex" | "base64" = "hex") {
  return createHmac("sha256", secret).update(data).digest(encoding);
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectorError("INVALID", "Provider returned an invalid response.");
  return value as Record<string, unknown>;
}
export function webhookBody(raw: string): Record<string, unknown> {
  try { const value = JSON.parse(raw); if (!value || typeof value !== "object" || Array.isArray(value)) throw 0; return value; }
  catch { throw new ConnectorError("INVALID", "Invalid provider event.", 400); }
}
export function scalar(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 512) throw new ConnectorError("INVALID", "Provider returned an invalid reference.");
  return value;
}
export function observation(order: Record<string, unknown>, fields: {id: string; reference: string; status: string; date: string; hash: string}): PurchaseObservation {
  const externalId = scalar(order[fields.id]);
  const status = String(order[fields.status]).toLowerCase();
  const statuses: Record<string, PurchaseState> = {completed: "delivery_pending", complete: "delivery_pending", failed: "failed", cancelled: "cancelled", canceled: "cancelled", expired: "cancelled"};
  const date = Date.parse(String(order[fields.date]));
  if (!Number.isFinite(date)) throw new ConnectorError("INVALID", "Provider returned an invalid observation time.");
  const hash = order[fields.hash];
  const reference = order[fields.reference];
  return {externalId, purchaseId: typeof reference === "string" ? reference : undefined,
    state: statuses[status] ?? "processing", occurredAt: date, eventId: `${externalId}:${status}:${date}`,
    transactionHash: typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash) ? hash as `0x${string}` : undefined};
}
