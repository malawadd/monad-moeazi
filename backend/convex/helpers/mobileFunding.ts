export const MOBILE_FUNDING_CHAIN_ID = 42161 as const;
export const MOBILE_FUNDING_USDC_ADDRESS =
  "0xaf88d065e77c8cc2239327c5edb3a432268e5831" as const;
export const MOBILE_FUNDING_REGISTRY_VERSION = "arbitrum-mainnet-2026-07-21" as const;

export type MobileFundingSnapshot = {
  schemaVersion: "2026-09-01";
  ownerAddress: string;
  depositAddress: string;
  universalAccount: string;
  network: "Arbitrum";
  chainId: 42161;
  status: "waiting" | "available";
  tradingAsset: {
    symbol: "USDC"; amount: string; amountUsd: string;
    contractAddress: typeof MOBILE_FUNDING_USDC_ADDRESS; decimals: 6;
  };
  feeAsset: { symbol: "ETH"; amount: string; decimals: 18 };
  observedBlock?: number;
  observedAt?: string;
  stale: boolean;
};

export function assertUnsignedInteger(value: string, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`${label} must be an unsigned integer.`);
  return BigInt(value);
}

export function decimalFromRaw(value: string, decimals: number) {
  const raw = assertUnsignedInteger(value, "Token amount");
  const padded = raw.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function rawFromRpcHex(value: unknown, label: string) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${label} returned an invalid amount.`);
  }
  return BigInt(value).toString();
}

export function balanceOfCallData(owner: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) throw new Error("Funding owner is invalid.");
  return `0x70a08231${owner.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function fundingObservationDisposition(
  previous: { block?: number; usdcRaw?: string; ethRaw?: string },
  next: { block: number; usdcRaw: string; ethRaw: string },
) {
  if (previous.block === undefined) return "new" as const;
  if (next.block < previous.block) return "older" as const;
  if (next.block > previous.block) return "new" as const;
  if (previous.usdcRaw !== next.usdcRaw || previous.ethRaw !== next.ethRaw) {
    throw new Error("Conflicting balances were returned for one Arbitrum block.");
  }
  return "duplicate" as const;
}

type RpcFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function rpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  fetcher: RpcFetcher,
) {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("Arbitrum balance service is temporarily unavailable.");
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (body.error || body.result === undefined) {
    throw new Error(body.error?.message ?? "Arbitrum returned an incomplete balance response.");
  }
  return body.result;
}

export async function readArbitrumFundingBalances(
  rpcUrl: string,
  owner: string,
  fetcher: RpcFetcher = fetch,
) {
  const normalizedOwner = owner.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalizedOwner)) throw new Error("Funding owner is invalid.");
  const [chainHex, blockHex] = await Promise.all([
    rpc(rpcUrl, "eth_chainId", [], fetcher),
    rpc(rpcUrl, "eth_blockNumber", [], fetcher),
  ]);
  if (Number(BigInt(String(chainHex))) !== MOBILE_FUNDING_CHAIN_ID) {
    throw new Error("Funding balance service is connected to the wrong network.");
  }
  const blockNumber = Number(BigInt(String(blockHex)));
  if (!Number.isSafeInteger(blockNumber) || blockNumber <= 0) {
    throw new Error("Arbitrum returned an invalid block number.");
  }
  const [ethHex, usdcHex] = await Promise.all([
    rpc(rpcUrl, "eth_getBalance", [normalizedOwner, blockHex], fetcher),
    rpc(rpcUrl, "eth_call", [{
      to: MOBILE_FUNDING_USDC_ADDRESS,
      data: balanceOfCallData(normalizedOwner),
    }, blockHex], fetcher),
  ]);
  return {
    blockNumber,
    ethBalanceRaw: rawFromRpcHex(ethHex, "ETH balance"),
    usdcBalanceRaw: rawFromRpcHex(usdcHex, "USDC balance"),
  };
}
