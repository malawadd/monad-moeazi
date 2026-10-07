import { TypedDataEncoder, verifyTypedData } from "ethers";
import { MONAD_CHAIN_ID, USDC_ADDRESS } from "./constants.js";

export const AUTONOMY_DOMAIN = {
  name: "Moeazi Monad Testnet Autonomy", version: "1", chainId: MONAD_CHAIN_ID,
} as const;
export const CIRCLE_USDC_DOMAIN = {
  name: "USDC", version: "2", chainId: MONAD_CHAIN_ID, verifyingContract: USDC_ADDRESS,
} as const;
export const CIRCLE_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
} as const;
export const STRATEGY_MANDATE_TYPES = {
  StrategyMandate: [
    { name: "chainId", type: "uint256" }, { name: "owner", type: "address" },
    { name: "vault", type: "address" }, { name: "usdc", type: "address" },
    { name: "tokens", type: "address[3]" }, { name: "pools", type: "address[3]" },
    { name: "fundingAmount", type: "uint256" }, { name: "durationSeconds", type: "uint64" },
    { name: "startBy", type: "uint64" }, { name: "maxCycles", type: "uint8" },
    { name: "buySlippageBps", type: "uint16" }, { name: "sellSlippageBps", type: "uint16" },
    { name: "nonce", type: "uint256" },
  ],
} as const;
export const AUTONOMY_BUY_SLIPPAGE_BPS = 300;
export const AUTONOMY_SELL_SLIPPAGE_BPS = 300;
export const AUTONOMY_MAX_CYCLES = 3;
export const AUTONOMY_PREPARE_TTL_SECONDS = 300;

export function buildCircleAuthorizationTypedData(input: {
  owner: string; vault: string; amountUnits: string; nonce: string; nowSeconds: number;
}) {
  return {
    domain: CIRCLE_USDC_DOMAIN,
    types: CIRCLE_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization" as const,
    message: { from: input.owner, to: input.vault, value: input.amountUnits,
      validAfter: "0", validBefore: String(input.nowSeconds + AUTONOMY_PREPARE_TTL_SECONDS), nonce: input.nonce },
  };
}

export function buildStrategyMandateTypedData(input: {
  owner: string; vault: string; tokens: string[]; pools: string[]; amountUnits: string;
  durationSeconds: number; startBy: number; nonce: string; buySlippageBps?: number; sellSlippageBps?: number;
}) {
  if (input.tokens.length !== 3 || input.pools.length !== 3) throw new Error("Exactly three approved token and pool addresses are required.");
  return {
    domain: { ...AUTONOMY_DOMAIN, verifyingContract: input.vault },
    types: STRATEGY_MANDATE_TYPES,
    primaryType: "StrategyMandate" as const,
    message: { chainId: MONAD_CHAIN_ID, owner: input.owner, vault: input.vault, usdc: USDC_ADDRESS,
      tokens: input.tokens, pools: input.pools, fundingAmount: input.amountUnits,
      durationSeconds: input.durationSeconds, startBy: input.startBy, maxCycles: AUTONOMY_MAX_CYCLES,
      buySlippageBps: input.buySlippageBps ?? AUTONOMY_BUY_SLIPPAGE_BPS,
      sellSlippageBps: input.sellSlippageBps ?? AUTONOMY_SELL_SLIPPAGE_BPS,
      nonce: input.nonce },
  };
}

export function assertCircleUsdcDomain(separator: string) {
  const expected = TypedDataEncoder.hashDomain(CIRCLE_USDC_DOMAIN).toLowerCase();
  if (separator.toLowerCase() !== expected) throw new Error("Circle USDC EIP-712 domain differs from the reviewed Monad Testnet domain.");
}

export function verifyOwnerSignature(typedData: any, signature: string, owner: string) {
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error("A 65-byte EIP-712 signature is required.");
  const recovered = verifyTypedData(typedData.domain, typedData.types, typedData.message, signature);
  if (recovered.toLowerCase() !== owner.toLowerCase()) throw new Error("Typed-data signature does not match the Mera owner.");
  return recovered;
}
