import { isAddress, type Address } from "viem";
import { KERNEL } from "./mobile/contracts.js";
import { ARBITRUM_USDC, ARBITRUM_WETH } from "./uniswapSettlement.js";

const balanceAbi = [{ type: "function", name: "balanceOf", stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }],
  outputs: [{ type: "uint256" }] }] as const;

type AccountReadClient = {
  getChainId(): Promise<number>;
  getBlock(input: { blockTag: "finalized" }): Promise<{
    number: bigint | null; hash: `0x${string}` | null; timestamp: bigint;
  }>;
  getCode(input: { address: Address; blockNumber: bigint }): Promise<`0x${string}` | undefined>;
  readContract(input: { address: Address; abi: typeof balanceAbi;
    functionName: "balanceOf"; args: readonly [Address]; blockNumber: bigint }): Promise<bigint>;
};

/** One finalized block is the source for wallet identity and both spot balances. */
export async function readUniswapAccount(client: AccountReadClient, owner: string) {
  if (!isAddress(owner)) throw new Error("Invalid Arbitrum account address");
  if (await client.getChainId() !== 42161) throw new Error("Account read requires Arbitrum One");
  const account = owner.toLowerCase() as Address;
  const block = await client.getBlock({ blockTag: "finalized" });
  if (block.number === null || block.hash === null) throw new Error("Finalized block is unavailable");
  const [code, usdc, weth] = await Promise.all([
    client.getCode({ address: account, blockNumber: block.number }),
    client.readContract({ address: ARBITRUM_USDC, abi: balanceAbi,
      functionName: "balanceOf", args: [account], blockNumber: block.number }),
    client.readContract({ address: ARBITRUM_WETH, abi: balanceAbi,
      functionName: "balanceOf", args: [account], blockNumber: block.number }),
  ]);
  const delegated = code?.toLowerCase() === `0xef0100${KERNEL.slice(2).toLowerCase()}`;
  return { chainId: 42161, account, blockNumber: block.number.toString(),
    blockHash: block.hash, blockTimestamp: block.timestamp.toString(),
    accountMode: delegated ? "kernel-7702" as const : "other" as const,
    balances: { USDC: usdc.toString(), WETH: weth.toString() },
    trackedPairComplete: true, balancesComplete: false, positionsComplete: false,
    source: "arbitrum_finalized_rpc" as const };
}
