import { type Address, type PublicClient, decodeFunctionResult, encodeFunctionData, isAddress } from "viem";
import { CHAIN } from "./contracts.js";
import { ARBITRUM_USDC, ARBITRUM_V3_FACTORY, ARBITRUM_V3_QUOTER_V2, ARBITRUM_V3_SWAP_ROUTER, ARBITRUM_WETH,
  poolFactoryAbi, quoterV2Abi, V3_FEE_TIER } from "./uniswapV3.js";

export type SwapScope = "buy" | "exit";
export type ScopedSwapQuote = {
  schemaVersion: "arbitrum-v3-quote-v1"; chainId: 42161; venue: "uniswap";
  router: Address; quoter: Address; pool: Address; tokenIn: Address; tokenOut: Address;
  feeTier: number; amountIn: string; amountOut: string; minimumAmountOut: string;
  slippageBps: number; sourceBlock: { number: string; hash: `0x${string}`; timestamp: string; finality: "finalized" };
  sqrtPriceX96After: string; initializedTicksCrossed: string; gasEstimate: string;
};

/** A direct v3 pool quote, pinned to an RPC finalized block; it is not an order book. */
export async function quoteScopedSwap(
  client: PublicClient,
  scope: SwapScope,
  amountIn: bigint,
  slippageBps: number,
): Promise<ScopedSwapQuote> {
  if (client.chain?.id !== CHAIN) throw new Error("Scoped swap quotes require an Arbitrum One client");
  if (amountIn <= 0n) throw new Error("Quote input amount must be positive");
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) {
    throw new Error("Slippage must be between 1 and 500 basis points");
  }
  const tokenIn = (scope === "buy" ? ARBITRUM_USDC : ARBITRUM_WETH) as Address;
  const tokenOut = (scope === "buy" ? ARBITRUM_WETH : ARBITRUM_USDC) as Address;
  const block = await client.getBlock({ blockTag: "finalized" });
  if (block.number === null || !block.hash || !block.timestamp) throw new Error("Finalized block is unavailable");
  const calldata = encodeFunctionData({ abi: quoterV2Abi, functionName: "quoteExactInputSingle", args: [{
    tokenIn, tokenOut, amountIn, fee: V3_FEE_TIER, sqrtPriceLimitX96: 0n,
  }] });
  const quoted = await client.call({ to: ARBITRUM_V3_QUOTER_V2, data: calldata, blockNumber: block.number });
  if (!quoted.data) throw new Error("Quoter returned no result");
  const [amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate] = decodeFunctionResult({
    abi: quoterV2Abi, functionName: "quoteExactInputSingle", data: quoted.data,
  });
  if (amountOut <= 0n) throw new Error("Quote returned no output");
  const pool = await client.readContract({ address: ARBITRUM_V3_FACTORY, abi: poolFactoryAbi,
    functionName: "getPool", args: [tokenIn, tokenOut, V3_FEE_TIER], blockNumber: block.number });
  if (!isAddress(pool) || pool.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error("The fixed Uniswap v3 pool is unavailable");
  }
  return { schemaVersion: "arbitrum-v3-quote-v1", chainId: CHAIN, venue: "uniswap",
    router: ARBITRUM_V3_SWAP_ROUTER, quoter: ARBITRUM_V3_QUOTER_V2,
    pool, tokenIn, tokenOut, feeTier: V3_FEE_TIER, amountIn: amountIn.toString(),
    amountOut: amountOut.toString(), minimumAmountOut: (amountOut * BigInt(10_000 - slippageBps) / 10_000n).toString(),
    slippageBps, sourceBlock: { number: block.number.toString(), hash: block.hash,
      timestamp: block.timestamp.toString(), finality: "finalized" },
    sqrtPriceX96After: sqrtPriceX96After.toString(), initializedTicksCrossed: initializedTicksCrossed.toString(), gasEstimate: gasEstimate.toString() };
}
