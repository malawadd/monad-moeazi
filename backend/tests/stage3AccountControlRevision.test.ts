import assert from "node:assert/strict";
import { test } from "node:test";
import { enableStrategy, pauseStrategy, updateStrategyExecutionState } from "../convex/mutations";
import { getContext } from "../convex/simulationAuthority";
import { accountControlRevision, nextAccountControlRevision } from "../lib/accountControlAuthority";
import { customerControllerRef } from "../lib/programOwnership";

type Row = Record<string, any> & { _id: string };
type Handler = { _handler: (ctx: unknown, args: any) => Promise<any> };
const invoke = (handler: unknown, ctx: unknown, args: unknown) =>
  (handler as Handler)._handler(ctx, args);

async function fixture() {
  const rows = new Map<string, Row[]>([
    ["users", [{ _id: "user-a", authSubject: "alice" }]],
    ["strategyAccounts", [{ _id: "account-a", userId: "user-a", status: "active",
      emergencyStop: false, updatedAt: 1 }]],
    ["agentTeamVersions", [{ _id: "version-a", userId: "user-a",
      strategyAccountId: "account-a", teamId: "team-a", configJson: "{}" }]],
  ]);
  const ref = await customerControllerRef({ environment: "experiment",
    strategyAccountId: "account-a", teamId: "team-a", teamVersionId: "version-a",
    deploymentId: "spec-a", configJson: "{}" });
  rows.set("experimentSpecs", [{ _id: "spec-a", createdBySubject: "alice",
    strategyAccountId: "account-a", environment: "experiment",
    controllerKind: "customer_team", controllerVersionId: "version-a",
    contentHash: ref.contentHash, requestHash: "a".repeat(64),
    specJson: JSON.stringify({ schemaVersion: 1, purpose: "identity", executable: false }) }]);
  const db = {
    normalizeId: (table: string, id: string) =>
      rows.get(table)?.some((row) => row._id === id) ? id : null,
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    patch: async (id: string, body: object) => {
      const row = [...rows.values()].flat().find((item) => item._id === id);
      if (!row) throw new Error("Missing row");
      Object.assign(row, body);
    },
    insert: async (table: string, body: object) => {
      const records = rows.get(table) ?? [];
      records.push({ _id: `${table}-${records.length}`, ...body });
      rows.set(table, records);
    },
    query: (table: string) => {
      const filters: [string, unknown][] = [];
      const chain = {
        withIndex: (_index: string, callback: (q: any) => void) => {
          const q = { eq(key: string, value: unknown) { filters.push([key, value]); return q; } };
          callback(q); return chain;
        },
        first: async () => rows.get(table)?.find((row) =>
          filters.every(([key, value]) => row[key] === value)) ?? null,
      };
      return chain;
    },
  };
  const account = rows.get("strategyAccounts")![0];
  return { ctx: { db, auth: { getUserIdentity: async () => ({ subject: "alice" }) } }, account };
}

async function withResearchRole(action: () => Promise<void>) {
  const original = process.env.PROGRAM_RESEARCH_SUBJECTS;
  process.env.PROGRAM_RESEARCH_SUBJECTS = "alice";
  try { await action(); } finally {
    if (original === undefined) delete process.env.PROGRAM_RESEARCH_SUBJECTS;
    else process.env.PROGRAM_RESEARCH_SUBJECTS = original;
  }
}

const authority = (ctx: unknown) =>
  invoke(getContext, ctx, { subject: "alice", experimentSpecId: "spec-a" });

test("heartbeat leaves authority stable; stop/resume changes it even in one millisecond", () =>
  withResearchRole(async () => {
    const { ctx, account } = await fixture();
    const originalNow = Date.now;
    Date.now = () => 123456789;
    try {
      const initial = await authority(ctx);
      assert.equal(initial.entryEligible, true);
      assert.equal(account.controlRevision, undefined); // legacy rows mean revision zero
      await invoke(updateStrategyExecutionState, ctx, {
        strategyAccountId: account._id, lastHeartbeatAt: 123456789,
        healthStatus: "ready", healthReason: "healthy",
      });
      assert.equal(account.updatedAt, 123456789);
      assert.equal(account.controlRevision, undefined);
      assert.equal((await authority(ctx)).authorityFingerprint, initial.authorityFingerprint);

      await invoke(pauseStrategy, ctx, { emergencyStop: true, reason: "operator stop" });
      const stopped = await authority(ctx);
      assert.equal(account.controlRevision, 1);
      assert.equal(stopped.entryEligible, false);
      assert.notEqual(stopped.authorityFingerprint, initial.authorityFingerprint);

      await invoke(enableStrategy, ctx, {});
      const resumed = await authority(ctx);
      assert.equal(account.controlRevision, 2);
      assert.equal(resumed.entryEligible, true);
      assert.notEqual(resumed.authorityFingerprint, initial.authorityFingerprint);
      await invoke(enableStrategy, ctx, {});
      assert.equal(account.controlRevision, 2);
      assert.equal((await authority(ctx)).authorityFingerprint, resumed.authorityFingerprint);
    } finally { Date.now = originalNow; }
  }));

test("internal status control changes revision; unchanged control and telemetry do not", () =>
  withResearchRole(async () => {
    const { ctx, account } = await fixture();
    const initial = await authority(ctx);
    await invoke(updateStrategyExecutionState, ctx, {
      strategyAccountId: account._id, status: "active", emergencyStop: false,
      lastHeartbeatAt: 55,
    });
    assert.equal(account.controlRevision, 0);
    assert.equal((await authority(ctx)).authorityFingerprint, initial.authorityFingerprint);
    await invoke(updateStrategyExecutionState, ctx, {
      strategyAccountId: account._id, status: "paused", lastHeartbeatAt: 56,
    });
    assert.equal(account.controlRevision, 1);
    assert.equal((await authority(ctx)).entryEligible, false);
  }));

test("invalid and exhausted revisions deny control mutations before patch", () =>
  withResearchRole(async () => {
    const { ctx, account } = await fixture();
    for (const invalid of [null, -1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      account.controlRevision = invalid;
      assert.throws(() => accountControlRevision(account as any));
      await assert.rejects(authority(ctx), /revision is invalid/);
      await assert.rejects(invoke(pauseStrategy, ctx, {}), /revision is invalid/);
      assert.equal(account.status, "active");
    }
    account.controlRevision = Number.MAX_SAFE_INTEGER;
    await assert.rejects(invoke(pauseStrategy, ctx, {}), /revision is exhausted/);
    assert.equal(account.status, "active");
    assert.equal(nextAccountControlRevision(account as any, { status: "active" }),
      Number.MAX_SAFE_INTEGER);
  }));
