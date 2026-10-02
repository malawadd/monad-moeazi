import { type Address, type PublicClient, keccak256 } from "viem";
import { ARBITRUM_USDC, ARBITRUM_V3_SWAP_ROUTER, ARBITRUM_WETH,
  allowanceAbi } from "./mobile/uniswapV3.js";

const address = /^0x[a-fA-F0-9]{40}$/;
const vaultAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "executor", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "usdc", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "weth", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "router", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "programVersionHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "policyHash", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "capitalUnits", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxBuyUnits", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "expiresAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "funded", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "stopped", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

export type ManagedSpotVaultExpectation = {
  vaultAddress: string; ownerAddress: string; executorAddress: string;
  programHash: string; policyHash: string;
  capitalUnits: string; maxBuyUnits: string; expiresAt: number; codeHash: string;
};

/** Finalized balances can lag the chain head; order deadlines must use the execution head. */
export async function readManagedVaultExecutionHead(client: PublicClient,
  finalizedBlockNumber: string) {
  const head = await client.getBlock({ blockTag: "latest" });
  if (head.number === null || !head.hash || !head.timestamp
    || head.number < BigInt(finalizedBlockNumber)) {
    throw new Error("Current Arbitrum execution block is unavailable");
  }
  return head;
}

export async function readManagedSpotVault(client: PublicClient, expected: ManagedSpotVaultExpectation) {
  if (client.chain?.id !== 42161 || !address.test(expected.vaultAddress)
    || !address.test(expected.ownerAddress) || !address.test(expected.executorAddress)
    || !/^0x[a-f0-9]{64}$/.test(expected.codeHash)
    || !/^[0-9a-f]{64}$/.test(expected.programHash)
    || !/^[0-9a-f]{64}$/.test(expected.policyHash)
    || !/^[1-9][0-9]*$/.test(expected.capitalUnits)
    || !/^[1-9][0-9]*$/.test(expected.maxBuyUnits)
    || !Number.isSafeInteger(expected.expiresAt)) throw new Error("Vault expectation is invalid");
  const block = await client.getBlock({ blockTag: "finalized" });
  if (block.number === null || !block.hash) throw new Error("Finalized Arbitrum block is unavailable");
  const vault = expected.vaultAddress as Address;
  const code = await client.getCode({ address: vault, blockNumber: block.number });
  if (!code || code === "0x" || keccak256(code).toLowerCase() !== expected.codeHash) {
    throw new Error("Vault bytecode is absent or differs from registered code");
  }
  const read = (functionName: typeof vaultAbi[number]["name"]) =>
    client.readContract({ address: vault, abi: vaultAbi, functionName, blockNumber: block.number });
  const [owner, executor, usdc, weth, router, programHash, policyHash,
    capitalUnits, maxBuyUnits, expiresAt, funded, stopped,
    vaultUsdc, vaultWeth, ownerUsdc, ownerEth] = await Promise.all([
    read("owner"), read("executor"), read("usdc"), read("weth"), read("router"),
    read("programVersionHash"), read("policyHash"), read("capitalUnits"),
    read("maxBuyUnits"), read("expiresAt"), read("funded"), read("stopped"),
    client.readContract({ address: ARBITRUM_USDC, abi: allowanceAbi,
      functionName: "balanceOf", args: [vault], blockNumber: block.number }),
    client.readContract({ address: ARBITRUM_WETH, abi: allowanceAbi,
      functionName: "balanceOf", args: [vault], blockNumber: block.number }),
    client.readContract({ address: ARBITRUM_USDC, abi: allowanceAbi,
      functionName: "balanceOf", args: [expected.ownerAddress as Address], blockNumber: block.number }),
    client.getBalance({ address: expected.ownerAddress as Address, blockNumber: block.number }),
  ]);
  if (String(owner).toLowerCase() !== expected.ownerAddress.toLowerCase()
    || String(executor).toLowerCase() !== expected.executorAddress.toLowerCase()
    || String(usdc).toLowerCase() !== ARBITRUM_USDC.toLowerCase()
    || String(weth).toLowerCase() !== ARBITRUM_WETH.toLowerCase()
    || String(router).toLowerCase() !== ARBITRUM_V3_SWAP_ROUTER.toLowerCase()
    || String(programHash).toLowerCase() !== `0x${expected.programHash}`
    || String(policyHash).toLowerCase() !== `0x${expected.policyHash}`
    || BigInt(String(capitalUnits)) !== BigInt(expected.capitalUnits)
    || BigInt(String(maxBuyUnits)) !== BigInt(expected.maxBuyUnits)
    || Number(expiresAt) * 1000 !== expected.expiresAt) {
    throw new Error("Vault owner, program, policy or capital terms differ from the signed mandate");
  }
  return { schemaVersion: "managed-spot-vault-read-v1" as const,
    chainId: 42161 as const, vaultAddress: vault, ownerAddress: String(owner),
    executorAddress: String(executor), programHash: String(programHash), policyHash: String(policyHash),
    capitalUnits: String(capitalUnits), maxBuyUnits: String(maxBuyUnits),
    expiresAt: Number(expiresAt) * 1000, funded: Boolean(funded), stopped: Boolean(stopped),
    vaultUsdcUnits: String(vaultUsdc), vaultWethUnits: String(vaultWeth),
    ownerUsdcUnits: String(ownerUsdc), ownerEthWei: String(ownerEth),
    finalizedBlockNumber: block.number.toString(), finalizedBlockHash: block.hash,
    finalizedBlockTimestamp: block.timestamp.toString(),
    codeHash: keccak256(code) };
}
