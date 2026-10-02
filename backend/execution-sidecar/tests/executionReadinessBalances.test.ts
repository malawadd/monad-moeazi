import assert from "node:assert/strict";
import { test } from "node:test";
import { readExecutionReadiness } from "../src/mobile/executionReadiness.js";

const owner = "0x1111111111111111111111111111111111111111";

test("Magic readiness reports ETH and USDC from the same finalized Arbitrum block", async () => {
  const reads: Array<{ asset: string; block: bigint; owner: string }> = [];
  const client = {
    getChainId: async () => 42161,
    getBlock: async ({ blockTag }: { blockTag: "latest" | "finalized" }) => ({
      number: blockTag === "finalized" ? 100n : 101n,
      hash: `0x${(blockTag === "finalized" ? "a" : "b").repeat(64)}` as `0x${string}`,
      timestamp: 1_790_000_000n,
    }),
    getCode: async () => "0x" as const,
    readContract: async ({ args, blockNumber }: { args: readonly [string]; blockNumber: bigint }) => {
      reads.push({ asset: "USDC", block: blockNumber, owner: args[0] });
      return blockNumber === 100n ? 1_095_927n : 1_095_000n;
    },
    getBalance: async ({ address, blockNumber }: { address: string; blockNumber: bigint }) => {
      reads.push({ asset: "ETH", block: blockNumber, owner: address });
      return blockNumber === 100n ? 244_000_000_000_000n : 240_000_000_000_000n;
    },
  };
  const result = await readExecutionReadiness(client, owner);
  assert.equal(result.finalized.usdcUnits, "1095927");
  assert.equal(result.finalized.ethWei, "244000000000000");
  assert.equal(result.latest.ethWei, "240000000000000");
  assert.deepEqual(reads.filter((item) => item.block === 100n).map((item) => item.asset).sort(),
    ["ETH", "USDC"]);
  assert.ok(reads.every((item) => item.owner === owner));
});
