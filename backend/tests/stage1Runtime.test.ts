import assert from "node:assert/strict";
import { test } from "node:test";
import { enqueueScheduledAnalysis, getAgentExecutionContext,
  getTradeProposalExecutionContext } from "../convex/agentRuntime";
import { controllerHash } from "../lib/programOwnership";
import { canonicalTaggedHash } from "../convex/helpers/dependencySafetyVerification";
import { defaultTeamConfig } from "../convex/helpers/teamConfig";
import { DEFAULT_AUTOMATION_POLICY } from "../convex/helpers/agentPolicy";
import { managedProgramActivationAuthorityHash } from "../convex/mobile";

type Row = Record<string, any> & { _id: string };
const invoke = (fn: unknown, ctx: unknown, args: any) =>
  (fn as { _handler: (ctx: unknown, args: any) => Promise<any> })._handler(ctx, args);

function runtimeFixture() {
  const rows = new Map<string, Row[]>();
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  let nextId = 1;
  add("strategyAccounts", { _id: "acct-a", userId: "user-a", status: "active", emergencyStop: false });
  add("strategyAccounts", { _id: "acct-b", userId: "user-b", status: "active", emergencyStop: false });
  add("automationPolicies", { _id: "policy-a", strategyAccountId: "acct-a", status: "active",
    version: 1, policyJson: "{}" });
  add("creditAccounts", { _id: "credit-a", userId: "user-a", balance: 100, reserved: 0 });
  for (const [team, mode] of [["shadow", "shadow"], ["approval", "approval_required"],
    ["auto", "autopilot"]] as const) {
    add("agentProfiles", { _id: `team-${team}`, strategyAccountId: "acct-a", userId: "user-a",
      paused: false, lifecycleStatus: "active", scheduleRevision: 1,
      watchMarkets: ["BTC-USD"], authorityMode: "shadow" });
    add("agentTeamVersions", { _id: `version-${team}`, teamId: `team-${team}`,
      strategyAccountId: "acct-a", userId: "user-a", configJson: '{"tier":"focus"}' });
    add("agentMarketDeployments", { _id: `deployment-${team}`, teamId: `team-${team}`,
      teamVersionId: `version-${team}`, strategyAccountId: "acct-a", userId: "user-a",
      marketId: "BTC-USD", status: "active", mode });
  }
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    patch: async (id: string, values: Record<string, unknown>) => {
      const row = await db.get(id);
      if (!row) throw new Error(`Missing ${id}`);
      Object.assign(row, values);
    },
    insert: async (table: string, values: Record<string, unknown>) => {
      const id = `${table}-${nextId++}`;
      add(table, { _id: id, ...values });
      return id;
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
  return { ctx: { db }, rows };
}

test("three customer modes keep exact deployment identity through scheduled job and context", async () => {
  const { ctx } = runtimeFixture();
  for (const [team, mode] of [["shadow", "shadow"], ["approval", "approval_required"],
    ["auto", "autopilot"]] as const) {
    const result = await invoke(enqueueScheduledAnalysis, ctx, {
      profileId: `team-${team}`, marketId: "BTC-USD", scheduleRevision: 1,
      trigger: "cadence:temporal",
    });
    assert.equal(result.created, true);
    const job = result.job;
    assert.equal(job.controllerMode, mode);
    assert.equal(job.teamId, `team-${team}`);
    assert.equal(job.teamVersionId, `version-${team}`);
    assert.equal(job.controllerRef.controllerId, `deployment-${team}`);
    assert.equal(job.controllerRef.controllerVersionId, `version-${team}`);
    const context = await invoke(getAgentExecutionContext, ctx,
      { strategyAccountId: "acct-a", jobId: job._id });
    assert.equal(context.profile.authorityMode, mode);
    assert.deepEqual(context.controllerRef, job.controllerRef);
    assert.equal(await invoke(getAgentExecutionContext, ctx,
      { strategyAccountId: "acct-b", jobId: job._id }), null);
  }
});

test("changed mode and incomplete legacy job block before analysis context", async () => {
  const { ctx, rows } = runtimeFixture();
  const { job } = await invoke(enqueueScheduledAnalysis, ctx, {
    profileId: "team-approval", marketId: "BTC-USD", scheduleRevision: 1,
    trigger: "cadence:temporal",
  });
  const deployments = rows.get("agentMarketDeployments")!;
  deployments.find((row) => row._id === "deployment-approval")!.mode = "autopilot";
  assert.equal(await invoke(getAgentExecutionContext, ctx,
    { strategyAccountId: "acct-a", jobId: job._id }), null);
  rows.set("analysisJobs", [...rows.get("analysisJobs")!, {
    _id: "legacy-unbound", strategyAccountId: "acct-a", scope: "private", marketId: "BTC-USD",
  }]);
  assert.equal(await invoke(getAgentExecutionContext, ctx,
    { strategyAccountId: "acct-a", jobId: "legacy-unbound" }), null);
});

test("managed execution context preserves Shadow binding and denies live proposals without native authority", async () => {
  const rows = new Map<string, Row[]>();
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  const routes = JSON.stringify({ schemaVersion: 2, routes: [
    { slot: "specialist_default", provider: "deepseek", model: "deepseek-v4-flash", credentialSource: "platform", maxOutputTokens: 700,
      inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 },
    { slot: "role:technical_trend", provider: "openai", model: "gpt-5.6-sol", credentialSource: "platform", maxOutputTokens: 700,
      inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 },
    { slot: "synthesis", provider: "openai", model: "gpt-5.6-sol", credentialSource: "platform", maxOutputTokens: 1200,
      inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 },
  ] });
  const teamConfig = { ...defaultTeamConfig("focus", routes), markets: ["BTC-USD"] };
  const teamConfigJson = JSON.stringify(teamConfig);
  const modelConfigurationJson = JSON.stringify({ routesJson: routes, pricingVersion: "price-v1", preset: "custom" });
  const policyJson = JSON.stringify({ ...DEFAULT_AUTOMATION_POLICY,
    allowedMarkets: ["BTC-USD"], allowedVenues: ["uniswap"] });
  const version: any = { _id: "program-version-a", programId: "program-a", version: 2,
    sourceStrategyAccountId: "source-account", teamVersionId: "source-team-version",
    modelConfigurationId: "source-model", policyId: "source-policy",
    strategyArtifactHash: "a".repeat(64), adapterProfileHash: "b".repeat(64),
    runtimeCompatibility: "agent-v1", teamConfigJson, modelConfigurationJson, policyJson,
    teamConfigHash: await controllerHash({ content: teamConfigJson }),
    modelConfigurationHash: await controllerHash({ content: modelConfigurationJson }),
    policyHash: await controllerHash({ content: policyJson }) };
  const manifest = { schemaVersion: 1, controllerKind: "managed_program", programId: version.programId,
    version: version.version, sourceStrategyAccountId: version.sourceStrategyAccountId,
    teamVersionId: version.teamVersionId, modelConfigurationId: version.modelConfigurationId,
    policyId: version.policyId, strategyArtifactHash: version.strategyArtifactHash,
    adapterProfileHash: version.adapterProfileHash, runtimeCompatibility: version.runtimeCompatibility,
    teamConfigHash: version.teamConfigHash, modelConfigurationHash: version.modelConfigurationHash,
    policyHash: version.policyHash };
  version.contentHash = await controllerHash(manifest);
  add("strategyAccounts", { _id: "acct-target", userId: "user-target", status: "active", emergencyStop: false });
  add("strategyAccounts", { _id: "source-account", userId: "source-user", status: "active", emergencyStop: false });
  add("creditAccounts", { _id: "credit-target", userId: "user-target", balance: 100, reserved: 0 });
  add("users", { _id: "source-user", authSubject: "operator" });
  add("tradingPrograms", { _id: "program-a", name: "Program", createdBySubject: "operator" });
  add("tradingProgramVersions", version);
  add("programAssignments", { _id: "assignment-a", strategyAccountId: "acct-target", userId: "user-target",
    programVersionId: version._id, status: "active", source: "explicit" });
  add("agentTeamVersions", { _id: "source-team-version", teamId: "source-team",
    strategyAccountId: "source-account", userId: "source-user", configJson: teamConfigJson });
  add("agentModelConfigurations", { _id: "source-model", strategyAccountId: "source-account" });
  add("automationPolicies", { _id: "source-policy", strategyAccountId: "source-account", policyJson });
  add("analysisJobs", { _id: "job-managed", strategyAccountId: "acct-target", userId: "user-target",
    scope: "private", marketId: "BTC-USD", tier: "focus", programAssignmentId: "assignment-a",
    programVersionId: version._id, controllerMode: "shadow", controllerRef: {
      schemaVersion: 1, environment: "live", strategyAccountId: "acct-target",
      controllerKind: "managed_program", controllerId: "assignment-a",
      controllerVersionId: version._id, contentHash: version.contentHash },
  });
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    query: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        withIndex: (_name: string, select: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { filters.push([key, value]); return q; } };
          select(q); return chain;
        },
        first: async () => (rows.get(table) ?? []).find((row) => filters.every(([key, value]) => row[key] === value)) ?? null,
        collect: async () => (rows.get(table) ?? []).filter((row) => filters.every(([key, value]) => row[key] === value)),
      };
      return chain;
    },
  };
  const ctx = { db };
  const context = await invoke(getAgentExecutionContext, ctx,
    { strategyAccountId: "acct-target", jobId: "job-managed" });
  assert.equal(context.profile.authorityMode, "shadow");
  assert.equal(context.controllerRef.controllerKind, "managed_program");
  assert.equal(context.managedProgram.assignmentId, "assignment-a");
  assert.equal(context.managedProgram.version.programId, "program-a");
  assert.equal(context.policy.version, 2);
  assert.equal(context.modelConfiguration.pricingVersion, "price-v1");

  const assignment = rows.get("programAssignments")![0];
  const job = rows.get("analysisJobs")![0];
  assignment.controllerMode = "autopilot";
  assignment.shadowCadenceEnabled = true;
  job.controllerMode = "autopilot";
  const payloadJson = JSON.stringify({ account_id: "acct-target", analysis_id: "analysis-managed",
    market: "BTC-USD", side: "long", candidate_venues: ["uniswap"] });
  const lifecycleDecisionHash = "c".repeat(64);
  add("evidenceLifecycleProjections", { _id: "lifecycle-managed", decisionHash: lifecycleDecisionHash,
    strategyAccountId: "acct-target", artifactId: "proposal:analysis-managed",
    sink: "convex.analysis_projection", outcome: "allow", expiresAt: Date.now() + 60_000,
    sanitizedPayloadHash: await canonicalTaggedHash({ artifact_type: "trade_proposal", content: payloadJson }) });
  add("tradeProposals", { _id: "proposal-managed", jobId: job._id,
    strategyAccountId: "acct-target", userId: "user-target", analysisId: "analysis-managed",
    programAssignmentId: assignment._id, programVersionId: version._id,
    marketId: "BTC-USD", controllerMode: "autopilot", controllerRef: job.controllerRef,
    lifecycleDecisionHash, payloadJson, status: "approved" });
  job.analysisId = "analysis-managed";
  job.status = "completed";
  const proposalContext = await invoke(getTradeProposalExecutionContext, ctx,
    { proposalId: "proposal-managed" });
  assert.equal(proposalContext, null);
  add("users", { _id: "user-target", authSubject: "target" });
  const ownerAddress = "0x1111111111111111111111111111111111111111";
  add("accountWallets", { _id: "wallet-target", userId: "user-target", ownerAddress,
    ownerVerifiedAt: Date.now(), walletProvider: "magic",
    accountMode: "eip7702", eip7702Delegated: true });
  add("venueAccounts", { _id: "venue-target", strategyAccountId: "acct-target",
    venue: "uniswap", ownerAddress, status: "ready", legacy: false, lastSyncStatus: "fresh" });
  add("venueIntegrations", { _id: "integration-target", strategyAccountId: "acct-target",
    venue: "uniswap", enabled: true, routingEnabled: true, authorityMode: "autopilot", status: "ready" });
  add("venuePermissions", { _id: "permission-target", strategyAccountId: "acct-target",
    venue: "uniswap", ownerAddress, authorityMode: "autopilot", chainId: 42161,
    status: "active", expiresAt: Date.now() + 60_000 });
  const receipt = { source: "native_finance_authority" as const, state: "ready" as const,
    strategyAccountId: "acct-target", assignmentId: "assignment-a",
    programVersionId: version._id, contentHash: version.contentHash, ownerAddress,
    financeSnapshotHash: "d".repeat(64), accountRevision: "7", writerEpoch: "2",
    authorityEpoch: "3", venue: "uniswap", venueAccountId: "venue-target",
    executionGrantId: "grant-00000001", executionGrantHash: "e".repeat(64),
    expiresAt: Date.now() + 60_000 };
  add("managedProgramActivationAuthorities", { _id: "authority-target", ...receipt,
    receiptHash: await managedProgramActivationAuthorityHash(receipt) });
  const admitted = await invoke(getTradeProposalExecutionContext, ctx,
    { proposalId: "proposal-managed" });
  assert.equal(admitted?.profile.authorityMode, "autopilot");
  assert.equal(admitted?.programAssignmentId, assignment._id);
  assert.equal(admitted?.nativeAuthority.ownerAddress, ownerAddress);
  assert.equal(admitted?.nativeAuthority.venueAccountId, "venue-target");
  assignment.shadowCadenceEnabled = false;
  assert.equal(await invoke(getTradeProposalExecutionContext, ctx,
    { proposalId: "proposal-managed" }), null);

  rows.get("programAssignments")![0].status = "paused";
  assert.equal(await invoke(getAgentExecutionContext, ctx,
    { strategyAccountId: "acct-target", jobId: "job-managed" }), null);
});
