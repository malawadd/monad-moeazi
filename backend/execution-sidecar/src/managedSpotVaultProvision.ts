import { keccak256, type Address, type Hex, type PublicClient } from "viem";
import { ARBITRUM_USDC, ARBITRUM_V3_SWAP_ROUTER, ARBITRUM_WETH } from "./mobile/uniswapV3.js";
import { readManagedSpotVault } from "./managedSpotVaultRead.js";

const addr = /^0x[a-fA-F0-9]{40}$/;
const hash = /^[0-9a-f]{64}$/;
const units = /^[1-9][0-9]*$/;

export const factoryAbi = [
  { type: "function", name: "deployer", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "usdc", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "weth", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "router", stateMutability: "view",
    inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "vaultByMandate", stateMutability: "view",
    inputs: [{ type: "bytes32", name: "mandateHash" }], outputs: [{ type: "address" }] },
  { type: "function", name: "deploy", stateMutability: "nonpayable",
    inputs: [{ type: "bytes32", name: "mandateHash" },
      { type: "address", name: "owner" }, { type: "address", name: "executor" },
      { type: "bytes32", name: "programVersionHash" },
      { type: "bytes32", name: "policyHash" },
      { type: "uint256", name: "capitalUnits" },
      { type: "uint256", name: "maxBuyUnits" },
      { type: "uint64", name: "expiresAt" }], outputs: [{ type: "address" }] },
] as const;

export type VaultProvisionMandate = {
  mandateId: string; mandateHash: string; ownerAddress: string;
  programHash: string; policyHash: string; capitalUnits: string;
  maxBuyUnits: string; expiresAt: number;
};

export function vaultDeploymentArgs(input: VaultProvisionMandate, executorAddress: string) {
  if (!input.mandateId || !hash.test(input.mandateHash)
    || !hash.test(input.programHash) || !hash.test(input.policyHash)
    || !addr.test(input.ownerAddress) || !addr.test(executorAddress)
    || input.ownerAddress.toLowerCase() === executorAddress.toLowerCase()
    || !units.test(input.capitalUnits) || !units.test(input.maxBuyUnits)
    || BigInt(input.maxBuyUnits) > BigInt(input.capitalUnits)
    || !Number.isSafeInteger(input.expiresAt) || input.expiresAt % 1000 !== 0
    || input.expiresAt <= Date.now() + 5 * 60_000) {
    throw new Error("Exact Magic mandate is unavailable for vault deployment");
  }
  return [`0x${input.mandateHash}` as Hex, input.ownerAddress as Address,
    executorAddress as Address, `0x${input.programHash}` as Hex,
    `0x${input.policyHash}` as Hex, BigInt(input.capitalUnits),
    BigInt(input.maxBuyUnits), BigInt(input.expiresAt / 1000)] as const;
}

export async function readVaultProvision(client: PublicClient, input: VaultProvisionMandate,
  config: { factoryAddress: string; factoryCodeHash: string; executorAddress: string }) {
  if (!addr.test(config.executorAddress)) {
    throw new Error("The restricted vault executor address is not configured");
  }
  const args = vaultDeploymentArgs(input, config.executorAddress);
  if (client.chain?.id !== 42161 || !addr.test(config.factoryAddress)
    || !/^0x[0-9a-f]{64}$/.test(config.factoryCodeHash)) {
    throw new Error("Managed vault factory configuration is invalid");
  }
  const block = await client.getBlock({ blockTag: "finalized" });
  if (block.number === null || !block.hash) throw new Error("Finalized Arbitrum block is unavailable");
  const factory = config.factoryAddress as Address;
  const code = await client.getCode({ address: factory, blockNumber: block.number });
  if (!code || code === "0x" || keccak256(code).toLowerCase() !== config.factoryCodeHash) {
    throw new Error("Managed vault factory code differs from the configured artifact");
  }
  const read = (functionName: "deployer" | "usdc" | "weth" | "router") =>
    client.readContract({ address: factory, abi: factoryAbi, functionName,
      blockNumber: block.number });
  const [deployer, usdc, weth, router, vaultAddress] = await Promise.all([
    read("deployer"), read("usdc"), read("weth"), read("router"),
    client.readContract({ address: factory, abi: factoryAbi,
      functionName: "vaultByMandate", args: [args[0]], blockNumber: block.number }),
  ]);
  if (String(deployer).toLowerCase() !== config.executorAddress.toLowerCase()
    || String(usdc).toLowerCase() !== ARBITRUM_USDC.toLowerCase()
    || String(weth).toLowerCase() !== ARBITRUM_WETH.toLowerCase()
    || String(router).toLowerCase() !== ARBITRUM_V3_SWAP_ROUTER.toLowerCase()) {
    throw new Error("Factory deployer or fixed Arbitrum route differs");
  }
  if (String(vaultAddress).toLowerCase() === "0x0000000000000000000000000000000000000000") {
    return { status: "awaiting_deployment" as const, mandateId: input.mandateId,
      executorAddress: config.executorAddress.toLowerCase(),
      finalizedBlockNumber: block.number.toString() };
  }
  const vaultCode = await client.getCode({ address: vaultAddress, blockNumber: block.number });
  if (!vaultCode || vaultCode === "0x") throw new Error("Factory vault has no finalized code");
  const vaultCodeHash = keccak256(vaultCode);
  const verified = await readManagedSpotVault(client, {
    vaultAddress, ownerAddress: input.ownerAddress,
    executorAddress: config.executorAddress,
    programHash: input.programHash, policyHash: input.policyHash,
    capitalUnits: input.capitalUnits, maxBuyUnits: input.maxBuyUnits,
    expiresAt: input.expiresAt, codeHash: vaultCodeHash,
  });
  if (verified.funded || verified.stopped) {
    throw new Error("New mandate vault is already funded or stopped");
  }
  return { status: "vault_ready" as const, mandateId: input.mandateId,
    vaultAddress: vaultAddress.toLowerCase(), vaultCodeHash,
    executorAddress: config.executorAddress.toLowerCase(),
    finalizedBlockNumber: verified.finalizedBlockNumber,
    finalizedBlockHash: verified.finalizedBlockHash };
}
