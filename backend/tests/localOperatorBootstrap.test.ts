import assert from "node:assert/strict";
import { test } from "node:test";
import { ensureLocalOperator } from "../convex/operatorLocalBootstrap";
import { LOCAL_OPERATOR_SUBJECT } from "../lib/operatorIdentity";

type Row = Record<string, any> & { _id: string };
type Handler = { _handler: (ctx: unknown, args: Record<string, never>) => Promise<any> };
const call = (ctx: unknown) => (ensureLocalOperator as Handler)._handler(ctx, {});

function fixture(subject: string | null) {
  const rows = new Map<string, Row[]>();
  let next = 0;
  const db = {
    query: (table: string) => {
      let filters: Array<[string, unknown]> = [];
      const chain: any = {
        withIndex: (_name: string, build: (query: any) => unknown) => {
          const query = { eq: (key: string, value: unknown) => (filters.push([key, value]), query) };
          build(query);
          return chain;
        },
        first: async () => (rows.get(table) ?? []).find((row) =>
          filters.every(([key, value]) => row[key] === value)) ?? null,
      };
      return chain;
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      const row = { _id: `${table}-${++next}`, ...value };
      rows.set(table, [...(rows.get(table) ?? []), row]);
      return row._id;
    },
  };
  return {
    rows,
    ctx: { auth: { getUserIdentity: async () => subject ? { subject } : null }, db },
  };
}

async function withBootstrapEnvironment(run: () => Promise<void>) {
  const before = {
    enabled: process.env.MONAD_LOCAL_OPERATOR_BOOTSTRAP_ENABLED,
    operators: process.env.PROGRAM_OPERATOR_SUBJECTS,
  };
  process.env.MONAD_LOCAL_OPERATOR_BOOTSTRAP_ENABLED = "true";
  process.env.PROGRAM_OPERATOR_SUBJECTS = LOCAL_OPERATOR_SUBJECT;
  try { await run(); }
  finally {
    if (before.enabled === undefined) delete process.env.MONAD_LOCAL_OPERATOR_BOOTSTRAP_ENABLED;
    else process.env.MONAD_LOCAL_OPERATOR_BOOTSTRAP_ENABLED = before.enabled;
    if (before.operators === undefined) delete process.env.PROGRAM_OPERATOR_SUBJECTS;
    else process.env.PROGRAM_OPERATOR_SUBJECTS = before.operators;
  }
}

test("local operator bootstrap is idempotent and creates a walletless paused account", async () => {
  await withBootstrapEnvironment(async () => {
    const { ctx, rows } = fixture(LOCAL_OPERATOR_SUBJECT);
    const first = await call(ctx);
    const second = await call(ctx);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.userId, first.userId);
    assert.equal(second.strategyAccountId, first.strategyAccountId);
    assert.equal(rows.get("users")?.length, 1);
    assert.equal(rows.get("strategyAccounts")?.length, 1);
    assert.equal(rows.get("users")?.[0].walletAddress, undefined);
    assert.equal(rows.get("strategyAccounts")?.[0].accountWalletId, undefined);
    assert.equal(rows.get("strategyAccounts")?.[0].status, "paused");
    assert.equal(rows.get("strategyAccounts")?.[0].emergencyStop, true);
  });
});

test("local operator bootstrap denies other subjects and disabled deployments", async () => {
  await withBootstrapEnvironment(async () => {
    const unknown = fixture("particle:customer");
    await assert.rejects(call(unknown.ctx), /local operator identity/);
    assert.equal(unknown.rows.size, 0);

    const local = fixture(LOCAL_OPERATOR_SUBJECT);
    process.env.MONAD_LOCAL_OPERATOR_BOOTSTRAP_ENABLED = "false";
    await assert.rejects(call(local.ctx), /bootstrap is disabled/);
    assert.equal(local.rows.size, 0);
  });
});

