import { type Address, type Hex, encodeFunctionData, getAddress, isAddress } from "viem";
import type { PublicClient } from "viem";
import { CHAIN } from "./contracts.js";
import type { SwapGrantInput } from "./scopedSwapGrant.js";
import { ARBITRUM_USDC, ARBITRUM_V3_SWAP_ROUTER, ARBITRUM_WETH, allowanceAbi, approveAbi } from "./uniswapV3.js";

export type SwapAllowanceSnapshot = {
  blockNumber: string; blockHash: Hex; owner: Address;
  usdcBalanceUnits: string; usdcAllowanceUnits: string;
  wethBalanceUnits: string; wethAllowanceUnits: string;
  buyReady: boolean; exitAllowanceReady: boolean;
};
export type OwnerAllowanceCall = { to: Address; value: 0n; data: Hex; token: Address; amount: string };

/** Read both assets and both allowances against the router at one finalized Arbitrum block. */
export async function readSwapAllowanceSnapshot(
  client: PublicClient, owner: Address,
  input: Pick<SwapGrantInput, "owner" | "maxUsdcUnits" | "maxWethUnits">,
): Promise<SwapAllowanceSnapshot> {
  if (client.chain?.id !== CHAIN || !isAddress(owner) || owner.toLowerCase() !== input.owner.toLowerCase()) {
    throw new Error("Swap allowance read requires the bound Arbitrum owner");
  }
  const block = await client.getBlock({ blockTag: "finalized" });
  if (block.number === null || block.hash === null) throw new Error("Finalized block is unavailable");
  const [usdcBalance, usdcAllowance, wethBalance, wethAllowance] = await Promise.all([
    client.readContract({ address: ARBITRUM_USDC, abi: allowanceAbi, functionName: "balanceOf", args: [owner], blockNumber: block.number }),
    client.readContract({ address: ARBITRUM_USDC, abi: allowanceAbi, functionName: "allowance", args: [owner, ARBITRUM_V3_SWAP_ROUTER], blockNumber: block.number }),
    client.readContract({ address: ARBITRUM_WETH, abi: allowanceAbi, functionName: "balanceOf", args: [owner], blockNumber: block.number }),
    client.readContract({ address: ARBITRUM_WETH, abi: allowanceAbi, functionName: "allowance", args: [owner, ARBITRUM_V3_SWAP_ROUTER], blockNumber: block.number }),
  ]);
  return { blockNumber: block.number.toString(), blockHash: block.hash, owner: getAddress(owner),
    usdcBalanceUnits: usdcBalance.toString(), usdcAllowanceUnits: usdcAllowance.toString(),
    wethBalanceUnits: wethBalance.toString(), wethAllowanceUnits: wethAllowance.toString(),
    buyReady: usdcBalance >= input.maxUsdcUnits && usdcAllowance >= input.maxUsdcUnits,
    exitAllowanceReady: wethAllowance >= input.maxWethUnits };
}

/** Owner-only one-time setup calls: exact caps, never included in a session-key grant. */
export function buildOwnerAllowanceCalls(input: SwapGrantInput): [OwnerAllowanceCall, OwnerAllowanceCall] {
  return [
    { to: ARBITRUM_USDC, value: 0n, token: ARBITRUM_USDC, amount: input.maxUsdcUnits.toString(),
      data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [ARBITRUM_V3_SWAP_ROUTER, input.maxUsdcUnits] }) },
    { to: ARBITRUM_WETH, value: 0n, token: ARBITRUM_WETH, amount: input.maxWethUnits.toString(),
      data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [ARBITRUM_V3_SWAP_ROUTER, input.maxWethUnits] }) },
  ];
}
