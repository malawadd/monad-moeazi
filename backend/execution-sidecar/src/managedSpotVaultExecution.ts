import { parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { prepareManagedVaultBuy, type ManagedVaultBuyInput } from "./managedSpotVaultOrder.js";
import { readManagedSpotVault } from "./managedSpotVaultRead.js";

const orderFilled = parseAbiItem(
  "event OrderFilled(bytes32 indexed orderId, bool indexed isBuy, uint256 amountIn, uint256 amountOut)",
);
const hash = /^0x[a-f0-9]{64}$/;
const digest = /^[a-f0-9]{64}$/;

export async function broadcastManagedVaultBuy(client: PublicClient,
  input: ManagedVaultBuyInput & { normalizedPayloadHash: string },
  executorAddress: string, send: (to: Address, data: Hex) => Promise<Hex>) {
  if (input.executorAddress.toLowerCase() !== executorAddress.toLowerCase()
    || !digest.test(input.normalizedPayloadHash)) {
    throw new Error("Vault executor or financial payload hash differs");
  }
  const prepared = await prepareManagedVaultBuy(client, input);
  if (prepared.normalizedPayloadHash.toLowerCase() !== input.normalizedPayloadHash) {
    throw new Error("Vault buy calldata differs from the durable financial attempt");
  }
  const transactionHash = await send(input.vaultAddress as Address, prepared.calldata);
  if (!hash.test(transactionHash.toLowerCase())) {
    throw new Error("Vault executor returned no transaction identity");
  }
  return { status: "submitted" as const, transactionHash: transactionHash.toLowerCase(),
    orderId: input.orderId, normalizedPayloadHash: prepared.normalizedPayloadHash,
    finalizedPreflightBlockNumber: prepared.finalizedBlockNumber,
    retryBroadcast: false as const };
}

/** Recover a lost response from a finalized vault event, never from an RPC send result. */
export async function observeManagedVaultBuy(client: PublicClient,
  input: ManagedVaultBuyInput & { fromBlock: string }) {
  if (!hash.test(input.orderId) || !/^[1-9][0-9]*$/.test(input.fromBlock)) {
    throw new Error("Vault order observation identity is invalid");
  }
  const vault = await readManagedSpotVault(client, input);
  const fromBlock = BigInt(input.fromBlock);
  const finalizedBlock = BigInt(vault.finalizedBlockNumber);
  if (fromBlock > finalizedBlock) return { status: "pending" as const,
    orderId: input.orderId, finalizedBlockNumber: vault.finalizedBlockNumber };
  const logs = await client.getLogs({ address: input.vaultAddress as Address,
    event: orderFilled, args: { orderId: input.orderId as Hex, isBuy: true },
    fromBlock, toBlock: finalizedBlock });
  if (logs.length === 0) return { status: "pending" as const,
    orderId: input.orderId, finalizedBlockNumber: vault.finalizedBlockNumber };
  if (logs.length !== 1 || !logs[0].blockHash || !logs[0].transactionHash
    || !logs[0].blockNumber || logs[0].args.amountIn === undefined
    || logs[0].args.amountOut === undefined) {
    throw new Error("Vault order has ambiguous finalized fill evidence");
  }
  const log = logs[0];
  const amountIn = log.args.amountIn;
  const amountOut = log.args.amountOut;
  if (amountIn === undefined || amountOut === undefined) {
    throw new Error("Finalized vault fill amounts are absent");
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
    throw new Error("Finalized vault fill differs from the exact buy attempt");
  }
  return { status: "confirmed" as const, orderId: input.orderId,
    transactionHash: log.transactionHash.toLowerCase(),
    blockNumber: log.blockNumber.toString(), blockHash: log.blockHash.toLowerCase(),
    actualInputUnits: amountIn.toString(),
    actualOutputUnits: amountOut.toString() };
}
