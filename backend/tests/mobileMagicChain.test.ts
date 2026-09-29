import assert from "node:assert/strict";
import { test } from "node:test";
import { delegationTarget, record } from "../convex/mobileMagicChain";

const owner = "0x56b6c8ef6e04fa995f835f56c009f01623af5963";
const delegate = "0x13e00e089f81ad9f36b655c9e9a07c6bf1489a5a";
const code = `0xef0100${delegate.slice(2)}`;
const args = { userId: "user-a", walletId: "wallet-a", strategyAccountId: "account-a",
  ownerAddress: owner, blockNumber: 100, blockHash: `0x${"a".repeat(64)}`,
  code, delegateAddress: delegate, usdcUnits: "1095927", ethWei: "244844881812256" };

function fixture() {
  const rows = new Map<string, Record<string, any>>([
    ["user-a", { _id: "user-a" }],
    ["account-a", { _id: "account-a", userId: "user-a", accountWalletId: "wallet-a" }],
    ["wallet-a", { _id: "wallet-a", userId: "user-a", ownerAddress: owner,
      walletProvider: "magic", accountMode: "eip7702", arbitrumBalanceBlock: 99 }],
  ]);
  return { rows, ctx: { db: {
    get: async (id: string) => rows.get(id) ?? null,
    patch: async (id: string, value: object) => Object.assign(rows.get(id)!, value),
  } } };
}

const run = (ctx: any, input: any) => (record as any)._handler(ctx, input);

test("a finalized Magic observation updates only the strategy-bound Magic wallet", async () => {
  const { rows, ctx } = fixture();
  assert.equal(delegationTarget(code, "0x6001"), delegate);
  assert.equal(delegationTarget(code, "0x"), null);
  const result = await run(ctx, args);
  assert.equal(result.delegationState, "active");
  assert.equal(rows.get("wallet-a")?.eip7702Delegated, true);
  assert.equal(rows.get("wallet-a")?.arbitrumUsdcBalance, "1.095927");
  assert.equal(rows.get("wallet-a")?.arbitrumEthBalance, "0.000244844881812256");

  await assert.rejects(run(ctx, { ...args, blockNumber: 98 }), /observation cannot update/i);
  await assert.rejects(run(ctx, { ...args, ownerAddress: delegate }), /observation cannot update/i);
  await assert.rejects(run(ctx, { ...args, delegateAddress: owner }), /delegate does not match/i);
});

test("a Particle wallet row cannot receive the Magic delegation observation", async () => {
  const { rows, ctx } = fixture();
  rows.get("wallet-a")!.walletProvider = "particle";
  await assert.rejects(run(ctx, args), /observation cannot update/i);
  assert.equal(rows.get("wallet-a")?.eip7702Delegated, undefined);
});
