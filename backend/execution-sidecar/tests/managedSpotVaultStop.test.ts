import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, type PublicClient } from "viem";
import { stopManagedSpotVault } from "../src/managedSpotVaultStop.js";
import { ARBITRUM_USDC, ARBITRUM_WETH,
  ARBITRUM_V3_SWAP_ROUTER } from "../src/mobile/uniswapV3.js";

const code = "0x6002";
const input = { vaultAddress: "0x000000000000000000000000000000000000fa02",
  ownerAddress: "0x56B6c8eF6E04Fa995F835f56C009f01623Af5963",
  executorAddress: "0x000000000000000000000000000000000000beef",
  codeHash: keccak256(code), programHash: "b".repeat(64),
  policyHash: "c".repeat(64), capitalUnits: "1000000",
  maxBuyUnits: "500000", expiresAt: 1_800_001_000_000 };

function client(stopped: boolean) {
  return { chain: { id: 42161 }, getBlock: async () => ({ number: 120n,
    hash: `0x${"f".repeat(64)}`, timestamp: 1_800_000_000n }),
    getCode: async () => code,
    getBalance: async () => 0n,
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      if (functionName === "balanceOf") return 0n;
      return ({ owner: input.ownerAddress, executor: input.executorAddress,
        usdc: ARBITRUM_USDC, weth: ARBITRUM_WETH,
        router: ARBITRUM_V3_SWAP_ROUTER,
        programVersionHash: `0x${input.programHash}`,
        policyHash: `0x${input.policyHash}`,
        capitalUnits: 1_000_000n, maxBuyUnits: 500_000n,
        expiresAt: 1_800_001_000n, funded: true, stopped } as Record<string, unknown>)[functionName];
    },
    call: async () => ({ data: "0x" }),
  } as unknown as PublicClient;
}

test("executor stop sends once for the exact Magic-owned vault", async () => {
  let sends = 0;
  const send = async (to: string, data: string) => {
    assert.equal(to, input.vaultAddress);
    assert.match(data, /^0x[a-f0-9]{8}$/);
    sends += 1;
    return `0x${"d".repeat(64)}` as `0x${string}`;
  };
  const sent = await stopManagedSpotVault(client(false), input,
    input.executorAddress, send);
  assert.equal(sent.status, "submitted");
  assert.equal(sends, 1);
  const final = await stopManagedSpotVault(client(true), input,
    input.executorAddress, send);
  assert.equal(final.status, "confirmed");
  assert.equal(sends, 1);
  await assert.rejects(() => stopManagedSpotVault(client(false), input,
    input.ownerAddress, send));
});
