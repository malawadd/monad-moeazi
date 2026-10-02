import { createHash } from "node:crypto";
import { type Address, type Hex, isAddress } from "viem";
import type { SwapScope } from "./sessionSignerVault.js";

/** Shared with agent-service uniswap_swap_payload_hash; do not change without a cross-service vector. */
export function scopedSwapPayloadHash(input: {
  assignmentId: string; calldata: Hex; clientId: string; grantId: string; owner: Address;
  scope: SwapScope; strategyAccountId: string; target: Address;
}): string {
  if (![input.assignmentId, input.clientId, input.grantId, input.strategyAccountId].every(value =>
    typeof value === "string" && value.trim().length > 0)) throw new Error("Swap submission identity is incomplete");
  if (!isAddress(input.owner) || !isAddress(input.target) || !/^0x(?:[0-9a-fA-F]{2})+$/.test(input.calldata)) {
    throw new Error("Swap payload address or calldata is invalid");
  }
  if (input.scope !== "buy" && input.scope !== "exit") throw new Error("Swap scope is invalid");
  const body = { assignmentId: input.assignmentId, chainId: 42161, calldata: input.calldata.toLowerCase(),
    clientId: input.clientId, grantId: input.grantId, owner: input.owner.toLowerCase(), scope: input.scope,
    strategyAccountId: input.strategyAccountId, target: input.target.toLowerCase(), value: "0", venue: "uniswap" };
  const canonical = Object.fromEntries(Object.entries(body).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  return createHash("sha256").update(`moeazi-uniswap-swap-v1\n${JSON.stringify(canonical)}`).digest("hex");
}
