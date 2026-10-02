import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeEventTopics, keccak256, toHex, TransactionNotFoundError, type Address, type Hex } from "viem";
import { ARBITRUM_USDC, ARBITRUM_WETH, reconcileUniswapSwap } from "../src/uniswapSettlement.js";

const sender = "0x1111111111111111111111111111111111111111" as Address;
const router = "0x2222222222222222222222222222222222222222" as Address;
const hash = `0x${"a".repeat(64)}` as Hex;
const input = "0x1234" as Hex;
const request = { transactionHash: hash, sender, target: router, calldataHash: keccak256(input) };
const transfer = [{ type: "event", name: "Transfer", inputs: [
  { name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true },
  { name: "value", type: "uint256", indexed: false },
] }] as const;

function log(address: Address, from: Address, to: Address, value: bigint, logIndex: number) {
  const topics = encodeEventTopics({ abi: transfer, eventName: "Transfer", args: { from, to } }) as Hex[];
  return { address, topics,
    data: toHex(value, { size: 32 }), logIndex };
}

function chain(status: "success" | "reverted" = "success") {
  return { getChainId: async () => 42161, getTransaction: async () => ({ from: sender, to: router, input }),
    getTransactionReceipt: async () => ({ status, blockNumber: 10n, logs: [
      log(ARBITRUM_USDC, sender, router, 1_000_000n, 0),
      log(ARBITRUM_WETH, router, sender, 500_000_000_000_000n, 1),
    ] }), getBlockNumber: async () => 11n };
}

test("reports only observed Arbitrum token movement after receipt confirmation", async () => {
  const result = await reconcileUniswapSwap(chain(), request);
  assert.deepEqual(result, { status: "settled", transactionHash: hash, blockNumber: "10",
    account: sender, deltas: { USDC: "-1000000", WETH: "500000000000000" } });
});

test("does not call a submitted or reverted transaction a fill", async () => {
  assert.equal((await reconcileUniswapSwap({ ...chain(), getBlockNumber: async () => 10n }, request)).status, "confirming");
  assert.equal((await reconcileUniswapSwap(chain("reverted"), request)).status, "reverted");
  assert.equal((await reconcileUniswapSwap({ ...chain(), getTransaction: async () => {
    throw new TransactionNotFoundError({ hash });
  } }, request)).status, "pending");
});

test("rejects mismatched transaction identity and chain", async () => {
  await assert.rejects(reconcileUniswapSwap({ ...chain(), getChainId: async () => 1 }, request), /Arbitrum/);
  await assert.rejects(reconcileUniswapSwap({ ...chain(), getTransaction: async () => ({
    from: sender, to: router, input: "0xffff" as Hex }) }, request), /differs/);
  await assert.rejects(reconcileUniswapSwap({ ...chain(), getTransaction: async () => {
    throw new Error("RPC unavailable");
  } }, request), /RPC unavailable/);
});
