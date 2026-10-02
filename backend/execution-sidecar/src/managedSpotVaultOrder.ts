import { encodeFunctionData, keccak256, toHex, type Address, type Hex,
  type PublicClient } from "viem";
import { readManagedSpotVault, readManagedVaultExecutionHead,
  type ManagedSpotVaultExpectation } from "./managedSpotVaultRead.js";

const hex32 = /^0x[a-f0-9]{64}$/;
const units = /^[1-9][0-9]*$/;
const buyAbi = [{ type: "function", name: "buy", stateMutability: "nonpayable",
  inputs: [{ name: "orderId", type: "bytes32" }, { name: "amountIn", type: "uint256" },
    { name: "minWethOut", type: "uint256" }, { name: "deadline", type: "uint256" }],
  outputs: [{ name: "amountOut", type: "uint256" }] }] as const;

export type ManagedVaultBuyInput = ManagedSpotVaultExpectation & {
  orderId: string; amountIn: string; amountOutMinimum: string; deadline: number;
};

export function buildManagedVaultBuyPayload(input: ManagedVaultBuyInput, observed: {
  funded: boolean; stopped: boolean; vaultUsdcUnits: string;
  executionBlockTimestamp: string; codeHash: string; executorAddress: string;
}) {
  if (!hex32.test(input.orderId) || !units.test(input.amountIn)
    || !units.test(input.amountOutMinimum) || !units.test(input.maxBuyUnits)
    || !units.test(observed.vaultUsdcUnits)
    || !observed.funded || observed.stopped
    || observed.codeHash.toLowerCase() !== input.codeHash.toLowerCase()
    || observed.executorAddress.toLowerCase() !== input.executorAddress.toLowerCase()
    || BigInt(input.amountIn) > BigInt(input.maxBuyUnits)
    || BigInt(input.amountIn) > BigInt(observed.vaultUsdcUnits)
    || !Number.isSafeInteger(input.deadline)
    || input.deadline < Number(observed.executionBlockTimestamp)
    || input.deadline > Number(observed.executionBlockTimestamp) + 300
    || input.deadline * 1000 >= input.expiresAt) {
    throw new Error("Managed vault buy differs from funded capital, expiry or executor");
  }
  const calldata = encodeFunctionData({ abi: buyAbi, functionName: "buy",
    args: [input.orderId as Hex, BigInt(input.amountIn),
      BigInt(input.amountOutMinimum), BigInt(input.deadline)] });
  const normalizedPayloadHash = keccak256(toHex(JSON.stringify({
    schemaVersion: "managed-vault-buy-v1", chainId: 42161,
    vaultAddress: input.vaultAddress.toLowerCase(),
    ownerAddress: input.ownerAddress.toLowerCase(),
    executorAddress: input.executorAddress.toLowerCase(),
    codeHash: input.codeHash.toLowerCase(), orderId: input.orderId,
    amountIn: input.amountIn, amountOutMinimum: input.amountOutMinimum,
    deadline: input.deadline, calldata,
  }))).slice(2);
  return { schemaVersion: "managed-vault-buy-v1" as const,
    vaultAddress: input.vaultAddress.toLowerCase(),
    executorAddress: input.executorAddress.toLowerCase(),
    orderId: input.orderId, amountIn: input.amountIn,
    amountOutMinimum: input.amountOutMinimum, deadline: input.deadline,
    calldata, normalizedPayloadHash };
}

/** Exact preflight; it creates no signer or network submission authority. */
export async function prepareManagedVaultBuy(client: PublicClient, input: ManagedVaultBuyInput) {
  const observed = await readManagedSpotVault(client, input);
  const head = await readManagedVaultExecutionHead(client, observed.finalizedBlockNumber);
  const prepared = buildManagedVaultBuyPayload(input, { ...observed,
    executionBlockTimestamp: head.timestamp.toString() });
  await client.call({ account: input.executorAddress as Address,
    to: input.vaultAddress as Address, data: prepared.calldata,
    blockNumber: head.number });
  return { ...prepared, finalizedBlockNumber: observed.finalizedBlockNumber,
    finalizedBlockHash: observed.finalizedBlockHash,
    executionBlockNumber: head.number.toString(), executionBlockHash: head.hash };
}
