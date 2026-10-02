import assert from "node:assert/strict";
import { test } from "node:test";
import { recordConfirmedFlat, recordObservedFlat } from "../convex/managedProgramClosure";

const handler = (recordConfirmedFlat as any)._handler as (ctx: any, args: any) => Promise<any>;
const observedHandler = (recordObservedFlat as any)._handler as (ctx: any, args: any) => Promise<any>;
const sha = (character: string) => character.repeat(64);
const hex = (character: string) => `0x${sha(character)}`;

function fixture() {
  const tables = new Map<string, Array<Record<string, any>>>();
  const add = (table: string, row: Record<string, any>) =>
    tables.set(table, [...(tables.get(table) ?? []), row]);
  add("strategyAccounts", { _id: "account-a", userId: "user-a" });
  add("programAssignments", { _id: "assignment-a", strategyAccountId: "account-a",
    userId: "user-a", programVersionId: "version-a", source: "explicit",
    controllerMode: "autopilot", status: "paused", shadowCadenceEnabled: false,
    positionClosureState: "unconfirmed" });
  add("tradingProgramVersions", { _id: "version-a" });
  add("accountWallets", { _id: "wallet-a", userId: "user-a", strategyAccountId: "account-a",
    ownerAddress: "0x1111111111111111111111111111111111111111" });
  add("managedProgramActivationAuthorities", { _id: "authority-a", assignmentId: "assignment-a",
    strategyAccountId: "account-a", programVersionId: "version-a",
    ownerAddress: "0x1111111111111111111111111111111111111111",
    source: "native_finance_authority", venue: "uniswap", state: "revoked",
    executionGrantId: "grant-a" });
  add("tradeProposals", { _id: "proposal-a", programAssignmentId: "assignment-a",
    status: "executed" });
  const db = {
    get: async (id: string) => [...tables.values()].flat().find((row) => row._id === id) ?? null,
    query: (table: string) => {
      const conditions: Array<[string, unknown]> = [];
      const chain = {
        withIndex: (_index: string, filter: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { conditions.push([key, value]); return q; } };
          filter(q);
          return chain;
        },
        first: async () => (tables.get(table) ?? []).find((row) =>
          conditions.every(([key, value]) => row[key] === value)) ?? null,
        collect: async () => (tables.get(table) ?? []).filter((row) =>
          conditions.every(([key, value]) => row[key] === value)),
      };
      return chain;
    },
    insert: async (table: string, row: Record<string, any>) => {
      const id = `${table}-${(tables.get(table) ?? []).length + 1}`;
      add(table, { _id: id, ...row });
      return id;
    },
    patch: async (id: string, patch: Record<string, any>) => {
      const row = await db.get(id);
      if (!row) throw Error("missing row");
      Object.assign(row, patch);
    },
  };
  const args = { strategyAccountId: "account-a", assignmentId: "assignment-a",
    programVersionId: "version-a", ownerAddress: "0x1111111111111111111111111111111111111111",
    grantId: "grant-a", financeSnapshotHash: sha("a"), financeRevision: "9",
    confirmedBlockNumber: "123", confirmedBlockHash: hex("b"), wethUnits: "0",
    pendingAttemptCount: 0, exitAttemptId: sha("c"), exitReservationId: sha("d"),
    exitIntentId: sha("e"), actualWethInputUnits: "1234", actualUsdcOutputUnits: "9876",
    exitTransactionHash: hex("f"), journalTransactionId: sha("1") };
  return { ctx: { db }, args, tables };
}

test("trusted finalized exit marks only the stopped owned assignment flat", async () => {
  const { ctx, args, tables } = fixture();
  const result = await handler(ctx, args);
  assert.equal(result.closureConfirmed, true);
  assert.equal(tables.get("programAssignments")![0].positionClosureState, "confirmed_flat");
  assert.equal(tables.get("managedUniswapCloseReceipts")!.length, 1);
  assert.equal((await handler(ctx, args)).duplicate, true);
});

test("a pending order or nonzero exposure cannot unlock withdrawal", async () => {
  const { ctx, args, tables } = fixture();
  await assert.rejects(handler(ctx, { ...args, wethUnits: "1" }), /malformed/);
  tables.get("tradeProposals")![0].status = "executing";
  await assert.rejects(handler(ctx, args), /not stopped, owned, and settled/);
  assert.equal(tables.get("programAssignments")![0].positionClosureState, "unconfirmed");
});

test("a stopped account that abstained can unlock withdrawal from finalized zero exposure", async () => {
  const { ctx, args, tables } = fixture();
  const observed = { strategyAccountId: args.strategyAccountId, assignmentId: args.assignmentId,
    programVersionId: args.programVersionId, ownerAddress: args.ownerAddress,
    financeSnapshotHash: args.financeSnapshotHash, financeRevision: args.financeRevision,
    finalizedBlockNumber: args.confirmedBlockNumber,
    finalizedBlockHash: args.confirmedBlockHash, wethUnits: "0", pendingAttemptCount: 0 };
  const result = await observedHandler(ctx, observed);
  assert.equal(result.closureConfirmed, true);
  assert.equal(tables.get("programAssignments")![0].positionClosureState, "confirmed_flat");
  assert.equal((await observedHandler(ctx, observed)).duplicate, true);
});
