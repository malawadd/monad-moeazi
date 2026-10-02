import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { readManagedSpotVault, type ManagedSpotVaultExpectation } from "./managedSpotVaultRead.js";

const stopAbi = [{ type: "function", name: "stop", stateMutability: "nonpayable",
  inputs: [], outputs: [] }] as const;
const transactionHash = /^0x[a-f0-9]{64}$/;

/** A claimed stop may be sent once; retries inspect the finalized vault state. */
export async function stopManagedSpotVault(client: PublicClient,
  expected: ManagedSpotVaultExpectation, executorAddress: string,
  send: (to: Address, data: Hex) => Promise<Hex>) {
  if (expected.executorAddress.toLowerCase() !== executorAddress.toLowerCase()) {
    throw new Error("Stop signer differs from this Magic-owned vault executor");
  }
  const observed = await readManagedSpotVault(client, expected);
  if (observed.stopped) return { status: "confirmed" as const,
    vaultAddress: observed.vaultAddress, finalizedBlockNumber: observed.finalizedBlockNumber,
    finalizedBlockHash: observed.finalizedBlockHash, transactionHash: null };
  const data = encodeFunctionData({ abi: stopAbi, functionName: "stop" });
  await client.call({ account: executorAddress as Address,
    to: expected.vaultAddress as Address, data,
    blockNumber: BigInt(observed.finalizedBlockNumber) });
  const sent = await send(expected.vaultAddress as Address, data);
  if (!transactionHash.test(sent.toLowerCase())) {
    throw new Error("Vault stop returned no transaction identity");
  }
  return { status: "submitted" as const,
    vaultAddress: observed.vaultAddress, transactionHash: sent.toLowerCase(),
    finalizedBlockNumber: observed.finalizedBlockNumber,
    finalizedBlockHash: observed.finalizedBlockHash };
}
