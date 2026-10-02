import type { TradeIntentStatus } from "./types";

export function canCancelTradeIntent(status: TradeIntentStatus) {
  return status === "queued" || status === "quoted" || status === "funding_submitted";
}

export function assertCanCancelTradeIntent(status: TradeIntentStatus) {
  if (!canCancelTradeIntent(status)) {
    throw new Error("Only queued, quoted, or funding-submitted trade intents can be cancelled.");
  }
}

export function normalizeOptionalHours(value: number | null | undefined) {
  if (value === undefined || value === null || value === 0) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Expected hold time cannot be negative.");
  }
  return value;
}
