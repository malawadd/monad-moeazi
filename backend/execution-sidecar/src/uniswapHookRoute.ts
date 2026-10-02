import {
  encodeAbiParameters,
  isAddress,
  isHash,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  ARBITRUM_V4_ROUTER,
  encodeHookRouteTransaction,
} from "./uniswapHookEncoding.js";

export const ARBITRUM_POOL_MANAGER = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";
export const ARBITRUM_V4_QUOTER = "0x3972c00f7ed4885e145823eb7c655375d275a1c5";
export { ARBITRUM_V4_ROUTER };
export const ARBITRUM_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
export const ARBITRUM_WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const HOOK_PERMISSION_MASK = (1n << 14n) - 1n;
const MOEAZI_HOOK_FLAGS = (1n << 7n) | (1n << 6n);
const MAX_UINT128 = (1n << 128n) - 1n;

export type HookPoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type HookExperimentConfig = {
  enabled: true;
  hookAddress: Address;
  hookCodeHash: Hex;
  fee: number;
  tickSpacing: number;
};

export type HookExperimentStatus =
  | HookExperimentConfig
  | { enabled: false; reason: string };

export type HookQuoteRequest = {
  tokenIn: Address;
  tokenOut: Address;
  amount: string;
  swapper: Address;
  slippageTolerance?: number;
};

const quoterAbi = [{
  type: "function",
  name: "quoteExactInputSingle",
  stateMutability: "nonpayable",
  inputs: [{
    name: "params",
    type: "tuple",
    components: [
      {
        name: "poolKey",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "zeroForOne", type: "bool" },
      { name: "exactAmount", type: "uint128" },
      { name: "hookData", type: "bytes" },
    ],
  }],
  outputs: [
    { name: "amountOut", type: "uint256" },
    { name: "gasEstimate", type: "uint256" },
  ],
}] as const;

export function loadHookExperiment(
  env: Record<string, string | undefined>,
): HookExperimentStatus {
  if (env.UNISWAP_HOOK_EXPERIMENT_ENABLED !== "true") {
    return { enabled: false, reason: "Hook experiment is disabled" };
  }
  const address = env.UNISWAP_HOOK_ADDRESS?.toLowerCase() ?? "";
  const codeHash = env.UNISWAP_HOOK_CODE_HASH?.toLowerCase() ?? "";
  if (!isAddress(address)) return { enabled: false, reason: "Hook address is not configured" };
  if (!isHash(codeHash)) return { enabled: false, reason: "Hook bytecode hash is not configured" };
  if ((BigInt(address) & HOOK_PERMISSION_MASK) !== MOEAZI_HOOK_FLAGS) {
    return { enabled: false, reason: "Hook address must encode only beforeSwap and afterSwap permissions" };
  }
  const fee = Number(env.UNISWAP_HOOK_FEE ?? "3000");
  const tickSpacing = Number(env.UNISWAP_HOOK_TICK_SPACING ?? "60");
  if (!Number.isInteger(fee) || fee < 0 || fee > 1_000_000) {
    return { enabled: false, reason: "Hook pool fee is invalid" };
  }
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0 || tickSpacing > 32767) {
    return { enabled: false, reason: "Hook pool tick spacing is invalid" };
  }
  return {
    enabled: true,
    hookAddress: address,
    hookCodeHash: codeHash,
    fee,
    tickSpacing,
  };
}

export function hookPoolKey(config: HookExperimentConfig): HookPoolKey {
  return {
    currency0: ARBITRUM_WETH,
    currency1: ARBITRUM_USDC,
    fee: config.fee,
    tickSpacing: config.tickSpacing,
    hooks: config.hookAddress,
  };
}

export function hookPoolId(key: HookPoolKey): Hex {
  return keccak256(encodeAbiParameters([{
    type: "tuple",
    components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
  }], [key]));
}

