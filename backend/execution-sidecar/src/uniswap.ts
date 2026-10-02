import { isAddress, isHex, type Address, type Hex } from "viem";

export const ARBITRUM_CHAIN_ID = 42161;
export const ARBITRUM_UNIVERSAL_ROUTER = "0xa51afafe0263b40edaef0df8781ea9aa03e381a3";
export const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const UNISWAP_X = new Set(["DUTCH_V2", "DUTCH_V3", "PRIORITY"]);

export type ValidatedTransaction = {
  to: Address;
  from: Address;
  data: Hex;
  value: bigint;
  chainId: number;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function routingOf(quote: Record<string, unknown>) {
  const nested = object(quote.quote);
  const value = quote.routing ?? nested?.routing;
  return typeof value === "string" ? value.toUpperCase() : "CLASSIC";
}

export function prepareSwapRequest(quoteResponse: Record<string, unknown>, signature?: string) {
  const { permitData, permitTransaction: _permitTransaction, moeazi: _metadata, ...clean } = quoteResponse;
  const request: Record<string, unknown> = { ...clean };
  if (UNISWAP_X.has(routingOf(quoteResponse))) {
    if (signature) request.signature = signature;
  } else if (signature && object(permitData)) {
    request.signature = signature;
    request.permitData = permitData;
  }
  return request;
}

export function assertFresh(quotedAt: number, now = Date.now()) {
  if (!Number.isFinite(quotedAt) || quotedAt <= 0 || now - quotedAt > 30_000 || quotedAt > now + 5_000) {
    throw new Error("Uniswap quote is stale; requote before execution");
  }
}

export function validateTransaction(input: {
  result: unknown;
  expectedSender: string;
  allowedTargets: Set<string>;
}): ValidatedTransaction {
  const root = object(input.result);
  const tx = object(root?.swap) ?? object(root?.transaction) ?? root;
  if (!tx || !isAddress(String(tx.to ?? ""))) throw new Error("Invalid swap transaction target");
  if (!isAddress(String(tx.from ?? ""))) throw new Error("Invalid swap transaction sender");
  if (String(tx.from).toLowerCase() !== input.expectedSender.toLowerCase()) throw new Error("Swap sender does not match the strategy UA");
  const target = String(tx.to).toLowerCase();
  if (!input.allowedTargets.has(target)) throw new Error("Swap target is not allowlisted for Arbitrum");
  if (!isHex(String(tx.data ?? "")) || String(tx.data) === "0x") throw new Error("Invalid swap transaction calldata");
  const chainId = Number(tx.chainId ?? ARBITRUM_CHAIN_ID);
  if (chainId !== ARBITRUM_CHAIN_ID) throw new Error("Swap transaction is not on Arbitrum");
  let value: bigint;
  try { value = BigInt(String(tx.value ?? "0")); } catch { throw new Error("Invalid swap transaction value"); }
  if (value < 0n) throw new Error("Swap transaction value cannot be negative");
  return { to: target as Address, from: String(tx.from) as Address, data: String(tx.data) as Hex, value, chainId };
}

export function allowedTargets(extra = "") {
  const values = [ARBITRUM_UNIVERSAL_ROUTER, PERMIT2, ...extra.split(",")]
    .map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (values.some((value) => !isAddress(value))) throw new Error("UNISWAP_ARBITRUM_TARGETS contains an invalid address");
  return new Set(values);
}
