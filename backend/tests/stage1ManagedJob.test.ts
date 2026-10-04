import assert from "node:assert/strict";
import { test } from "node:test";
import { requestManagedProgramAnalysis } from "../convex/agentMutations";
import { setManagedProgramMode, setShadowCadence } from "../convex/managedProgramControl";
import { enqueueScheduledAnalysis, getScheduleProfile } from "../convex/agentRuntime";
import { estimateModelRouting, parseModelRouting } from "../convex/helpers/modelRouting";
import { defaultTeamConfig } from "../convex/helpers/teamConfig";
import { controllerHash } from "../lib/programOwnership";
import { getAgentExecutionContext } from "../convex/agentRuntime";

type Row = Record<string, any> & { _id: string };
const invoke = (fn: unknown, ctx: unknown, args: any) =>
  (fn as { _handler: (ctx: unknown, args: any) => Promise<any> })._handler(ctx, args);

async function fixture() {
  const rows = new Map<string, Row[]>();
  const scheduled: Array<Record<string, unknown>> = [];
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  let nextId = 1;
  const routes = JSON.stringify({ schemaVersion: 2, routes: [
    { slot: "specialist_default", provider: "deepseek", model: "deepseek-v4-flash", credentialSource: "platform", maxOutputTokens: 700,
      inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 },
    { slot: "role:technical_trend", provider: "openai", model: "gpt-5.6-sol", credentialSource: "platform", maxOutputTokens: 700,
      inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 },
    { slot: "synthesis", provider: "openai", model: "gpt-5.6-sol", credentialSource: "platform", maxOutputTokens: 1200,
      inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 },
  ] });
  const teamConfig = { ...defaultTeamConfig("focus", routes), markets: ["BTC-USD"] };
  const modelConfiguration = { routesJson: routes, pricingVersion: "price-v1", preset: "custom" };
  const policyJson = JSON.stringify({ allowedMarkets: ["BTC-USD"] });
  const teamConfigJson = JSON.stringify(teamConfig);
  const modelConfigurationJson = JSON.stringify(modelConfiguration);
  const teamConfigHash = await controllerHash({ content: teamConfigJson });
  const modelConfigurationHash = await controllerHash({ content: modelConfigurationJson });
  const policyHash = await controllerHash({ content: policyJson });
  const manifest = { schemaVersion: 1, controllerKind: "managed_program", programId: "program-a", version: 2,
    sourceStrategyAccountId: "source-a", teamVersionId: "team-ver-source", modelConfigurationId: "model-source",
    policyId: "policy-source", strategyArtifactHash: "a".repeat(64), adapterProfileHash: "b".repeat(64),
    runtimeCompatibility: "agent-v1", teamConfigHash, modelConfigurationHash, policyHash };
  const contentHash = await controllerHash(manifest);
  add("users", { _id: "user-a", authSubject: "alice" });
  add("strategyAccounts", { _id: "acct-a", userId: "user-a", status: "active", emergencyStop: false });
  add("strategyAccounts", { _id: "source-a", userId: "user-source", status: "active", emergencyStop: false });
  add("creditAccounts", { _id: "credit-a", userId: "user-a", balance: 100, reserved: 0 });
  add("programAssignments", { _id: "assignment-a", strategyAccountId: "acct-a", userId: "user-a",
    programVersionId: "program-version-a", status: "active", shadowCadenceEnabled: true,
    source: "explicit", updatedAt: 123 });
  add("tradingProgramVersions", { _id: "program-version-a", ...manifest,
    teamConfigJson, modelConfigurationJson, policyJson, contentHash });
  add("tradingPrograms", { _id: "program-a", name: "Program" });
  add("agentTeamVersions", { _id: "team-ver-source", teamId: "team-source", strategyAccountId: "source-a" });
  add("agentModelConfigurations", { _id: "model-source", strategyAccountId: "source-a" });
  add("automationPolicies", { _id: "policy-source", strategyAccountId: "source-a", policyJson });
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = await db.get(id);
      if (!row) throw new Error(`Missing ${id}`);
      Object.assign(row, value);
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${nextId++}`;
      add(table, { _id: id, ...value });
      return id;
    },
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
  return { ctx: { auth: { getUserIdentity: async () => ({ subject: "alice" }) }, db,
      scheduler: { runAfter: async (_delay: number, _action: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      } } }, rows, scheduled,
    modelConfiguration, teamConfig };
}

test("owned Shadow consent schedules only an exact active assignment", async () => {
  const { ctx, rows, scheduled } = await fixture();
  const assignment = rows.get("programAssignments")![0];
  assignment.shadowCadenceEnabled = false;
  await assert.rejects(invoke(setShadowCadence, ctx,
    { assignmentId: "assignment-a", enabled: true, confirmed: false }), /Confirm managed Shadow/);
  assert.equal(assignment.shadowCadenceEnabled, false);
  const started = await invoke(setShadowCadence, ctx,
    { assignmentId: "assignment-a", enabled: true, confirmed: true });
  assert.equal(started.enabled, true);
  assert.equal(assignment.shadowCadenceEnabled, true);
  const stopped = await invoke(setShadowCadence, ctx,
    { assignmentId: "assignment-a", enabled: false, confirmed: false });
  assert.equal(stopped.enabled, false);
  assert.equal(assignment.shadowCadenceEnabled, false);
  assert.deepEqual(scheduled, [{ assignmentId: "assignment-a" }, { assignmentId: "assignment-a" }]);
});

test("managed analysis request records the exact active assignment/version in Shadow mode", async () => {
  const { ctx, rows, modelConfiguration, teamConfig } = await fixture();
  const routeEstimate = estimateModelRouting(parseModelRouting(modelConfiguration.routesJson, true),
    "focus", teamConfig.roles);
  const args = { marketId: "BTC-USD", confirmed: true,
    pricingVersion: modelConfiguration.pricingVersion,
    estimatedCostMicrousd: routeEstimate.estimatedProviderCostMicrousd };
  const first = await invoke(requestManagedProgramAnalysis, ctx, args);
  assert.equal(first.deduplicated, false);
  const job = rows.get("analysisJobs")![0];
  assert.equal(job.scope, "private");
  assert.equal(job.controllerRef.controllerKind, "managed_program");
  assert.equal(job.controllerRef.controllerId, "assignment-a");
  assert.equal(job.controllerRef.controllerVersionId, "program-version-a");
  assert.equal(job.controllerMode, "shadow");
  assert.equal(job.programAssignmentId, "assignment-a");
  assert.equal(job.programVersionId, "program-version-a");
  assert.equal(job.teamId, undefined);
  const retry = await invoke(requestManagedProgramAnalysis, ctx, args);
  assert.equal(retry.jobId, first.jobId);
  assert.equal(retry.deduplicated, true);
  await assert.rejects(invoke(requestManagedProgramAnalysis, ctx,
    { ...args, marketId: "ETH-USD" }), /does not allow analysis/);
});

test("model release changes the next job without changing the customer's authority or an existing job", async () => {
  const { ctx, rows, modelConfiguration, teamConfig } = await fixture();
  const authority = rows.get("tradingProgramVersions")![0];
  const program = rows.get("tradingPrograms")![0];
  const newRouting = JSON.parse(modelConfiguration.routesJson);
  newRouting.routes[0] = { ...newRouting.routes[0], provider: "openai", model: "gpt-5.6-sol" };
  const modelConfigurationJson = JSON.stringify({ ...modelConfiguration,
    routesJson: JSON.stringify(newRouting) });
  const modelConfigurationHash = await controllerHash({ content: modelConfigurationJson });
  const release: Row = { ...authority, _id: "agent-release-b", version: authority.version + 1,
    modelConfigurationId: "model-release-b", modelConfigurationJson, modelConfigurationHash };
  release.contentHash = await controllerHash({
    schemaVersion: 1, controllerKind: "managed_program", programId: release.programId,
    version: release.version, sourceStrategyAccountId: release.sourceStrategyAccountId,
    teamVersionId: release.teamVersionId, modelConfigurationId: release.modelConfigurationId,
    policyId: release.policyId, strategyArtifactHash: release.strategyArtifactHash,
    adapterProfileHash: release.adapterProfileHash, runtimeCompatibility: release.runtimeCompatibility,
    teamConfigHash: release.teamConfigHash, modelConfigurationHash, policyHash: release.policyHash,
  });
  rows.get("tradingProgramVersions")!.push(release);
  rows.get("agentModelConfigurations")!.push({ _id: "model-release-b", strategyAccountId: "source-a" });
  program.releasedVersionId = release._id;
  const estimate = estimateModelRouting(parseModelRouting(JSON.parse(modelConfigurationJson).routesJson,
    true), "focus", teamConfig.roles);
  const result = await invoke(requestManagedProgramAnalysis, ctx, {
    marketId: "BTC-USD", confirmed: true, pricingVersion: modelConfiguration.pricingVersion,
    estimatedCostMicrousd: estimate.estimatedProviderCostMicrousd,
  });
  const job = rows.get("analysisJobs")!.find((row) => row._id === result.jobId)!;
  assert.equal(job.programVersionId, authority._id);
  assert.equal(job.controllerRef.contentHash, authority.contentHash);
  assert.equal(job.agentReleaseVersionId, release._id);
  program.releasedVersionId = authority._id;
  const context = await invoke(getAgentExecutionContext, ctx,
    { strategyAccountId: "acct-a", jobId: job._id });
  assert.equal(context.managedProgram.agentRelease.versionId, release._id);
  assert.equal(context.modelConfiguration.routes.routes[0].provider, "openai");
  assert.equal(context.controllerRef.contentHash, authority.contentHash);
  const legacyJob = { ...job, _id: "legacy-job", agentReleaseVersionId: undefined };
  rows.get("analysisJobs")!.push(legacyJob);
  const legacy = await invoke(getAgentExecutionContext, ctx,
    { strategyAccountId: "acct-a", jobId: legacyJob._id });
  assert.equal(legacy.managedProgram.agentRelease.versionId, authority._id);
  program.releasedVersionId = release._id;
  release.policyJson = "{}";
  await assert.rejects(invoke(requestManagedProgramAnalysis, ctx, {
    marketId: "BTC-USD", confirmed: true, pricingVersion: modelConfiguration.pricingVersion,
    estimatedCostMicrousd: estimate.estimatedProviderCostMicrousd,
  }), /incompatible with this account/);
});

test("managed analysis derives Autopilot from the explicitly owned assignment", async () => {
  const { ctx, rows, modelConfiguration, teamConfig, scheduled } = await fixture();
  const assignment = rows.get("programAssignments")![0];
  await assert.rejects(invoke(setManagedProgramMode, ctx, {
    assignmentId: assignment._id, controllerMode: "autopilot", confirmed: false,
  }), /Confirm changing managed mode/);
  assert.equal(assignment.controllerMode, undefined);
  const changed = await invoke(setManagedProgramMode, ctx, {
    assignmentId: assignment._id, controllerMode: "autopilot", confirmed: true,
  });
  assert.equal(changed.controllerMode, "autopilot");
  assert.equal(assignment.controllerMode, "autopilot");
  assert.equal(assignment.shadowCadenceEnabled, false);
  assert.equal(scheduled.length, 1);

  const routeEstimate = estimateModelRouting(parseModelRouting(modelConfiguration.routesJson, true),
    "focus", teamConfig.roles);
  const result = await invoke(requestManagedProgramAnalysis, ctx, {
    marketId: "BTC-USD", confirmed: true, pricingVersion: modelConfiguration.pricingVersion,
    estimatedCostMicrousd: routeEstimate.estimatedProviderCostMicrousd,
  });
  const job = rows.get("analysisJobs")![0];
  assert.equal(result.deduplicated, false);
  assert.equal(job.controllerMode, "autopilot");
  assert.equal(job.programAssignmentId, assignment._id);
  await assert.rejects(invoke(requestManagedProgramAnalysis, ctx, {
    marketId: "BTC-USD", controllerMode: "shadow", confirmed: true,
    pricingVersion: modelConfiguration.pricingVersion,
    estimatedCostMicrousd: routeEstimate.estimatedProviderCostMicrousd,
  }), /mode changed/);
});

test("managed Temporal cadence reads and enqueues only the exact active Shadow assignment", async () => {
  const { ctx, rows } = await fixture();
  const version = rows.get("tradingProgramVersions")![0];
  const controllerRef = { schemaVersion: 1, environment: "live", strategyAccountId: "acct-a",
    controllerKind: "managed_program", controllerId: "assignment-a",
    controllerVersionId: "program-version-a", contentHash: version.contentHash };
  const binding = { assignmentId: "assignment-a", programVersionId: "program-version-a",
    marketId: "BTC-USD", scheduleRevision: 123, controllerRef };
  const context = await invoke(getScheduleProfile, ctx, binding);
  assert.equal(context.profile.authorityMode, "shadow");
  assert.equal(context.managedProgram.assignment.assignmentId, "assignment-a");
  assert.equal(context.managedProgram.version._id, "program-version-a");
  assert.deepEqual(context.markets, ["BTC-USD"]);

  const stale = await invoke(getScheduleProfile, ctx, { ...binding, scheduleRevision: 122 });
  assert.equal(stale, null);
  const staleVersion = await invoke(getScheduleProfile, ctx, { ...binding,
    programVersionId: "different-version" });
  assert.equal(staleVersion, null);
  const enqueued = await invoke(enqueueScheduledAnalysis, ctx, {
    ...binding, scheduledAtMs: 1_790_000_000_000, trigger: "cadence:temporal",
  });
  assert.equal(enqueued.created, true);
  assert.equal(enqueued.job.controllerMode, "shadow");
  assert.equal(enqueued.job.programAssignmentId, "assignment-a");
  assert.equal(enqueued.job.programVersionId, "program-version-a");
  assert.equal(enqueued.job.teamId, undefined);
  const duplicate = await invoke(enqueueScheduledAnalysis, ctx, {
    ...binding, scheduledAtMs: 1_790_000_000_000, trigger: "cadence:temporal",
  });
  assert.equal(duplicate.reason, "duplicate_schedule");

  rows.get("programAssignments")![0].shadowCadenceEnabled = false;
  rows.get("programAssignments")![0].updatedAt = 124;
  const stopped = await invoke(enqueueScheduledAnalysis, ctx, {
    ...binding, scheduledAtMs: 1_790_000_060_000, trigger: "cadence:temporal",
  });
  assert.equal(stopped.reason, "managed_assignment_changed");
  assert.equal(rows.get("analysisJobs")!.length, 1);
});

test("managed Temporal cadence carries the owned Autopilot mode", async () => {
  const { ctx, rows } = await fixture();
  const assignment = rows.get("programAssignments")![0];
  assignment.controllerMode = "autopilot";
  const version = rows.get("tradingProgramVersions")![0];
  const controllerRef = { schemaVersion: 1, environment: "live", strategyAccountId: "acct-a",
    controllerKind: "managed_program", controllerId: "assignment-a",
    controllerVersionId: "program-version-a", contentHash: version.contentHash };
  const binding = { assignmentId: "assignment-a", programVersionId: "program-version-a",
    marketId: "BTC-USD", scheduleRevision: 123, controllerRef };
  const context = await invoke(getScheduleProfile, ctx, binding);
  assert.equal(context.profile.authorityMode, "autopilot");
  assert.equal(context.managedProgram.assignment.controllerMode, "autopilot");
  const enqueued = await invoke(enqueueScheduledAnalysis, ctx, {
    ...binding, scheduledAtMs: 1_790_000_000_000, trigger: "cadence:temporal",
  });
  assert.equal(enqueued.created, true);
  assert.equal(enqueued.job.controllerMode, "autopilot");
});
