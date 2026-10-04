import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { recordTradeProposal } from "../convex/agentWorker";
import { decideTradeProposal } from "../convex/agentMutations";
import { customerControllerRef } from "../lib/programOwnership";
import { canonicalTaggedHash, safetyRequestHash } from "../convex/helpers/dependencySafetyVerification";

type Row = Record<string, any> & { _id: string };
const invoke = (fn: unknown, ctx: unknown, args: any) =>
  (fn as { _handler: (ctx: unknown, args: any) => Promise<any> })._handler(ctx, args);

function store(subject = "alice") {
  const rows = new Map<string, Row[]>();
  let nextId = 1;
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  add("users", { _id: "user-a", authSubject: "alice" });
  add("users", { _id: "user-b", authSubject: "bob" });
  add("strategyAccounts", { _id: "acct-a", userId: "user-a", status: "active", emergencyStop: false });
  add("strategyAccounts", { _id: "acct-b", userId: "user-b", status: "active", emergencyStop: false });
  add("agentProfiles", { _id: "team-a", strategyAccountId: "acct-a", userId: "user-a",
    paused: false, authorityMode: "shadow" });
  add("agentTeamVersions", { _id: "version-a", teamId: "team-a",
    strategyAccountId: "acct-a", userId: "user-a", configJson: '{"tier":"focus"}' });
  add("agentMarketDeployments", { _id: "deployment-a", teamId: "team-a",
    teamVersionId: "version-a", strategyAccountId: "acct-a", userId: "user-a",
    marketId: "BTC-USD", status: "active", mode: "shadow" });
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${nextId++}`;
      add(table, { _id: id, ...value });
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
        withIndex: (_name: string, select: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { filters.push([key, value]); return q; } };
          select(q);
          return chain;
        },
        first: async () => (rows.get(table) ?? []).find((row) =>
          filters.every(([key, value]) => row[key] === value)) ?? null,
        collect: async () => (rows.get(table) ?? []).filter((row) =>
          filters.every(([key, value]) => row[key] === value)),
      };
      return chain;
    },
  };
  const ctx = { auth: { getUserIdentity: async () => ({ subject }) }, db };
  return { ctx, rows, add, db };
}

async function proposalFixture(mode: "shadow" | "approval_required" | "autopilot") {
  const fixture = store();
  const deployment = fixture.rows.get("agentMarketDeployments")![0];
  deployment.mode = mode;
  const controllerRef = await customerControllerRef({ strategyAccountId: "acct-a",
    teamId: "team-a", teamVersionId: "version-a", deploymentId: "deployment-a",
    configJson: '{"tier":"focus"}' });
  const payloadJson = JSON.stringify({ account_id: "acct-a", analysis_id: "analysis-a",
    market: "BTC-USD", side: "short", candidate_venues: ["gmx"] });
  const proposal = JSON.parse(payloadJson);
  fixture.add("analysisJobs", { _id: "job-a", strategyAccountId: "acct-a", userId: "user-a",
    scope: "private", status: "completed", analysisId: "analysis-a",
    teamId: "team-a", teamVersionId: "version-a", deploymentId: "deployment-a",
    controllerMode: mode, controllerRef });
  const lifecycleDecisionHash = "c".repeat(64);
  fixture.add("evidenceLifecycleProjections", { _id: "lifecycle-a",
    decisionHash: lifecycleDecisionHash, strategyAccountId: "acct-a",
    artifactId: "proposal:analysis-a", sink: "convex.analysis_projection",
    outcome: "allow", expiresAt: Date.now() + 60_000,
    sanitizedPayloadHash: await canonicalTaggedHash({ artifact_type: "trade_proposal", content: payloadJson }) });
  const bindings = { analysis_decision_hash: "a".repeat(64), market: "BTC-USD",
    policy_version: "1", venue: "gmx" };
  const safetyRequest = { proposal, analysis_id: "analysis-a" };
  const receipt = async (operation: "propose" | "request_approval", decisionHash: string,
    subjectKey: string) => {
    fixture.add("safetyEnvelopeProjections", { _id: `safety-${operation}`,
      decisionHash, schemaVersion: 2, matrixVersion: "dependency-safety-v2",
      operation, subjectKey, strategyAccountId: "acct-a", expiresAt: Date.now() + 60_000,
      bindingsJson: JSON.stringify(bindings),
      bindingHash: createHash("sha256").update(JSON.stringify(bindings)).digest("hex"),
      requestHash: await safetyRequestHash(operation, safetyRequest, bindings),
      mode: "enforce", outcome: "allow" });
  };
  await receipt("propose", "d".repeat(64), "analysis-a");
  if (mode === "approval_required") await receipt("request_approval", "e".repeat(64), "approval:analysis-a");
  const args = { jobId: "job-a", strategyAccountId: "acct-a", analysisId: "analysis-a",
    policyVersion: 1, teamId: "team-a", teamVersionId: "version-a",
    deploymentId: "deployment-a", marketId: "BTC-USD", side: "short", payloadJson,
    confidence: 0.8, consensus: -0.72, agreementStrength: 0.72,
    controllerRef, controllerMode: mode, idempotencyKey: "proposal:analysis-a",
    expiresAt: Date.now() + 60_000, proposalSafetyDecisionHash: "d".repeat(64),
    approvalSafetyDecisionHash: mode === "approval_required" ? "e".repeat(64) : undefined,
    analysisSafetyDecisionHash: "a".repeat(64), lifecycleDecisionHash };
  return { ...fixture, args };
}

test("real proposal persistence routes all three modes and keeps bearish score signed", async () => {
  for (const [mode, expected] of [["shadow", "simulated"],
    ["approval_required", "pending_approval"], ["autopilot", "approved"]] as const) {
    const { ctx, rows, args } = await proposalFixture(mode);
    const first = await invoke(recordTradeProposal, ctx, args);
    assert.equal(first.status, expected);
    const saved = rows.get("tradeProposals")![0];
    assert.equal(saved.consensus, -0.72);
    assert.equal(saved.agreementStrength, 0.72);
    assert.equal(saved.controllerMode, mode);
    assert.deepEqual(saved.controllerRef, args.controllerRef);
    assert.equal(rows.get("approvalRequests")?.length ?? 0, mode === "approval_required" ? 1 : 0);
    const retry = await invoke(recordTradeProposal, ctx, args);
    assert.equal(retry.proposalId, first.proposalId);
    assert.equal(retry.duplicate, true);
  }
});

test("proposal mutation refuses foreign job binding and changed deployment mode", async () => {
  const { ctx, args, rows } = await proposalFixture("approval_required");
  await assert.rejects(invoke(recordTradeProposal, ctx,
    { ...args, jobId: "foreign-job" }), /completed analysis job/);
  rows.get("agentMarketDeployments")![0].mode = "autopilot";
  await assert.rejects(invoke(recordTradeProposal, ctx, args), /mode changed/);
  assert.equal(rows.get("tradeProposals")?.length ?? 0, 0);
});

test("proposal payload identity must match authenticated job fields before receipt lookup", async () => {
  for (const changed of [
    { account_id: "acct-b" }, { market: "ETH-USD" }, { side: "long" },
  ]) {
    const { ctx, args, rows } = await proposalFixture("shadow");
    const payloadJson = JSON.stringify({ ...JSON.parse(args.payloadJson), ...changed });
    await assert.rejects(invoke(recordTradeProposal, ctx, { ...args, payloadJson }),
      /proposal payload (account|market|side|identity)/i);
    assert.equal(rows.get("tradeProposals")?.length ?? 0, 0);
  }
});

test("idempotent proposal retry rejects changed payload with the same controller", async () => {
  const { ctx, args } = await proposalFixture("shadow");
  await invoke(recordTradeProposal, ctx, args);
  const changedPayload = JSON.stringify({ ...JSON.parse(args.payloadJson),
    size_usd: 9_999 });
  await assert.rejects(invoke(recordTradeProposal, ctx,
    { ...args, payloadJson: changedPayload }), /idempotency.*conflict/i);
});

test("approval is owner-scoped, expires, and rejects changed mode", async () => {
  const { ctx, args, rows } = await proposalFixture("approval_required");
  const created = await invoke(recordTradeProposal, ctx, args);
  const bob = store("bob").ctx;
  (bob as any).db = (ctx as any).db;
  await assert.rejects(invoke(decideTradeProposal, bob,
    { proposalId: created.proposalId, decision: "approved" }), /Proposal not found/);
  rows.get("tradeProposals")![0].expiresAt = Date.now() - 1;
  await assert.rejects(invoke(decideTradeProposal, ctx,
    { proposalId: created.proposalId, decision: "approved" }), /not awaiting approval/);
  rows.get("tradeProposals")![0].expiresAt = Date.now() + 60_000;
  rows.get("agentMarketDeployments")![0].mode = "autopilot";
  await assert.rejects(invoke(decideTradeProposal, ctx,
    { proposalId: created.proposalId, decision: "approved" }), /authority changed/);
  rows.get("agentMarketDeployments")![0].mode = "approval_required";
  const approved = await invoke(decideTradeProposal, ctx,
    { proposalId: created.proposalId, decision: "approved" });
  assert.equal(approved.status, "approved");
  assert.equal(rows.get("approvalRequests")![0].status, "approved");
});

test("managed proposals preserve assignment mode and require native authority before approval", async () => {
  for (const controllerMode of ["shadow", "autopilot"] as const) {
    const fixture = store();
    const { ctx, rows } = fixture;
    const policyJson = JSON.stringify({ allowedMarkets: ["BTC-USD"] });
    const ref = { schemaVersion: 1 as const, environment: "live" as const,
      strategyAccountId: "acct-a", controllerKind: "managed_program" as const,
      controllerId: "assignment-a", controllerVersionId: "program-version-a", contentHash: "f".repeat(64) };
    fixture.add("programAssignments", { _id: "assignment-a", strategyAccountId: "acct-a",
      userId: "user-a", programVersionId: "program-version-a", status: "active", source: "explicit",
      controllerMode });
    fixture.add("tradingProgramVersions", { _id: "program-version-a", programId: "program-a",
      version: 2, contentHash: ref.contentHash, policyJson });
    const payloadJson = JSON.stringify({ account_id: "acct-a", analysis_id: "managed-analysis-a",
      market: "BTC-USD", side: "long", candidate_venues: ["gmx"], size_usd: 10 });
    const proposal = JSON.parse(payloadJson);
    fixture.add("analysisJobs", { _id: "managed-job-a", strategyAccountId: "acct-a", userId: "user-a",
      scope: "private", status: "completed", analysisId: "managed-analysis-a",
      programAssignmentId: "assignment-a", programVersionId: "program-version-a",
      controllerMode, controllerRef: ref });
    const lifecycleDecisionHash = "c".repeat(64);
    fixture.add("evidenceLifecycleProjections", { _id: "managed-lifecycle-a",
      decisionHash: lifecycleDecisionHash, strategyAccountId: "acct-a",
      artifactId: "proposal:managed-analysis-a", sink: "convex.analysis_projection",
      outcome: "allow", expiresAt: Date.now() + 60_000,
      sanitizedPayloadHash: await canonicalTaggedHash({ artifact_type: "trade_proposal", content: payloadJson }) });
    const bindings = { analysis_decision_hash: "a".repeat(64), market: "BTC-USD",
      policy_version: "2", venue: "gmx" };
    fixture.add("safetyEnvelopeProjections", { _id: "managed-safety-a", decisionHash: "d".repeat(64),
      schemaVersion: 2, matrixVersion: "dependency-safety-v2", operation: "propose",
      subjectKey: "managed-analysis-a", strategyAccountId: "acct-a", expiresAt: Date.now() + 60_000,
      bindingsJson: JSON.stringify(bindings),
      bindingHash: createHash("sha256").update(JSON.stringify(bindings)).digest("hex"),
      requestHash: await safetyRequestHash("propose", { proposal, analysis_id: "managed-analysis-a" }, bindings),
      mode: "enforce", outcome: "allow" });
    const args = { jobId: "managed-job-a", strategyAccountId: "acct-a", analysisId: "managed-analysis-a",
      policyVersion: 2, programAssignmentId: "assignment-a", programVersionId: "program-version-a",
      marketId: "BTC-USD", side: "long", payloadJson, confidence: 0.8, consensus: 0.7,
      agreementStrength: 0.7, controllerRef: ref, controllerMode,
      idempotencyKey: "proposal:managed-analysis-a", expiresAt: Date.now() + 60_000,
      proposalSafetyDecisionHash: "d".repeat(64), analysisSafetyDecisionHash: "a".repeat(64),
      lifecycleDecisionHash };
    const first = await invoke(recordTradeProposal, ctx, args);
    assert.equal(first.status, controllerMode === "shadow" ? "simulated" : "blocked");
    const saved = rows.get("tradeProposals")![0];
    assert.equal(saved.programAssignmentId, "assignment-a");
    assert.equal(saved.programVersionId, "program-version-a");
    assert.equal(saved.controllerRef.controllerKind, "managed_program");
    assert.equal(saved.controllerMode, controllerMode);
    assert.equal(saved.teamId, undefined);
    assert.equal(saved.deploymentId, undefined);
    assert.equal(rows.get("approvalRequests")?.length ?? 0, 0);
    const retry = await invoke(recordTradeProposal, ctx, args);
    assert.equal(retry.duplicate, true);
    await assert.rejects(invoke(recordTradeProposal, ctx,
      { ...args, programVersionId: "other-version" }), /idempotency.*conflict/i);
  }
});