export function hookConfigHash(key: HookPoolKey, codeHash: Hex): Hex {
  return keccak256(encodeAbiParameters([
    {
      type: "tuple",
      components: [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" },
        { name: "hooks", type: "address" },
      ],
    },
    { type: "bytes32" },
  ], [key, codeHash]));
}

export function buildHookRouteTransaction(input: {
  config: HookExperimentConfig;
  tokenIn: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
  deadline: bigint;
}) {
  const normalizedTokenIn = input.tokenIn.toLowerCase();
  assertPair(input.tokenIn, normalizedTokenIn === ARBITRUM_WETH ? ARBITRUM_USDC : ARBITRUM_WETH);
  assertUint128(input.amountIn, "input amount");
  assertUint128(input.amountOutMinimum, "minimum output");
  const key = hookPoolKey(input.config);
  return encodeHookRouteTransaction({
    ...input,
    key,
    poolId: hookPoolId(key),
  });
}

export async function quoteHookPool(
  client: PublicClient,
  config: HookExperimentConfig,
  input: HookQuoteRequest,
) {
  assertPair(input.tokenIn, input.tokenOut);
  const amountIn = BigInt(input.amount);
  assertUint128(amountIn, "input amount");
  const code = await client.getCode({ address: config.hookAddress });
  if (!code || code === "0x") throw new Error("Configured hook has no deployed bytecode");
  const actualCodeHash = keccak256(code);
  if (actualCodeHash !== config.hookCodeHash) throw new Error("Configured hook bytecode hash does not match");
  const key = hookPoolKey(config);
  const zeroForOne = input.tokenIn.toLowerCase() === key.currency0;
  const { result } = await client.simulateContract({
    address: ARBITRUM_V4_QUOTER,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x" }],
    account: input.swapper,
  });
  const [amountOut, gasEstimate] = result;
  const slippageBps = Math.round((input.slippageTolerance ?? 0.5) * 100);
  if (slippageBps < 0 || slippageBps > 500) throw new Error("Hook experiment slippage must be between 0% and 5%");
  const minimumOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n;
  const quotedAt = Date.now();
  const transaction = buildHookRouteTransaction({
    config,
    tokenIn: input.tokenIn,
    amountIn,
    amountOutMinimum: minimumOut,
    deadline: BigInt(Math.floor(quotedAt / 1000) + 30),
  });
  let simulation = { success: false, reason: "Simulation was not attempted" };
  try {
    await client.call({
      account: input.swapper,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    });
    simulation = { success: true, reason: "eth_call succeeded" };
  } catch (error) {
    simulation = {
      success: false,
      reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    };
  }
  return {
    available: true,
    routeSource: "moeazi_v4_hook",
    routing: "V4_HOOK",
    quote: {
      input: { token: input.tokenIn, amount: input.amount },
      output: { token: input.tokenOut, amount: amountOut.toString() },
      gasUseEstimate: gasEstimate.toString(),
      slippage: slippageBps / 100,
    },
    moeazi: { chainId: "42161", quotedAt },
    attestation: {
      poolId: transaction.poolId,
      poolKey: transaction.poolKey,
      hookCodeHash: actualCodeHash,
      configHash: hookConfigHash(transaction.poolKey, actualCodeHash),
    },
    transaction: {
      to: transaction.to,
      from: input.swapper,
      data: transaction.data,
      value: "0",
      chainId: 42161,
    },
    simulation,
    broadcastAllowed: false,
  };
}

function assertPair(tokenIn: string, tokenOut: string) {
  const actual = new Set([tokenIn.toLowerCase(), tokenOut.toLowerCase()]);
  if (actual.size !== 2 || !actual.has(ARBITRUM_USDC) || !actual.has(ARBITRUM_WETH)) {
    throw new Error("Hook experiment supports only the registered Arbitrum USDC/WETH pair");
  }
}

function assertUint128(value: bigint, label: string) {
  if (value <= 0n || value > MAX_UINT128) throw new Error(`Hook route ${label} must fit uint128`);
}
