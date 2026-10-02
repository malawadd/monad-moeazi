import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getCurrent, projectCurrent } from "../convex/financeProjection";
import { getViewerScope } from "../convex/financeAuthority";
import { financeEventId, financeProjectionHash, type FinanceProjection } from "../lib/financeProjection";

type Row = Record<string, any> & { _id: string };
type Handler = { _handler: (ctx: unknown, args: any) => Promise<any> };
const call = (handler: unknown, ctx: unknown, args: any) =>
  (handler as Handler)._handler(ctx, args);
const golden = JSON.parse(readFileSync(new URL("./fixtures/stage2FinanceProjection.json", import.meta.url),
  "utf8")) as FinanceProjection;

function fixture(subject: string | null = "alice") {
  const rows = new Map<string, Row[]>();
  let next = 1;
  const seed = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  seed("users", { _id: "user-a", authSubject: "alice" });
  seed("users", { _id: "user-b", authSubject: "bob" });
  seed("strategyAccounts", { _id: "acct-a", userId: "user-a" });
  seed("strategyAccounts", { _id: "acct-b", userId: "user-b" });
  seed("experimentSpecs", { _id: "spec-a", strategyAccountId: "acct-a",
    createdBySubject: "alice", environment: "experiment" });
  seed("experimentSpecs", { _id: "spec-b", strategyAccountId: "acct-b",
    createdBySubject: "bob", environment: "experiment" });
  const db = {
    normalizeId: (table: string, id: string) =>
      (rows.get(table) ?? []).some((row) => row._id === id) ? id : null,
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${next++}`;
      seed(table, { _id: id, ...value });
      return id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = await db.get(id);
      if (!row) throw new Error(`Missing ${id}`);
      Object.assign(row, value);
    },
    query: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        withIndex: (_index: string, callback: (q: any) => unknown) => {
          const q = { eq(key: string, value: unknown) { filters.push([key, value]); return q; } };
          callback(q);
          return chain;
        },
        first: async () => (rows.get(table) ?? []).find((row) =>
          filters.every(([key, value]) => row[key] === value)) ?? null,
      };
      return chain;
    },
  };
  const ctx = { db, auth: { getUserIdentity: async () => subject ? { subject } : null } };
  return { ctx, rows };
}

function projection(environment: "live" | "experiment" = "experiment",
                    accountRevision = "1"): FinanceProjection {
  return { ...golden, environment,
    scopeId: environment === "live" ? "live" : "spec-a",
    strategyAccountId: "acct-a", accountRevision,
    reconciliationState: "unknown", reconciliationReason: "fixture" };
}

async function args(value: FinanceProjection, eventId?: string) {
  return { eventId: eventId ?? await financeEventId(value),
    payloadHash: await financeProjectionHash(value), projection: value };
}

test("internal projection creates, duplicates exactly, rejects same-revision conflict", async () => {
  const { ctx, rows } = fixture();
  const first = await args(projection());
  assert.deepEqual(await call(projectCurrent, ctx, first), { applied: true, reason: "created" });
  assert.deepEqual(await call(projectCurrent, ctx, first), { applied: false, reason: "duplicate" });
  assert.equal(rows.get("currentFinanceProjections")?.length, 1);
  await assert.rejects(call(projectCurrent, ctx, await args({ ...first.projection,
    reconciliationReason: "changed" })), /revision conflicts/);
  await assert.rejects(call(projectCurrent, ctx, await args(first.projection, "event-other")),
    /receipt is invalid/);
});

test("stale projection cannot replace newer; higher revision retains writer epoch", async () => {
  const { ctx, rows } = fixture();
  await call(projectCurrent, ctx, await args(projection("experiment", "2")));
  assert.deepEqual(await call(projectCurrent, ctx,
    await args(projection("experiment", "1"))),
  { applied: false, reason: "stale_revision" });
  await assert.rejects(call(projectCurrent, ctx, await args({
    ...projection("experiment", "3"), writerEpoch: "3" })),
  /writer epoch moved backwards/);
  await assert.rejects(call(projectCurrent, ctx, await args({
    ...projection("experiment", "3"), writerEpoch: "5", authorityEpoch: "0" })),
  /authority epoch moved backwards/);
  assert.deepEqual(await call(projectCurrent, ctx, await args({
    ...projection("experiment", "3"), writerEpoch: "5" })),
  { applied: true, reason: "updated" });
  assert.equal(rows.get("currentFinanceProjections")?.[0].accountRevision, "3");
  assert.equal(rows.get("currentFinanceProjections")?.length, 1);
});

test("projection refuses foreign experiment scope and invalid payload hash", async () => {
  const { ctx, rows } = fixture();
  await assert.rejects(call(projectCurrent, ctx, await args({
    ...projection(), scopeId: "spec-b" })), /experiment scope/);
  await assert.rejects(call(projectCurrent, ctx, { ...(await args(projection())),
    payloadHash: "f".repeat(64) }), /receipt is invalid/);
  assert.equal(rows.get("currentFinanceProjections")?.length ?? 0, 0);
});

test("signed-in reads and worker scope resolution isolate users and experiments", async () => {
  const prior = process.env.PROGRAM_RESEARCH_SUBJECTS;
  try {
    process.env.PROGRAM_RESEARCH_SUBJECTS = "alice,bob";
    const { ctx } = fixture("alice");
    await call(projectCurrent, ctx, await args(projection()));
    await call(projectCurrent, ctx, await args(projection("live")));
    assert.equal((await call(getCurrent, ctx,
      { environment: "experiment", experimentSpecId: "spec-a" })).status, "projected");
    assert.equal((await call(getCurrent, ctx, { environment: "live" })).status, "projected");
    const bob = { ...ctx, auth: { getUserIdentity: async () => ({ subject: "bob" }) } };
    await assert.rejects(call(getCurrent, bob,
      { environment: "experiment", experimentSpecId: "spec-a" }), /unavailable/);
    assert.equal((await call(getCurrent, bob, { environment: "live" })).status, "unknown");
    assert.equal((await call(getViewerScope, ctx,
      { subject: "alice", environment: "live" })).scope.strategyAccountId, "acct-a");
    assert.equal((await call(getViewerScope, ctx,
      { subject: "bob", environment: "live" })).scope.strategyAccountId, "acct-b");
    assert.equal(await call(getViewerScope, ctx,
      { subject: "bob", environment: "experiment", experimentSpecId: "spec-a" }), null);
    assert.equal((await call(getViewerScope, ctx,
      { subject: "alice", environment: "experiment", experimentSpecId: "spec-a" }))
      .scope.scopeId, "spec-a");
  } finally {
    if (prior === undefined) delete process.env.PROGRAM_RESEARCH_SUBJECTS;
    else process.env.PROGRAM_RESEARCH_SUBJECTS = prior;
  }
});
