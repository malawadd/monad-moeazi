export const ARBITRUM_CHAIN_ID = 42161 as const;
export const ARBITRUM_CAIP2 = "eip155:42161" as const;
export const ARBITRUM_UNIVERSAL_ROUTER =
  "0xa51afafe0263b40edaef0df8781ea9aa03e381a3" as const;
export const PERMIT2_ADDRESS =
  "0x000000000022d473030f116ddee9f6b43ac78ba3" as const;

export type ArbitrumTokenSymbol = "USDC" | "WETH" | "LINK";

export type ArbitrumToken = {
  symbol: ArbitrumTokenSymbol;
  name: string;
  address: `0x${string}`;
  decimals: number;
  chainId: typeof ARBITRUM_CHAIN_ID;
  verification: "fixed" | "runtime";
};

export const ARBITRUM_TOKEN_REGISTRY_VERSION = "arbitrum-mainnet-2026-07-21";

export const ARBITRUM_TOKENS: Record<ArbitrumTokenSymbol, ArbitrumToken> = {
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    decimals: 6,
    chainId: ARBITRUM_CHAIN_ID,
    verification: "fixed",
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    decimals: 18,
    chainId: ARBITRUM_CHAIN_ID,
    verification: "fixed",
  },
  LINK: {
    symbol: "LINK",
    name: "ChainLink Token",
    address: "0xf97f4df75117a78c1a5a0dbb814af92458539fb4",
    decimals: 18,
    chainId: ARBITRUM_CHAIN_ID,
    verification: "runtime",
  },
};

export const ARBITRUM_SWAP_TARGETS: ReadonlySet<string> = new Set([
  ARBITRUM_UNIVERSAL_ROUTER,
  PERMIT2_ADDRESS,
]);

export function isArbitrumAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function isAllowedArbitrumSwapTarget(value: string) {
  return isArbitrumAddress(value) && ARBITRUM_SWAP_TARGETS.has(value.toLowerCase());
}

export function assertArbitrumSwapPair(input: {
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: string | number;
  tokenOutChainId: string | number;
}) {
  if (String(input.tokenInChainId) !== String(ARBITRUM_CHAIN_ID)
    || String(input.tokenOutChainId) !== String(ARBITRUM_CHAIN_ID)) {
    throw new Error("Strategy swaps must stay on Arbitrum mainnet (42161).");
  }
  const registered = new Set(Object.values(ARBITRUM_TOKENS).map((token) => token.address));
  if (!registered.has(input.tokenIn.toLowerCase() as `0x${string}`)
    || !registered.has(input.tokenOut.toLowerCase() as `0x${string}`)) {
    throw new Error("Swap token is not active in the versioned Arbitrum registry.");
  }
  if (input.tokenIn.toLowerCase() === input.tokenOut.toLowerCase()) {
    throw new Error("Choose two different assets.");
  }
}
