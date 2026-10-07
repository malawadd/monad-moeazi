import { TypedDataEncoder, verifyTypedData } from "ethers";
import { MONAD_CHAIN_ID, USDC_ADDRESS } from "./constants.js";

export const PERP_POLICY_VERSION = 1;
export const PERP_MIN_AMOUNT = 100_000n;
export const PERP_MAX_AMOUNT = 10_000_000n;
export const PERP_MIN_TRADE_MARGIN = 10_000n;
export const PERP_MIN_DURATION_SECONDS = 600;
export const PERP_MAX_DURATION_SECONDS = 7200;
export const PERP_MAX_LEVERAGE = 10;
export const PERP_MAX_PAYOUT_MULTIPLE = 5;
export const PERP_PREPARE_TTL_SECONDS = 300;
export const PERP_TICK_MS = 15_000;

export const PERP_MANDATE_TYPES = { PerpMandate: [
  { name: "chainId", type: "uint256" }, { name: "owner", type: "address" },
  { name: "vault", type: "address" }, { name: "usdc", type: "address" },
  { name: "clearinghouse", type: "address" }, { name: "executor", type: "address" },
  { name: "tokens", type: "address[3]" }, { name: "pools", type: "address[3]" },
  { name: "fundingAmount", type: "uint256" }, { name: "durationSeconds", type: "uint64" },
  { name: "setupDeadline", type: "uint64" }, { name: "policyVersion", type: "uint8" },
  { name: "nonce", type: "uint256" },
] } as const;
export const CIRCLE_AUTHORIZATION_TYPES = { ReceiveWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
] } as const;
export const PERP_STOP_TYPES = { Stop: [
  { name: "vault", type: "address" }, { name: "owner", type: "address" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint64" },
] } as const;

export function buildPerpCircleAuthorization(input: { owner: string; vault: string; amountUnits: string; nonce: string; now: number }) {
  return { domain: { name: "USDC", version: "2", chainId: MONAD_CHAIN_ID, verifyingContract: USDC_ADDRESS },
    types: CIRCLE_AUTHORIZATION_TYPES, primaryType: "ReceiveWithAuthorization" as const,
    message: { from: input.owner, to: input.vault, value: input.amountUnits, validAfter: "0",
      validBefore: String(input.now + PERP_PREPARE_TTL_SECONDS), nonce: input.nonce } };
}

export function buildPerpMandate(input: { owner: string; vault: string; factoryAddress: string; clearinghouse: string; executor: string;
  tokens: string[]; pools: string[]; amountUnits: string; durationSeconds: number; setupDeadline: number; nonce: string }) {
  if (input.tokens.length !== 3 || input.pools.length !== 3) throw new Error("Exactly three perp markets are required.");
  return { domain: { name: "Moeazi Monad Testnet Perp", version: "1", chainId: MONAD_CHAIN_ID,
    verifyingContract: input.factoryAddress }, types: PERP_MANDATE_TYPES,
    primaryType: "PerpMandate" as const, message: { chainId: MONAD_CHAIN_ID, owner: input.owner, vault: input.vault,
      usdc: USDC_ADDRESS, clearinghouse: input.clearinghouse, executor: input.executor,
      tokens: input.tokens, pools: input.pools, fundingAmount: input.amountUnits,
      durationSeconds: input.durationSeconds, setupDeadline: input.setupDeadline,
      policyVersion: PERP_POLICY_VERSION, nonce: input.nonce } };
}

export function buildPerpStop(input: { vault: string; owner: string; nonce: string; deadline: number }) {
  return { domain: { name: "Moeazi Monad Testnet Perp Vault", version: "1", chainId: MONAD_CHAIN_ID,
    verifyingContract: input.vault }, types: PERP_STOP_TYPES, primaryType: "Stop" as const,
    message: { vault: input.vault, owner: input.owner, nonce: input.nonce, deadline: input.deadline } };
}

export function verifyPerpOwnerSignature(typedData: any, signature: string, owner: string) {
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error("A 65-byte Mera typed-data signature is required.");
  const recovered = verifyTypedData(typedData.domain, typedData.types, typedData.message, signature);
  if (recovered.toLowerCase() !== owner.toLowerCase()) throw new Error("Typed-data signature does not match the Mera owner.");
  return recovered;
}

export function perpMandateHash(typedData: any) {
  return TypedDataEncoder.hash(typedData.domain, typedData.types, typedData.message).toLowerCase();
}
