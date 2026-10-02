import assert from "node:assert/strict";
import { test } from "node:test";
import { getContext } from "../convex/simulationAuthority";
import { customerControllerRef } from "../lib/programOwnership";

type Row = Record<string, any> & { _id: string };
const call = (ctx: unknown, subject = "alice", experimentSpecId = "spec-a") =>
  (getContext as unknown as { _handler: (ctx: unknown, args: any) => Promise<any> })
    ._handler(ctx, { subject, experimentSpecId });

async function fixture() {
  const rows = new Map<string, Row[]>([
    ["users", [{ _id: "user-a", authSubject: "alice" }, { _id: "user-b", authSubject: "bob" }]],
    ["strategyAccounts", [
      { _id: "account-a", userId: "user-a", status: "active", emergencyStop: false, updatedAt: 1 },
      { _id: "account-b", userId: "user-b", status: "active", emergencyStop: false, updatedAt: 1 },
    ]],
    ["agentTeamVersions", [{ _id: "version-a", userId: "user-a", strategyAccountId: "account-a",
      teamId: "team-a", configJson: "{}" }]],
  ]);
  const controller = await customerControllerRef({ environment: "experiment",
    strategyAccountId: "account-a", teamId: "team-a", teamVersionId: "version-a",
    deploymentId: "spec-a", configJson: "{}" });
  const spec: Row = { _id: "spec-a", createdBySubject: "alice", strategyAccountId: "account-a",
    environment: "experiment", controllerKind: "customer_team", controllerVersionId: "version-a",
    contentHash: controller.contentHash, requestHash: "a".repeat(64),
    specJson: JSON.stringify({ schemaVersion: 1, purpose: "comparison", executable: false }) };
  rows.set("experimentSpecs", [spec]);
  const db = {
    normalizeId: (table: string, id: string) =>
      rows.get(table)?.some((row) => row._id === id) ? id : null,
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    query: (table: string) => {
      const filters: [string, unknown][] = [];
      const chain = {
        withIndex: (_name: string, fn: (q: any) => void) => {
          const q = { eq(key: string, value: unknown) { filters.push([key, value]); return q; } };
          fn(q); return chain;
        },
        first: async () => rows.get(table)?.find((row) =>
          filters.every(([key, value]) => row[key] === value)) ?? null,
      };
      return chain;
    },
  };
  return { ctx: { db }, rows, spec, controller };
}

async function withRole(run: () => Promise<void>) {
  const original = process.env.PROGRAM_RESEARCH_SUBJECTS;
  process.env.PROGRAM_RESEARCH_SUBJECTS = "alice,bob";
  try { await run(); } finally {
    if (original === undefined) delete process.env.PROGRAM_RESEARCH_SUBJECTS;
    else process.env.PROGRAM_RESEARCH_SUBJECTS = original;
  }
}

test("simulation identity derives account/controller and never grants live authority", () => withRole(async () => {
  const { ctx, controller } = await fixture();
  const result = await call(ctx);
  assert.deepEqual(result.scope, { environment: "experiment", scopeId: "spec-a", strategyAccountId: "account-a" });
  assert.deepEqual(result.controllerRef, controller);
  assert.equal(result.authority, "simulation_identity_only");
  assert.equal(result.entryEligible, true);
  assert.equal(result.liveExecutionAllowed, false);
  assert.equal(result.reason, "simulation_manifest_required");
}));

test("simulation identity rejects cross-owner, missing identity and revoked research role", () => withRole(async () => {
  const { ctx } = await fixture();
  assert.equal(await call(ctx, "bob"), null);
  assert.equal(await call(ctx, "unknown"), null);
  assert.equal(await call(ctx, "alice", "missing"), null);
  process.env.PROGRAM_RESEARCH_SUBJECTS = "bob";
  assert.equal(await call(ctx), null);
}));

test("experiment entry accepts ready and active accounts and blocks stopped lifecycle states", () => withRole(async () => {
  const { ctx, rows } = await fixture();
  const account = rows.get("strategyAccounts")![0];
  account.status = "ready";
  const ready = await call(ctx);
  assert.equal(ready.entryEligible, true);
  assert.equal(ready.reason, "simulation_manifest_required");

  account.status = "active";
  const active = await call(ctx);
  assert.equal(active.entryEligible, true);
  assert.notEqual(active.authorityFingerprint, ready.authorityFingerprint);

  for (const [status, reason] of [
    ["provisioning", "account_not_simulation_ready"],
    ["paused", "account_paused"],
    ["emergency_stopped", "account_emergency_stopped"],
  ]) {
    account.status = status;
    account.emergencyStop = false;
    const blocked = await call(ctx);
    assert.equal(blocked.entryEligible, false);
    assert.equal(blocked.reason, reason);
  }

  account.status = "ready";
  account.emergencyStop = true;
  const stopped = await call(ctx);
  assert.equal(stopped.entryEligible, false);
  assert.equal(stopped.reason, "account_emergency_stop_active");
  assert.notEqual(stopped.authorityFingerprint, ready.authorityFingerprint);
}));

test("account stop changes authority fingerprint and blocks new simulated entries", () => withRole(async () => {
  const { ctx, rows } = await fixture();
  const first = await call(ctx);
  rows.get("strategyAccounts")![0].emergencyStop = true;
  const stopped = await call(ctx);
  assert.equal(stopped.entryEligible, false);
  assert.equal(stopped.reason, "account_emergency_stop_active");
  assert.notEqual(stopped.authorityFingerprint, first.authorityFingerprint);
  assert.deepEqual(stopped.controllerRef, first.controllerRef);
}));

test("simulation identity rejects altered or cross-account frozen versions", () => withRole(async () => {
  const { ctx, rows, spec } = await fixture();
  const hash = spec.contentHash;
  spec.contentHash = "b".repeat(64);
  assert.equal(await call(ctx), null);
  spec.contentHash = hash;
  rows.get("agentTeamVersions")![0].strategyAccountId = "account-b";
  assert.equal(await call(ctx), null);
}));

test("identity-only metadata cannot masquerade as an executable run manifest", () => withRole(async () => {
  const { ctx, spec } = await fixture();
  for (const specJson of ["null", "[]", "broken", '{"schemaVersion":1,"executable":true}',
    '{"schemaVersion":1,"executable":false,"datasetHash":"wrong"}',
    '{"schemaVersion":1,"executable":false}',
    '{"schemaVersion":1,"purpose":"comparison","executable":false,"extra":"unreviewed"}']) {
    spec.specJson = specJson;
    assert.equal(await call(ctx), null);
  }
}));

test("managed simulation requires owned program and frozen source account", () => withRole(async () => {
  const { ctx, rows, spec } = await fixture();
  Object.assign(spec, { controllerKind: "managed_program", controllerVersionId: "program-version-a" });
  rows.set("tradingProgramVersions", [{ _id: "program-version-a", programId: "program-a",
    sourceStrategyAccountId: "account-a", contentHash: spec.contentHash }]);
  rows.set("tradingPrograms", [{ _id: "program-a", createdBySubject: "alice" }]);
  assert.equal((await call(ctx)).controllerRef.controllerId, "spec-a");
  rows.get("tradingPrograms")![0].createdBySubject = "bob";
  assert.equal(await call(ctx), null);
}));
