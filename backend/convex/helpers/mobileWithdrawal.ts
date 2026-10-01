export const MOBILE_WITHDRAWAL_CHAIN_ID = 42161 as const;
export const MOBILE_WITHDRAWAL_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831" as const;
export const MOBILE_WITHDRAWAL_SCHEMA = "2026-09-14" as const;
export const MOBILE_WITHDRAWAL_TTL_MS = 5 * 60_000;

export type WithdrawalStatus =
  | "prepared" | "submitted" | "confirming" | "completed" | "failed"
  | "cancelled" | "uncertain" | "expired" | "needs_attention";

export function usdcToRaw(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error("Enter a USDC amount with no more than 6 decimal places.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const raw = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
  if (raw <= 0n) throw new Error("Withdrawal amount must be greater than zero.");
  return raw;
}

export function usdcFromRaw(value: bigint) {
  if (value < 0n) throw new Error("USDC amount cannot be negative.");
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function erc20TransferData(destination: string, amountRaw: bigint) {
  const address = destination.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("Destination address is invalid.");
  return `0xa9059cbb${address.slice(2).padStart(64, "0")}${amountRaw.toString(16).padStart(64, "0")}`;
}

export function isTransactionHash(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
