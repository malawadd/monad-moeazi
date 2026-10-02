import { encodeFunctionData } from "viem";

const address = /^0x[a-f0-9]{40}$/;
const releaseAbi = [{ type: "function", name: "withdrawUsdc", stateMutability: "nonpayable",
  inputs: [], outputs: [{ type: "uint256" }] }] as const;

/** The Magic owner, never the restricted executor, calls the vault release. */
export function magicVaultReleaseTransaction(owner: string, vault: string) {
  const from = owner.toLowerCase();
  const to = vault.toLowerCase();
  if (!address.test(from) || !address.test(to) || from === to) {
    throw new Error("The Magic owner or managed vault address is invalid.");
  }
  return { from, to, data: encodeFunctionData({ abi: releaseAbi,
    functionName: "withdrawUsdc" }), value: "0x0" as const };
}
