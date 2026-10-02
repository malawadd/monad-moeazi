import {isAddress, type Address} from "viem";
import {CHAIN, KERNEL, USDC} from "./contracts.js";

const balanceAbi = [{type: "function", name: "balanceOf", stateMutability: "view",
  inputs: [{type: "address"}], outputs: [{type: "uint256"}]}] as const;

type ReadClient = {
  getChainId(): Promise<number>;
  getBlock(input: {blockTag: "latest" | "finalized"}): Promise<{
    number: bigint | null; hash: `0x${string}` | null; timestamp: bigint;
  }>;
  getCode(input: {address: Address; blockNumber: bigint}): Promise<`0x${string}` | undefined>;
  getBalance(input: {address: Address; blockNumber: bigint}): Promise<bigint>;
  readContract(input: {address: typeof USDC; abi: typeof balanceAbi;
    functionName: "balanceOf"; args: readonly [Address]; blockNumber: bigint}): Promise<bigint>;
};

export function delegationOf(code: string | undefined) {
  const normalized = code?.toLowerCase() ?? "0x";
  if (normalized === "0x") return {kind: "undelegated" as const, target: null};
  if (!/^0xef0100[0-9a-f]{40}$/.test(normalized)) return {kind: "other_code" as const, target: null};
  const target = `0x${normalized.slice(8)}` as Address;
  return {kind: target === KERNEL.toLowerCase() ? "kernel" as const : "other_delegation" as const,
    target};
}

/** Informational latest and finalized reads. Only the finalized Kernel result can qualify execution. */
export async function readExecutionReadiness(client: ReadClient, owner: string) {
  if (!isAddress(owner)) throw new Error("Invalid owner wallet address");
  if (await client.getChainId() !== CHAIN) throw new Error("Execution readiness requires Arbitrum One");
  const address = owner.toLowerCase() as Address;
  const [finalized, latest] = await Promise.all([
    client.getBlock({blockTag: "finalized"}), client.getBlock({blockTag: "latest"}),
  ]);
  if (finalized.number === null || !finalized.hash || latest.number === null || !latest.hash) {
    throw new Error("Arbitrum block evidence is unavailable");
  }
  const [finalizedCode, latestCode, finalizedUsdc, latestUsdc, finalizedEth, latestEth] = await Promise.all([
    client.getCode({address, blockNumber: finalized.number}),
    client.getCode({address, blockNumber: latest.number}),
    client.readContract({address: USDC, abi: balanceAbi, functionName: "balanceOf",
      args: [address], blockNumber: finalized.number}),
    client.readContract({address: USDC, abi: balanceAbi, functionName: "balanceOf",
      args: [address], blockNumber: latest.number}),
    client.getBalance({address, blockNumber: finalized.number}),
    client.getBalance({address, blockNumber: latest.number}),
  ]);
  const finalDelegation = delegationOf(finalizedCode);
  return {schemaVersion: "wallet-execution-readiness-v1" as const, chainId: CHAIN,
    owner: address, expectedImplementation: KERNEL,
    finalized: {blockNumber: finalized.number.toString(), blockHash: finalized.hash,
      blockTimestamp: finalized.timestamp.toString(), usdcUnits: finalizedUsdc.toString(),
      ethWei: finalizedEth.toString(),
      delegation: finalDelegation},
    latest: {blockNumber: latest.number.toString(), blockHash: latest.hash,
      blockTimestamp: latest.timestamp.toString(), usdcUnits: latestUsdc.toString(),
      ethWei: latestEth.toString(),
      delegation: delegationOf(latestCode)},
    executionDelegateReady: finalDelegation.kind === "kernel"};
}
