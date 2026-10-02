import type { Address } from "viem";

export const ARBITRUM_V3_SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564" as Address;
export const ARBITRUM_V3_QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e" as Address;
export const ARBITRUM_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984" as Address;
export const V3_FEE_TIER = 3000;
export const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;
export const ARBITRUM_WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as Address;

export const swapRouterAbi = [{ type: "function", name: "exactInputSingle", stateMutability: "payable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "fee", type: "uint24" }, { name: "recipient", type: "address" },
    { name: "deadline", type: "uint256" }, { name: "amountIn", type: "uint256" },
    { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
  ] }], outputs: [{ name: "amountOut", type: "uint256" }] }] as const;

export const allowanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export const approveAbi = [{ type: "function", name: "approve", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;

export const quoterV2Abi = [{ type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "fee", type: "uint24" },
    { name: "sqrtPriceLimitX96", type: "uint160" },
  ] }], outputs: [
    { name: "amountOut", type: "uint256" }, { name: "sqrtPriceX96After", type: "uint160" },
    { name: "initializedTicksCrossed", type: "uint32" }, { name: "gasEstimate", type: "uint256" },
  ] }] as const;

export const poolFactoryAbi = [{ type: "function", name: "getPool", stateMutability: "view",
  inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" }],
  outputs: [{ name: "pool", type: "address" }] }] as const;
