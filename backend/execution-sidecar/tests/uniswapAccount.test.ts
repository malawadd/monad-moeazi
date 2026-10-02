import assert from "node:assert/strict";
import { test } from "node:test";
import { readUniswapAccount } from "../src/uniswapAccount.js";
import { KERNEL } from "../src/mobile/contracts.js";
import { ARBITRUM_USDC, ARBITRUM_WETH } from "../src/uniswapSettlement.js";

const owner = "0x1234567890123456789012345678901234567890";

test("native account read uses one finalized Arbitrum block for both assets and delegation", async () => {
  const reads: Array<{ address: string; blockNumber: bigint }> = [];
  const client = {
    getChainId: async () => 42161,
    getBlock: async ({ blockTag }: { blockTag: string }) => {
      assert.equal(blockTag, "finalized");
      return { number: 123n, hash: `0x${"a".repeat(64)}` as `0x${string}`, timestamp: 456n };
    },
    getCode: async ({ address, blockNumber }: { address: string; blockNumber: bigint }) => {
      reads.push({ address, blockNumber });
      return `0xef0100${KERNEL.slice(2)}` as `0x${string}`;
    },
    readContract: async ({ address, blockNumber }: { address: string; blockNumber: bigint }) => {
      reads.push({ address, blockNumber });
      return address.toLowerCase() === ARBITRUM_USDC.toLowerCase() ? 15_000_000n
        : address.toLowerCase() === ARBITRUM_WETH.toLowerCase() ? 2_000_000_000_000_000n : 0n;
    },
  };
  const result = await readUniswapAccount(client as any, owner);
  assert.equal(result.accountMode, "kernel-7702");
  assert.deepEqual(result.balances, { USDC: "15000000", WETH: "2000000000000000" });
  assert.equal(result.balancesComplete, false);
  assert.equal(result.positionsComplete, false);
  assert.deepEqual(reads.map(row => row.blockNumber), [123n, 123n, 123n]);
});

test("native account read rejects a different chain before balance I/O", async () => {
  await assert.rejects(readUniswapAccount({ getChainId: async () => 1 } as any, owner),
    /Arbitrum One/);
});
