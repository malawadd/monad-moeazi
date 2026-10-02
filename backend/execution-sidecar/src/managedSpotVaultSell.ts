import { encodeFunctionData, keccak256, parseAbiItem, toHex,
  type Address, type Hex, type PublicClient } from "viem";
import { readManagedSpotVault, readManagedVaultExecutionHead,
  type ManagedSpotVaultExpectation } from "./managedSpotVaultRead.js";

const sellAbi = [{ type: "function", name: "sell", stateMutability: "nonpayable",
  inputs: [{ name: "orderId", type: "bytes32" },
    { name: "amountIn", type: "uint256" },
    { name: "minUsdcOut", type: "uint256" },
    { name: "deadline", type: "uint256" }],
  outputs: [{ name: "amountOut", type: "uint256" }] }] as const;
const filled = parseAbiItem(
  "event OrderFilled(bytes32 indexed orderId, bool indexed isBuy, uint256 amountIn, uint256 amountOut)");
const hex32 = /^0x[a-f0-9]{64}$/;
const units = /^[1-9][0-9]*$/;

export type ManagedVaultSellInput = ManagedSpotVaultExpectation & {
  orderId: string; amountIn: string; amountOutMinimum: string; deadline: number;
};

export async function prepareManagedVaultSell(client: PublicClient,
  input: ManagedVaultSellInput) {
  if (!hex32.test(input.orderId) || !units.test(input.amountIn)
    || !units.test(input.amountOutMinimum) || !Number.isSafeInteger(input.deadline)) {
    throw new Error("Vault sell order is malformed");
  }
  const observed = await readManagedSpotVault(client, input);
  const head = await readManagedVaultExecutionHead(client, observed.finalizedBlockNumber);
  if (!observed.funded || !observed.stopped
    || BigInt(input.amountIn) !== BigInt(observed.vaultWethUnits)
    || input.deadline < Number(head.timestamp)
    || input.deadline > Number(head.timestamp) + 300) {
    throw new Error("Vault close does not consume exactly the stopped WETH exposure");
  }
  const calldata = encodeFunctionData({ abi: sellAbi, functionName: "sell",
    args: [input.orderId as Hex, BigInt(input.amountIn),
      BigInt(input.amountOutMinimum), BigInt(input.deadline)] });
  await client.call({ account: input.executorAddress as Address,
    to: input.vaultAddress as Address, data: calldata,
    blockNumber: head.number });
  const normalizedPayloadHash = keccak256(toHex(JSON.stringify({
    schemaVersion: "managed-vault-sell-v1", chainId: 42161,
    vaultAddress: input.vaultAddress.toLowerCase(),
    executorAddress: input.executorAddress.toLowerCase(),
    codeHash: input.codeHash.toLowerCase(), orderId: input.orderId,
    amountIn: input.amountIn, amountOutMinimum: input.amountOutMinimum,
    deadline: input.deadline, calldata,
  }))).slice(2);
  return { schemaVersion: "managed-vault-sell-v1" as const,
    orderId: input.orderId, vaultAddress: input.vaultAddress.toLowerCase(),
    executorAddress: input.executorAddress.toLowerCase(),
    amountIn: input.amountIn, amountOutMinimum: input.amountOutMinimum,
    deadline: input.deadline, calldata, normalizedPayloadHash,
    finalizedBlockNumber: observed.finalizedBlockNumber,
    finalizedBlockHash: observed.finalizedBlockHash,
    executionBlockNumber: head.number.toString(), executionBlockHash: head.hash };
}

export async function broadcastManagedVaultSell(client: PublicClient,
  input: ManagedVaultSellInput & { normalizedPayloadHash: string },
  executorAddress: string, send: (to: Address, data: Hex) => Promise<Hex>) {
  if (input.executorAddress.toLowerCase() !== executorAddress.toLowerCase()
    || !/^[a-f0-9]{64}$/.test(input.normalizedPayloadHash)) {
    throw new Error("Vault sell executor or financial payload differs");
  }
  const prepared = await prepareManagedVaultSell(client, input);
  if (prepared.normalizedPayloadHash !== input.normalizedPayloadHash) {
    throw new Error("Vault sell calldata differs from the durable financial attempt");
  }
  const transactionHash = await send(input.vaultAddress as Address, prepared.calldata);
  if (!hex32.test(transactionHash.toLowerCase())) {
    throw new Error("Vault sell returned no transaction identity");
  }
  return { status: "submitted" as const, orderId: input.orderId,
    transactionHash: transactionHash.toLowerCase(), retryBroadcast: false as const };
}

/** A finalized sell event, successful receipt, and later balance read are separate facts. */
export async function observeManagedVaultSell(client: PublicClient,
  input: ManagedVaultSellInput & { fromBlock: string }) {
  if (!hex32.test(input.orderId) || !/^[1-9][0-9]*$/.test(input.fromBlock)) {
    throw new Error("Vault sell observation identity is malformed");
  }
  const observed = await readManagedSpotVault(client, input);
  const finalized = BigInt(observed.finalizedBlockNumber);
  if (finalized < BigInt(input.fromBlock)) return { status: "pending" as const,
    orderId: input.orderId, finalizedBlockNumber: observed.finalizedBlockNumber };
  const logs = await client.getLogs({ address: input.vaultAddress as Address,
    event: filled, args: { orderId: input.orderId as Hex, isBuy: false },
    fromBlock: BigInt(input.fromBlock), toBlock: finalized });
  if (!logs.length) return { status: "pending" as const,
    orderId: input.orderId, finalizedBlockNumber: observed.finalizedBlockNumber };
  if (logs.length !== 1 || !logs[0].transactionHash || !logs[0].blockHash
    || !logs[0].blockNumber || logs[0].args.amountIn === undefined
    || logs[0].args.amountOut === undefined) {
    throw new Error("Vault sell has ambiguous finalized event evidence");
  }
  const log = logs[0];
  const amountIn = log.args.amountIn;
  const amountOut = log.args.amountOut;
  if (amountIn === undefined || amountOut === undefined) {
    throw new Error("Finalized vault sell amounts are absent");
  }
  const [receipt, block] = await Promise.all([
    client.getTransactionReceipt({ hash: log.transactionHash }),
    client.getBlock({ blockNumber: log.blockNumber }),
  ]);
  if (receipt.status !== "success" || receipt.to?.toLowerCase() !== input.vaultAddress.toLowerCase()
    || receipt.blockHash.toLowerCase() !== log.blockHash.toLowerCase()
    || block.hash?.toLowerCase() !== log.blockHash.toLowerCase()
    || amountIn !== BigInt(input.amountIn)
    || amountOut < BigInt(input.amountOutMinimum)) {
    throw new Error("Finalized vault sell differs from the exact close attempt");
  }
  return { status: "confirmed" as const, orderId: input.orderId,
    transactionHash: log.transactionHash.toLowerCase(),
    blockNumber: log.blockNumber.toString(), blockHash: log.blockHash.toLowerCase(),
    actualInputUnits: amountIn.toString(),
    actualOutputUnits: amountOut.toString() };
}
