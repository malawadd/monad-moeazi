import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, type PublicClient } from "viem";
import { prepareManagedVaultSell, observeManagedVaultSell } from "../src/managedSpotVaultSell.js";
import { ARBITRUM_USDC, ARBITRUM_WETH,
  ARBITRUM_V3_SWAP_ROUTER } from "../src/mobile/uniswapV3.js";

const code = "0x6002";
const blockHash = `0x${"f".repeat(64)}`;
const transactionHash = `0x${"d".repeat(64)}`;
const input = { vaultAddress: "0x000000000000000000000000000000000000fa02",
  ownerAddress: "0x56B6c8eF6E04Fa995F835f56C009f01623Af5963",
  executorAddress: "0x000000000000000000000000000000000000beef",
  codeHash: keccak256(code), programHash: "b".repeat(64),
  policyHash: "c".repeat(64), capitalUnits: "1000000",
  maxBuyUnits: "500000", expiresAt: 1_800_001_000_000,
  orderId: `0x${"a".repeat(64)}`, amountIn: "100000000000000",
  amountOutMinimum: "200000", deadline: 1_800_000_120,
  fromBlock: "100" };

function client(stopped: boolean, amountOut: bigint | null): PublicClient {
  return { chain: { id: 42161 },
    getBlock: async ({ blockNumber, blockTag }: { blockNumber?: bigint; blockTag?: string }) => ({
      number: blockNumber ?? (blockTag === "latest" ? 121n : 120n),
      hash: blockHash, timestamp: blockTag === "finalized" ? 1_799_998_000n : 1_800_000_000n }),
    getCode: async () => code,
    getBalance: async () => 1_000_000_000_000_000n,
    readContract: async ({ address, functionName, args }: {
      address: string; functionName: string; args?: string[] }) => {
      if (functionName === "balanceOf") return address.toLowerCase() === ARBITRUM_WETH.toLowerCase()
        && args?.[0]?.toLowerCase() === input.vaultAddress ? 100_000_000_000_000n : 0n;
      return ({ owner: input.ownerAddress, executor: input.executorAddress,
        usdc: ARBITRUM_USDC, weth: ARBITRUM_WETH, router: ARBITRUM_V3_SWAP_ROUTER,
        programVersionHash: `0x${input.programHash}`,
        policyHash: `0x${input.policyHash}`, capitalUnits: 1_000_000n,
        maxBuyUnits: 500_000n, expiresAt: 1_800_001_000n,
        funded: true, stopped } as Record<string, unknown>)[functionName];
    },
    call: async ({ blockNumber }: { blockNumber: bigint }) => {
      assert.equal(blockNumber, 121n);
      return { data: "0x" };
    },
    getLogs: async () => amountOut === null ? [] : [{ transactionHash,
      blockHash, blockNumber: 110n, args: { orderId: input.orderId,
        isBuy: false, amountIn: 100_000_000_000_000n, amountOut } }],
    getTransactionReceipt: async () => ({ status: "success",
      to: input.vaultAddress, blockHash }),
  } as unknown as PublicClient;
}

test("stopped Magic vault sell preflights exactly its WETH balance", async () => {
  const prepared = await prepareManagedVaultSell(client(true, null), input);
  assert.match(prepared.normalizedPayloadHash, /^[a-f0-9]{64}$/);
  await assert.rejects(() => prepareManagedVaultSell(client(false, null), input));
  await assert.rejects(() => prepareManagedVaultSell(client(true, null),
    { ...input, amountIn: "1" }));
});

test("only a finalized exact sell event proves output", async () => {
  assert.equal((await observeManagedVaultSell(client(true, null), input)).status, "pending");
  const result = await observeManagedVaultSell(client(true, 250_000n), input);
  assert.equal(result.status, "confirmed");
  if (result.status === "confirmed") assert.equal(result.actualOutputUnits, "250000");
  await assert.rejects(() => observeManagedVaultSell(client(true, 1n), input));
});
