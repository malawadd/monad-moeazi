import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRun } from "../convex/programMigration";

type Row = Record<string, any> & { _id: string };
const invoke = (ctx: unknown, args: any) =>
  (dryRun as unknown as { _handler: (ctx: unknown, args: any) => Promise<any> })._handler(ctx, args);

function inventory(subject: string | null = "alice") {
  const rows = new Map<string, Row[]>();
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  add("users", { _id: "user-a", authSubject: "alice" });
  add("strategyAccounts", { _id: "acct-a", userId: "user-a" });
  add("strategyAccounts", { _id: "acct-b", userId: "user-b" });
  add("agentProfiles", { _id: "team-a", strategyAccountId: "acct-a", userId: "user-a" });
  add("agentProfiles", { _id: "team-b", strategyAccountId: "acct-b", userId: "user-b" });
  add("agentMarketDeployments", { _id: "deploy-b", strategyAccountId: "acct-b",
    userId: "user-b", teamId: "team-b", teamVersionId: "version-b",
    marketId: "BTC-USD", status: "active", mode: "shadow" });
  add("agentTeamVersions", { _id: "version-b", strategyAccountId: "acct-b", teamId: "team-b" });
  let writes = 0;
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    insert: async () => { writes++; throw new Error("Dry run wrote state"); },
    patch: async () => { writes++; throw new Error("Dry run wrote state"); },
    query: (table: string) => {
      const conditions: Array<[string, unknown]> = [];
      const chain = {
        withIndex: (_name: string, select: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { conditions.push([key, value]); return q; } };
          select(q);
          return chain;
        },
        first: async () => (rows.get(table) ?? []).find((row) =>
          conditions.every(([key, value]) => row[key] === value)) ?? null,
        collect: async () => (rows.get(table) ?? []).filter((row) =>
          conditions.every(([key, value]) => row[key] === value)),
        paginate: async ({ cursor, numItems }: { cursor: string | null; numItems: number }) => {
          const all = rows.get(table) ?? [];
          const start = Number(cursor ?? 0);
          const page = all.slice(start, start + numItems);
          const offset = start + page.length;
          return { page, continueCursor: offset < all.length ? String(offset) : "",
            isDone: offset >= all.length };
        },
      };
      return chain;
    },
  };
  return { ctx: { auth: { getUserIdentity: async () => subject ? { subject } : null }, db },
    add, writes: () => writes };
}

async function withOperator(work: () => Promise<void>) {
  const prior = process.env.PROGRAM_OPERATOR_SUBJECTS;
  process.env.PROGRAM_OPERATOR_SUBJECTS = "alice";
  try { await work(); }
  finally {
    if (prior === undefined) delete process.env.PROGRAM_OPERATOR_SUBJECTS;
    else process.env.PROGRAM_OPERATOR_SUBJECTS = prior;
  }
}

test("migration inventory is scoped, paginated, explicit about unresolved rows, and read only", async () => {
  await withOperator(async () => {
    const { ctx, add, writes } = inventory();
    const first = await invoke(ctx, { limit: 1 });
    assert.equal(first.dryRun, true);
    assert.equal(first.isDone, false);
    assert.equal(first.accounts.length, 1);
    assert.equal(first.accounts[0].strategyAccountId, "acct-a");
    assert.deepEqual(new Set(first.accounts[0].unresolved.map((row: any) => row.code)),
      new Set(["TEAM_WITHOUT_DEPLOYMENT", "MOBILE_UNASSIGNED"]));
    const second = await invoke(ctx, { limit: 1, cursor: first.continueCursor });
    assert.equal(second.isDone, true);
    assert.equal(second.accounts[0].strategyAccountId, "acct-b");
    assert.deepEqual(second.accounts[0].unresolved.map((row: any) => row.code),
      ["MOBILE_UNASSIGNED"]);
    add("programAssignments", { _id: "assignment-b", strategyAccountId: "acct-b",
      userId: "user-b", status: "active" });
    add("programAssignments", { _id: "assignment-b2", strategyAccountId: "acct-b",
      userId: "user-b", status: "active" });
    const ambiguous = await invoke(ctx, { limit: 1, cursor: first.continueCursor });
    assert.deepEqual(ambiguous.accounts[0].unresolved.map((row: any) => row.code),
      ["MOBILE_AMBIGUOUS_ASSIGNMENT"]);
    assert.equal(writes(), 0);
  });
});

test("migration inventory refuses unscoped caller", async () => {
  await withOperator(async () => {
    await assert.rejects(invoke(inventory(null).ctx, {}), /Authentication/);
    await assert.rejects(invoke(inventory("bob").ctx, {}), /operator access/);
  });
});
