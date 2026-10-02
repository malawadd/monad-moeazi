import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, type PublicClient } from "viem";
import { ARBITRUM_USDC, ARBITRUM_V3_SWAP_ROUTER,
  ARBITRUM_WETH } from "../src/mobile/uniswapV3.js";
import { observeManagedVaultBuy } from "../src/managedSpotVaultExecution.js";
import { prepareManagedVaultBuy } from "../src/managedSpotVaultOrder.js";

const vaultAddress = "0x000000000000000000000000000000000000fA02";
const ownerAddress = "0x56B6c8eF6E04Fa995F835f56C009f01623Af5963";
const executorAddress = "0x000000000000000000000000000000000000beef";
const blockHash = `0x${"d".repeat(64)}`;
const transactionHash = `0x${"e".repeat(64)}`;
const orderId = `0x${"a".repeat(64)}`;
const code = "0x6002";
const input = { vaultAddress, ownerAddress, executorAddress,
  programHash: "b".repeat(64), policyHash: "c".repeat(64),
  capitalUnits: "1000000", maxBuyUnits: "500000",
  expiresAt: (Math.floor(Date.now() / 1000) + 86_400) * 1000,
  codeHash: keccak256(code), orderId, amountIn: "400000",
  amountOutMinimum: "100000000000000", deadline: Math.floor(Date.now() / 1000) + 60,
  fromBlock: "100" };

function clientWithLogs(outputUnits: bigint | null) {
  return { chain: { id: 42161 },
    getBlock: async ({ blockNumber, blockTag }: { blockNumber?: bigint; blockTag?: string }) => ({
      number: blockNumber ?? (blockTag === "latest" ? 121n : 120n),
      hash: blockNumber ? blockHash : `0x${"f".repeat(64)}`,
      timestamp: BigInt(Math.floor(Date.now() / 1000) - (blockTag === "finalized" ? 1200 : 0)) }),
    getCode: async () => code,
    getBalance: async () => 1_000_000_000_000_000n,
    readContract: async ({ address, functionName, args }: {
      address: string; functionName: string; args?: string[] }) => {
      if (functionName === "balanceOf") return address.toLowerCase() === ARBITRUM_USDC.toLowerCase()
        && args?.[0]?.toLowerCase() === vaultAddress.toLowerCase() ? 600_000n : 0n;
      return ({ owner: ownerAddress, executor: executorAddress,
        usdc: ARBITRUM_USDC, weth: ARBITRUM_WETH,
        router: ARBITRUM_V3_SWAP_ROUTER,
        programVersionHash: `0x${input.programHash}`,
        policyHash: `0x${input.policyHash}`,
        capitalUnits: 1_000_000n, maxBuyUnits: 500_000n,
        expiresAt: BigInt(input.expiresAt / 1000),
        funded: true, stopped: false } as Record<string, unknown>)[functionName];
    },
    getLogs: async () => outputUnits === null ? [] : [{ blockHash,
      blockNumber: 110n, transactionHash,
      args: { orderId, isBuy: true, amountIn: 400_000n, amountOut: outputUnits } }],
    getTransactionReceipt: async () => ({ status: "success", to: vaultAddress,
      blockHash }),
    call: async ({ blockNumber }: { blockNumber: bigint }) => {
      assert.equal(blockNumber, 121n);
      return { data: "0x" };
    },
  } as unknown as PublicClient;
}

test("vault buy preflights a current deadline despite delayed finalized balances", async () => {
  const prepared = await prepareManagedVaultBuy(clientWithLogs(null), input);
  assert.equal(prepared.finalizedBlockNumber, "120");
  assert.equal(prepared.executionBlockNumber, "121");
});

test("absence of a finalized fill stays pending", async () => {
  const result = await observeManagedVaultBuy(clientWithLogs(null), input);
  assert.equal(result.status, "pending");
});

test("actual vault event and successful receipt establish only the observed fill", async () => {
  const result = await observeManagedVaultBuy(clientWithLogs(150_000_000_000_000n), input);
  assert.equal(result.status, "confirmed");
  if (result.status === "confirmed") {
    assert.equal(result.actualInputUnits, "400000");
    assert.equal(result.actualOutputUnits, "150000000000000");
    assert.equal(result.transactionHash, transactionHash);
  }
  await assert.rejects(() => observeManagedVaultBuy(clientWithLogs(1n), input));
});
