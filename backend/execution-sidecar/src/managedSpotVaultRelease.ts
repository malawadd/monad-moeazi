import { decodeEventLog, encodeFunctionData, parseAbiItem, type Address, type Hex,
  type PublicClient } from "viem";
import { ARBITRUM_USDC } from "./mobile/uniswapV3.js";
import { readManagedSpotVault, type ManagedSpotVaultExpectation } from "./managedSpotVaultRead.js";

const withdrawn = parseAbiItem("event Withdrawn(address indexed owner, address indexed asset, uint256 amount)");
const transferred = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const releaseAbi = [{ type: "function", name: "withdrawUsdc", stateMutability: "nonpayable",
  inputs: [], outputs: [{ type: "uint256" }] }] as const;
const releaseData = encodeFunctionData({ abi: releaseAbi, functionName: "withdrawUsdc" });

export type ManagedVaultReleaseInput = ManagedSpotVaultExpectation & { fromBlock: string };

/** Finalized owner-only vault event plus canonical USDC transfer, not an empty-balance guess. */
export async function observeManagedVaultRelease(client: PublicClient,
  input: ManagedVaultReleaseInput) {
  if (!/^[1-9][0-9]*$/.test(input.fromBlock)) throw new Error("Vault stop block is missing");
  const vault = await readManagedSpotVault(client, input);
  if (!vault.funded || !vault.stopped || BigInt(vault.vaultWethUnits) !== 0n) {
    throw new Error("Magic vault is not stopped and flat");
  }
  const finalized = BigInt(vault.finalizedBlockNumber);
  const start = BigInt(input.fromBlock);
  if (finalized < start || BigInt(vault.vaultUsdcUnits) !== 0n) {
    return { status: "pending" as const, finalizedBlockNumber: vault.finalizedBlockNumber };
  }
  const matches: Array<{ amount: bigint; transactionHash: Hex;
    blockHash: Hex; blockNumber: bigint }> = [];
  for (let from = start; from <= finalized; from += 5_000n) {
    const to = from + 4_999n < finalized ? from + 4_999n : finalized;
    const logs = await client.getLogs({ address: input.vaultAddress as Address,
      event: withdrawn, args: { owner: input.ownerAddress as Address, asset: ARBITRUM_USDC },
      fromBlock: from, toBlock: to });
    for (const log of logs) {
      const event = decodeEventLog({ abi: [withdrawn], data: log.data, topics: log.topics });
      if (event.eventName !== "Withdrawn" || event.args.amount <= 0n) continue;
      if (!log.transactionHash || !log.blockHash || !log.blockNumber) {
        throw new Error("Vault release event is incomplete");
      }
      matches.push({ amount: event.args.amount, transactionHash: log.transactionHash,
        blockHash: log.blockHash, blockNumber: log.blockNumber });
    }
    if (matches.length > 1) throw new Error("Vault has multiple positive release events");
  }
  if (matches.length !== 1) throw new Error("Empty vault has no finalized owner release event");
  const log = matches[0];
  const [transaction, receipt, block] = await Promise.all([
    client.getTransaction({ hash: log.transactionHash }),
    client.getTransactionReceipt({ hash: log.transactionHash }),
    client.getBlock({ blockNumber: log.blockNumber }),
  ]);
  if (transaction.from.toLowerCase() !== input.ownerAddress.toLowerCase()
    || transaction.to?.toLowerCase() !== input.vaultAddress.toLowerCase()
    || transaction.input.toLowerCase() !== releaseData.toLowerCase()
    || transaction.value !== 0n || receipt.status !== "success"
    || receipt.blockHash.toLowerCase() !== log.blockHash.toLowerCase()
    || block.hash?.toLowerCase() !== log.blockHash.toLowerCase()) {
    throw new Error("Finalized Magic release transaction differs from owner-only call");
  }
  const matchingTransfer = receipt.logs.some((entry) => {
    if (entry.address.toLowerCase() !== ARBITRUM_USDC.toLowerCase()) return false;
    try {
      const event = decodeEventLog({ abi: [transferred], data: entry.data,
        topics: entry.topics });
      return event.eventName === "Transfer"
        && event.args.from.toLowerCase() === input.vaultAddress.toLowerCase()
        && event.args.to.toLowerCase() === input.ownerAddress.toLowerCase()
        && event.args.value === log.amount;
    } catch { return false; }
  });
  if (!matchingTransfer) throw new Error("Canonical USDC did not transfer from vault to Magic owner");
  return { status: "confirmed" as const, ownerAddress: input.ownerAddress.toLowerCase(),
    vaultAddress: input.vaultAddress.toLowerCase(), amountUnits: log.amount.toString(),
    transactionHash: log.transactionHash.toLowerCase(), blockNumber: log.blockNumber.toString(),
    blockHash: log.blockHash.toLowerCase(), finalizedBlockNumber: vault.finalizedBlockNumber,
    finalizedBlockHash: vault.finalizedBlockHash };
}
