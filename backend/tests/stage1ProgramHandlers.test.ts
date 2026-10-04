import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activateManagedProgramShadow, createProgramDraft, freezeProgramVersion, getAccountControllers,
  getProgramAssignment, stagePausedAssignment, updateProgramDraft,
} from "../convex/programOwnership";
import { controllerHash } from "../lib/programOwnership";
import { defaultModelRouting } from "../convex/helpers/modelRouting";
import { defaultTeamConfig } from "../convex/helpers/teamConfig";
import { freezeExperimentSpec, getExperimentSpec, listExperimentSpecs } from "../convex/programExperiments";

type Row = Record<string, any> & { _id: string };
type Handler = { _handler: (ctx: unknown, args: any) => Promise<any> };
const call = async (fn: unknown, ctx: unknown, args: any = {}) =>
  (fn as Handler)._handler(ctx, args);

function fixture(subject: string | null = "alice") {
  const rows = new Map<string, Row[]>();
  let nextId = 1;
  const seed = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  seed("users", { _id: "user-a", authSubject: "alice" });
  seed("users", { _id: "user-b", authSubject: "bob" });
  seed("strategyAccounts", { _id: "acct-a", userId: "user-a" });
  seed("strategyAccounts", { _id: "acct-b", userId: "user-b" });
  for (const suffix of ["a", "b"]) {
    seed("agentTeamVersions", { _id: `team-ver-${suffix}`, teamId: `team-${suffix}`,
      strategyAccountId: `acct-${suffix}`, userId: `user-${suffix}`,
      configJson: `{"model":"${suffix}"}` });
    seed("agentModelConfigurations", { _id: `model-${suffix}`,
      strategyAccountId: `acct-${suffix}`, routesJson: `{"model":"${suffix}"}` });
    seed("automationPolicies", { _id: `policy-${suffix}`,
      strategyAccountId: `acct-${suffix}`, policyJson: `{"limit":"${suffix}"}` });
  }
  const db = {
    normalizeId: (table: string, id: string) => {
      if (table === "agentTeamVersions" && id.startsWith("team-ver-")) return id;
      if (table === "tradingProgramVersions" && id.startsWith("program-ver")) return id;
      return null;
    },
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${nextId++}`;
      seed(table, { _id: id, ...value });
      return id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = await db.get(id);
      if (!row) throw new Error(`Missing ${id}`);
      Object.assign(row, value);
    },
    query: (table: string) => {
      let filters: Array<[string, unknown]> = [];
      let descending = false;
      const chain = {
        withIndex: (_index: string, callback: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { filters.push([key, value]); return q; } };
          callback(q);
          return chain;
        },
        order: (direction: string) => { descending = direction === "desc"; return chain; },
        collect: async () => {
          const matches = (rows.get(table) ?? []).filter((row) =>
            filters.every(([key, value]) => row[key] === value));
          return descending ? [...matches].reverse() : matches;
        },
        first: async () => (await chain.collect())[0] ?? null,
        take: async (limit: number) => (await chain.collect()).slice(0, limit),
      };
      return chain;
    },
  };
  const ctx = { auth: { getUserIdentity: async () => subject ? { subject } : null }, db };
  return { ctx, rows, seed };
}

test("operator experiment list remains scoped to its authenticated account", async () => {
  const prior = process.env.PROGRAM_RESEARCH_SUBJECTS;
  process.env.PROGRAM_RESEARCH_SUBJECTS = "alice,bob";
  try {
    const { ctx, seed } = fixture("alice");
    seed("experimentSpecs", { _id: "exp-a", createdBySubject: "alice", strategyAccountId: "acct-a" });
    seed("experimentSpecs", { _id: "exp-b", createdBySubject: "bob", strategyAccountId: "acct-b" });
    seed("experimentSpecs", { _id: "exp-cross", createdBySubject: "alice", strategyAccountId: "acct-b" });
    const specs = await call(listExperimentSpecs, ctx);
    assert.deepEqual(specs.map((spec: Row) => spec._id), ["exp-a"]);
  } finally {
    if (prior === undefined) delete process.env.PROGRAM_RESEARCH_SUBJECTS;
    else process.env.PROGRAM_RESEARCH_SUBJECTS = prior;
  }
});

const composition = (suffix = "a") => ({
  sourceStrategyAccountId: `acct-${suffix}`, teamVersionId: `team-ver-${suffix}`,
  modelConfigurationId: `model-${suffix}`, policyId: `policy-${suffix}`,
  strategyArtifactHash: "a".repeat(64), adapterProfileHash: "b".repeat(64),
  runtimeCompatibility: "agent-v1",
});

async function withOperator(subjects: string, work: () => Promise<void>) {
  const prior = process.env.PROGRAM_OPERATOR_SUBJECTS;
  process.env.PROGRAM_OPERATOR_SUBJECTS = subjects;
  try { await work(); }
  finally {
    if (prior === undefined) delete process.env.PROGRAM_OPERATOR_SUBJECTS;
    else process.env.PROGRAM_OPERATOR_SUBJECTS = prior;
  }
}

test("program creation requires an authenticated, scoped owner of every reference", async () => {
  const args = { name: "Managed v1", idempotencyKey: "program:create:0001", ...composition() };
  await withOperator("alice", async () => {
    await assert.rejects(call(createProgramDraft, fixture(null).ctx, args), /Authentication/);
    await assert.rejects(call(createProgramDraft, fixture("bob").ctx, args), /operator access/);
    await assert.rejects(call(createProgramDraft, fixture("alice").ctx,
      { ...args, ...composition("b") }), /source account|references/i);
  });
});

test("create retry keeps one ID; draft edits do not mutate a frozen version", async () => {
  await withOperator("alice", async () => {
    const { ctx, rows } = fixture();
    const args = { name: "Managed v1", idempotencyKey: "program:create:0002", ...composition() };
    const created = await call(createProgramDraft, ctx, args);
    const retried = await call(createProgramDraft, ctx, args);
    assert.equal(retried.programId, created.programId);
    assert.equal(retried.duplicate, true);
    assert.equal(rows.get("tradingPrograms")?.length, 1);
    const frozen = await call(freezeProgramVersion, ctx,
      { programId: created.programId, expectedRevision: 1 });
    const firstRow = { ...rows.get("tradingProgramVersions")![0] };
    const duplicateFreeze = await call(freezeProgramVersion, ctx,
      { programId: created.programId, expectedRevision: 1 });
    assert.equal(duplicateFreeze.programVersionId, frozen.programVersionId);
    assert.equal(duplicateFreeze.contentHash, frozen.contentHash);
    await call(updateProgramDraft, ctx, { programId: created.programId,
      expectedRevision: 1, ...composition(), strategyArtifactHash: "c".repeat(64) });
    assert.deepEqual(rows.get("tradingProgramVersions")![0], firstRow);
    const changed = await call(freezeProgramVersion, ctx,
      { programId: created.programId, expectedRevision: 2 });
    assert.notEqual(changed.contentHash, frozen.contentHash);
    assert.equal(rows.get("tradingProgramVersions")?.length, 2);
  });
});

test("freezing snapshots referenced model and policy content independently", async () => {
  await withOperator("alice", async () => {
    const { ctx, rows } = fixture();
    const created = await call(createProgramDraft, ctx, {
      name: "Managed v2", idempotencyKey: "program:create:source-snapshot", ...composition(),
    });
    const first = await call(freezeProgramVersion, ctx,
      { programId: created.programId, expectedRevision: 1 });
    const frozenModelJson = rows.get("tradingProgramVersions")![0].modelConfigurationJson;
    rows.get("agentModelConfigurations")![0].routesJson = '{"model":"changed"}';
    const changedModel = await call(freezeProgramVersion, ctx,
      { programId: created.programId, expectedRevision: 1 });
    assert.notEqual(changedModel.contentHash, first.contentHash);
    assert.equal(rows.get("tradingProgramVersions")![0].modelConfigurationJson, frozenModelJson);
    rows.get("automationPolicies")![0].policyJson = '{"limit":"changed"}';
    const changedPolicy = await call(freezeProgramVersion, ctx,
      { programId: created.programId, expectedRevision: 1 });
    assert.notEqual(changedPolicy.contentHash, changedModel.contentHash);
    assert.equal(rows.get("tradingProgramVersions")?.length, 3);
  });
});

test("mobile assignment reads only the signed-in account and rejects ambiguity", async () => {
  const { ctx, seed } = fixture("alice");
  const empty = await call(getProgramAssignment, ctx);
  assert.equal(empty.assignmentState, "unassigned");
  seed("tradingPrograms", { _id: "program", name: "Fixture program" });
  seed("tradingProgramVersions", { _id: "program-ver", programId: "program",
    contentHash: "a".repeat(64) });
  seed("programAssignments", { _id: "assignment-b", strategyAccountId: "acct-b",
    userId: "user-b", programVersionId: "program-ver", status: "active" });
  assert.equal((await call(getProgramAssignment, ctx)).assignmentState, "unassigned");
  seed("programAssignments", { _id: "assignment-a", strategyAccountId: "acct-a",
    userId: "user-a", programVersionId: "program-ver", status: "active" });
  const assigned = await call(getProgramAssignment, ctx);
  assert.equal(assigned.assignmentId, "assignment-a");
  assert.equal(assigned.controllerRef.strategyAccountId, "acct-a");
  seed("programAssignments", { _id: "assignment-a2", strategyAccountId: "acct-a",
    userId: "user-a", programVersionId: "program-ver", status: "active" });
  assert.equal((await call(getProgramAssignment, ctx)).assignmentState, "ambiguous_assignment");
});

test("account controller list retains separate same-market teams", async () => {
  const { ctx, seed } = fixture("alice");
  seed("agentTeamVersions", { _id: "team-ver-a2", teamId: "team-a2",
    strategyAccountId: "acct-a", configJson: '{"model":"second"}' });
  seed("agentMarketDeployments", { _id: "deployment-a1", teamId: "team-a",
    teamVersionId: "team-ver-a", strategyAccountId: "acct-a", userId: "user-a",
    marketId: "BTC-USD", mode: "shadow", status: "active" });
  seed("agentMarketDeployments", { _id: "deployment-a2", teamId: "team-a2",
    teamVersionId: "team-ver-a2", strategyAccountId: "acct-a", userId: "user-a",
    marketId: "BTC-USD", mode: "shadow", status: "active" });
  seed("agentMarketDeployments", { _id: "deployment-b", teamId: "team-b",
    teamVersionId: "team-ver-b", strategyAccountId: "acct-b", userId: "user-b",
    marketId: "BTC-USD", mode: "autopilot", status: "active" });
  const result = await call(getAccountControllers, ctx);
  assert.equal(result.customer.length, 2);
  assert.deepEqual(new Set(result.customer.map((row: any) => row.controllerRef.controllerId)),
    new Set(["deployment-a1", "deployment-a2"]));
  assert.equal(result.managedState, "unassigned");
});

test("research scope freezes only an owned experiment and binds retry content", async () => {
  const prior = process.env.PROGRAM_RESEARCH_SUBJECTS;
  try {
    delete process.env.PROGRAM_RESEARCH_SUBJECTS;
    const { ctx } = fixture("alice");
    const args = { controllerKind: "customer_team", controllerVersionId: "team-ver-a",
      specJson: '{"schemaVersion":1,"purpose":"identity","executable":false}',
      idempotencyKey: "experiment:create:0001" };
    await assert.rejects(call(freezeExperimentSpec, ctx, args), /research access/);
    process.env.PROGRAM_RESEARCH_SUBJECTS = "alice,bob";
    await assert.rejects(call(freezeExperimentSpec, ctx,
      { ...args, controllerVersionId: "team-ver-b" }), /not found in your account/);
    const first = await call(freezeExperimentSpec, ctx, args);
    const retry = await call(freezeExperimentSpec, ctx, { ...args,
      specJson: '{"executable":false,"purpose":"identity","schemaVersion":1}' });
    assert.equal(retry.experimentSpecId, first.experimentSpecId);
    assert.equal(retry.duplicate, true);
    await assert.rejects(call(freezeExperimentSpec, ctx,
      { ...args, specJson: '{"schemaVersion":1,"purpose":"comparison","executable":false}' }),
      /idempotency key conflicts/);
    const owned = await call(getExperimentSpec, ctx, { experimentSpecId: first.experimentSpecId });
    assert.equal(owned.environment, "experiment");
    assert.equal(owned.specJson, args.specJson);
    const bob = { ...(fixture("bob").ctx as any), db: (ctx as any).db };
    assert.equal(await call(getExperimentSpec, bob,
      { experimentSpecId: first.experimentSpecId }), null);
  } finally {
    if (prior === undefined) delete process.env.PROGRAM_RESEARCH_SUBJECTS;
    else process.env.PROGRAM_RESEARCH_SUBJECTS = prior;
  }
});

test("research experiment metadata rejects executable, unknown evidence, and invalid hashes", async () => {
  const prior = process.env.PROGRAM_RESEARCH_SUBJECTS;
  try {
    process.env.PROGRAM_RESEARCH_SUBJECTS = "alice";
    const { ctx, rows } = fixture("alice");
    const base = { controllerKind: "customer_team", controllerVersionId: "team-ver-a",
      idempotencyKey: "experiment:reject:0001" };
    for (const specJson of [
      '{"schemaVersion":1,"purpose":"identity","executable":true}',
      '{"schemaVersion":1,"purpose":"identity","executable":false,"rawEvidence":"secret"}',
      '{"schemaVersion":1,"purpose":"identity","executable":false,"datasetHash":"ABC"}',
      '{"schemaVersion":true,"purpose":"identity","executable":false}',
    ]) {
      await assert.rejects(call(freezeExperimentSpec, ctx, { ...base, specJson }),
        /non-executable identity metadata/);
    }
    assert.equal(rows.get("experimentSpecs")?.length ?? 0, 0);
    const valid = await call(freezeExperimentSpec, ctx, { ...base,
      specJson: JSON.stringify({ schemaVersion: 1, purpose: "comparison", executable: false,
        datasetHash: "a".repeat(64) }) });
    assert.equal(valid.duplicate, false);
    assert.equal(rows.get("experimentSpecs")?.length, 1);
  } finally {
    if (prior === undefined) delete process.env.PROGRAM_RESEARCH_SUBJECTS;
    else process.env.PROGRAM_RESEARCH_SUBJECTS = prior;
  }
});

test("release scope can stage another account only as paused", async () => {
  const prior = process.env.PROGRAM_RELEASE_SUBJECTS;
  try {
    delete process.env.PROGRAM_RELEASE_SUBJECTS;
    const { ctx, seed, rows } = fixture("alice");
    seed("tradingPrograms", { _id: "program-a", createdBySubject: "alice" });
    seed("tradingProgramVersions", { _id: "program-ver-a", programId: "program-a",
      sourceStrategyAccountId: "acct-a", contentHash: "a".repeat(64) });
    const args = { strategyAccountId: "acct-b", programVersionId: "program-ver-a" };
    await assert.rejects(call(stagePausedAssignment, ctx, args), /release access/);
    process.env.PROGRAM_RELEASE_SUBJECTS = "alice";
    const staged = await call(stagePausedAssignment, ctx, args);
    assert.equal(staged.status, "paused");
    const row = rows.get("programAssignments")![0];
    assert.equal(row.userId, "user-b");
    assert.equal(row.status, "paused");
    assert.equal(row.assignedBySubject, "alice");
    const retry = await call(stagePausedAssignment, ctx, args);
    assert.equal(retry.assignmentId, staged.assignmentId);
    assert.equal(retry.duplicate, true);
  } finally {
    if (prior === undefined) delete process.env.PROGRAM_RELEASE_SUBJECTS;
    else process.env.PROGRAM_RELEASE_SUBJECTS = prior;
  }
});

test("release scope can activate an exact frozen program for Shadow analysis", async () => {
  const prior = process.env.PROGRAM_RELEASE_SUBJECTS;
  try {
    delete process.env.PROGRAM_RELEASE_SUBJECTS;
    const { ctx, seed, rows } = fixture("alice");
    const programId = "program-shadow";
    const routing = defaultModelRouting();
    routing.routes.push({ slot: "role:liquidity", provider: "openai", model: "gpt-5.6-sol",
      credentialSource: "platform", maxOutputTokens: 700, inputPriceMicrousdPerMillion: 0,
      cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 });
    const routesJson = JSON.stringify(routing);
    const teamConfigJson = JSON.stringify(defaultTeamConfig("focus", routesJson));
    const modelConfigurationJson = JSON.stringify({ routesJson, pricingVersion: "pricing-1", preset: "economy" });
    const policyJson = JSON.stringify({ allowedMarkets: ["BTC"] });
    const teamConfigHash = await controllerHash({ content: teamConfigJson });
    const modelConfigurationHash = await controllerHash({ content: modelConfigurationJson });
    const policyHash = await controllerHash({ content: policyJson });
    const manifest = { schemaVersion: 1, controllerKind: "managed_program", programId, version: 1,
      sourceStrategyAccountId: "acct-a", teamVersionId: "team-ver-a", modelConfigurationId: "model-a",
      policyId: "policy-a", strategyArtifactHash: "a".repeat(64), adapterProfileHash: "b".repeat(64),
      runtimeCompatibility: "agent-v1", teamConfigHash, modelConfigurationHash, policyHash };
    const contentHash = await controllerHash(manifest);
    seed("tradingPrograms", { _id: programId, createdBySubject: "alice" });
    seed("tradingProgramVersions", { _id: "program-version-shadow", ...manifest,
      programId, teamConfigJson, modelConfigurationJson, policyJson, contentHash });
    seed("programAssignments", { _id: "assignment-shadow", strategyAccountId: "acct-b",
      userId: "user-b", programVersionId: "program-version-shadow", status: "paused" });
    await assert.rejects(call(activateManagedProgramShadow, ctx,
      { assignmentId: "assignment-shadow" }), /release access/);

    process.env.PROGRAM_RELEASE_SUBJECTS = "alice";
    const activated = await call(activateManagedProgramShadow, ctx,
      { assignmentId: "assignment-shadow" });
    assert.equal(activated.status, "active");
    assert.equal(activated.controllerMode, "shadow");
    assert.equal(activated.duplicate, false);
    assert.equal(rows.get("programAssignments")![0].status, "active");
    const audit = rows.get("auditEvents")![0];
    assert.equal(audit.kind, "managed_program.shadow_activated");
    assert.match(audit.detail, /"sourceStrategyAccountId":"acct-a"/);
    const retry = await call(activateManagedProgramShadow, ctx,
      { assignmentId: "assignment-shadow" });
    assert.equal(retry.duplicate, true);

    rows.get("tradingProgramVersions")![0].policyJson = "{}";
    await assert.rejects(call(activateManagedProgramShadow, ctx,
      { assignmentId: "assignment-shadow" }), /integrity checks/);
  } finally {
    if (prior === undefined) delete process.env.PROGRAM_RELEASE_SUBJECTS;
    else process.env.PROGRAM_RELEASE_SUBJECTS = prior;
  }
});
