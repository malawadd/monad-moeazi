import assert from "node:assert/strict";
import { test } from "node:test";
import { recordConfirmedUniswapBuy } from "../convex/managedTradeReceipt";

type Row = Record<string, any> & { _id: string };
const handler = (recordConfirmedUniswapBuy as any)._handler as (ctx: any, args: any) => Promise<any>;
const sha = (character: string) => character.repeat(64);
const hex = (character: string) => `0x${character.repeat(64)}`;

function fixture() {
  const rows = new Map<string, Row[]>();
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  add("programAssignments", { _id: "assignment-a", strategyAccountId: "account-a",
    userId: "user-a", programVersionId: "version-a", status: "paused" });
  add("tradingProgramVersions", { _id: "version-a", contentHash: sha("a") });
  add("tradeProposals", { _id: "proposal-a", strategyAccountId: "account-a",
    userId: "user-a", programAssignmentId: "assignment-a", programVersionId: "version-a",
    controllerMode: "autopilot", status: "executing", payloadJson: JSON.stringify({
      side: "long", candidate_venues: ["uniswap"], order_type: "market", leverage: 1,
    }), controllerRef: { controllerKind: "managed_program", controllerId: "assignment-a",
      controllerVersionId: "version-a", contentHash: sha("a") } });
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${(rows.get(table) ?? []).length + 1}`;
      add(table, { _id: id, ...value });
      return id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = await db.get(id);
      if (!row) throw Error("missing row");
      Object.assign(row, value);
    },
    query: (table: string) => {
      const conditions: Array<[string, unknown]> = [];
      const chain = {
        withIndex: (_name: string, filter: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { conditions.push([key, value]); return q; } };
          filter(q);
          return chain;
        },
        first: async () => (rows.get(table) ?? []).find((row) =>
          conditions.every(([key, value]) => row[key] === value)) ?? null,
      };
      return chain;
    },
  };
  const args = { proposalId: "proposal-a", strategyAccountId: "account-a",
    assignmentId: "assignment-a", programVersionId: "version-a", intentId: "intent-a",
    attemptId: sha("b"), reservationId: sha("c"), grantId: "grant-a",
    userOperationHash: hex("d"), transactionHash: hex("e"), confirmedBlockNumber: "123",
    confirmedBlockHash: hex("f"), postFillSnapshotHash: sha("1"), financeRevision: "8",
    journalTransactionId: sha("2"), actualInputUnits: "1000000", actualOutputUnits: "400000000000000" };
  return { ctx: { db }, rows, args, add };
}

test("finalized finance proof records one actual fill even after Stop paused the assignment", async () => {
  const { ctx, rows, args } = fixture();
  const first = await handler(ctx, args);
  assert.equal(first.duplicate, false);
  assert.equal(rows.get("tradeProposals")![0].status, "executed");
  assert.equal(rows.get("executions")![0].status, "filled");
  assert.equal(rows.get("executions")![0].txHash, args.transactionHash);
  const retry = await handler(ctx, args);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.executionId, rows.get("executions")![0]._id);
  assert.equal(rows.get("executions")!.length, 1);
});

test("foreign or contradictory native fill cannot overwrite a proposal", async () => {
  const { ctx, args, rows, add } = fixture();
  await assert.rejects(handler(ctx, { ...args, assignmentId: "assignment-b" }), /does not match/);
  await handler(ctx, args);
  await assert.rejects(handler(ctx, { ...args, actualOutputUnits: "1" }), /conflicts/);
  add("tradeProposals", { ...rows.get("tradeProposals")![0], _id: "proposal-b", status: "executing" });
  await assert.rejects(handler(ctx, { ...args, proposalId: "proposal-b" }), /already attributed/);
});
