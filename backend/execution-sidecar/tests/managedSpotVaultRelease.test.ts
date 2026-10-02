import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData,
  keccak256, parseAbiItem, type PublicClient } from "viem";
import { observeManagedVaultRelease } from "../src/managedSpotVaultRelease.js";
import { ARBITRUM_USDC, ARBITRUM_WETH,
  ARBITRUM_V3_SWAP_ROUTER } from "../src/mobile/uniswapV3.js";

const withdrawn = parseAbiItem("event Withdrawn(address indexed owner, address indexed asset, uint256 amount)");
const transferred = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const code = "0x6002";
const blockHash = `0x${"f".repeat(64)}`;
const transactionHash = `0x${"d".repeat(64)}`;
const input = { vaultAddress: "0x000000000000000000000000000000000000fa02",
  ownerAddress: "0x56b6c8ef6e04fa995f835f56c009f01623af5963",
  executorAddress: "0x000000000000000000000000000000000000beef",
  codeHash: keccak256(code), programHash: "b".repeat(64), policyHash: "c".repeat(64),
  capitalUnits: "1000000", maxBuyUnits: "500000", expiresAt: 1_800_001_000_000,
  fromBlock: "100" };
const amount = 1_095_927n;
const calldata = encodeFunctionData({ abi: [{ type: "function", name: "withdrawUsdc",
  stateMutability: "nonpayable", inputs: [], outputs: [{ type: "uint256" }] }],
  functionName: "withdrawUsdc" });

function client(withTransfer: boolean, sender = input.ownerAddress): PublicClient {
  const releaseLog = { transactionHash, blockHash, blockNumber: 110n,
    topics: encodeEventTopics({ abi: [withdrawn], eventName: "Withdrawn",
      args: { owner: input.ownerAddress as `0x${string}`, asset: ARBITRUM_USDC } }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]) };
  const transferLog = { address: ARBITRUM_USDC,
    topics: encodeEventTopics({ abi: [transferred], eventName: "Transfer",
      args: { from: input.vaultAddress as `0x${string}`,
        to: input.ownerAddress as `0x${string}` } }),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]) };
  return { chain: { id: 42161 },
    getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => ({
      number: blockNumber ?? 120n, hash: blockHash, timestamp: 1_800_000_000n }),
    getCode: async () => code,
    getBalance: async () => 0n,
    readContract: async ({ address, functionName, args }: {
      address: string; functionName: string; args?: string[] }) => {
      if (functionName === "balanceOf") return address.toLowerCase() === ARBITRUM_USDC.toLowerCase()
        && args?.[0]?.toLowerCase() === input.ownerAddress ? amount : 0n;
      return ({ owner: input.ownerAddress, executor: input.executorAddress,
        usdc: ARBITRUM_USDC, weth: ARBITRUM_WETH, router: ARBITRUM_V3_SWAP_ROUTER,
        programVersionHash: `0x${input.programHash}`, policyHash: `0x${input.policyHash}`,
        capitalUnits: 1_000_000n, maxBuyUnits: 500_000n,
        expiresAt: 1_800_001_000n, funded: true, stopped: true } as Record<string, unknown>)[functionName];
    },
    getLogs: async () => [releaseLog],
    getTransaction: async () => ({ from: sender, to: input.vaultAddress,
      input: calldata, value: 0n }),
    getTransactionReceipt: async () => ({ status: "success", blockHash,
      logs: withTransfer ? [transferLog] : [] }),
  } as unknown as PublicClient;
}

test("only Magic's finalized owner call and canonical USDC transfer prove return", async () => {
  const proof = await observeManagedVaultRelease(client(true), input);
  assert.equal(proof.status, "confirmed");
  if (proof.status === "confirmed") assert.equal(proof.amountUnits, amount.toString());
  await assert.rejects(() => observeManagedVaultRelease(client(false), input));
  await assert.rejects(() => observeManagedVaultRelease(client(true, input.vaultAddress), input));
});
