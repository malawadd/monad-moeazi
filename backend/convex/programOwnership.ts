import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { controllerHash, mobileAssignmentState, type ProgramManifest } from "../lib/programOwnership";
import { customerControllerRef } from "../lib/programOwnership";
import { requireViewerStrategy } from "./model";
import { requireProgramActor } from "./helpers/programScope";
import { parseModelRouting, estimateModelRouting } from "./helpers/modelRouting";
import { parseAutomationPolicy } from "./helpers/agentPolicy";
import { validateTeamConfig } from "./helpers/teamConfig";

const compositionArgs = {
  sourceStrategyAccountId: v.id("strategyAccounts"),
  teamVersionId: v.id("agentTeamVersions"),
  modelConfigurationId: v.id("agentModelConfigurations"),
  policyId: v.id("automationPolicies"),
  strategyArtifactHash: v.string(), adapterProfileHash: v.string(), runtimeCompatibility: v.string(),
};

async function validateComposition(ctx: any, args: any, subject: string) {
  const source = await ctx.db.get(args.sourceStrategyAccountId);
  const user = await ctx.db.query("users").withIndex("by_authSubject", (q: any) => q.eq("authSubject", subject)).first();
  if (!source || !user || source.userId !== user._id) throw new Error("Program source account is not owned by this operator.");
  const [teamVersion, model, policy] = await Promise.all([
    ctx.db.get(args.teamVersionId), ctx.db.get(args.modelConfigurationId), ctx.db.get(args.policyId),
  ]);
  if (!teamVersion || !model || !policy || teamVersion.strategyAccountId !== source._id
      || model.strategyAccountId !== source._id || policy.strategyAccountId !== source._id) {
    throw new Error("Program references must belong to the source account.");
  }
  for (const hash of [args.strategyArtifactHash, args.adapterProfileHash]) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Program artifact hashes must be lowercase SHA-256.");
  }
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(args.runtimeCompatibility)) throw new Error("Invalid runtime compatibility identifier.");
}

function manifest(programId: string, version: number, row: any): ProgramManifest {
  return {
    schemaVersion: 1, controllerKind: "managed_program", programId, version,
    sourceStrategyAccountId: String(row.sourceStrategyAccountId),
    teamVersionId: String(row.teamVersionId), modelConfigurationId: String(row.modelConfigurationId),
    policyId: String(row.policyId), strategyArtifactHash: row.strategyArtifactHash,
    adapterProfileHash: row.adapterProfileHash, runtimeCompatibility: row.runtimeCompatibility,
    teamConfigHash: row.teamConfigHash, modelConfigurationHash: row.modelConfigurationHash,
    policyHash: row.policyHash,
  };
}

async function frozenContentHashes(ctx: any, row: any) {
  const [team, model, policy] = await Promise.all([
    ctx.db.get(row.teamVersionId), ctx.db.get(row.modelConfigurationId), ctx.db.get(row.policyId),
  ]);
  if (!team || !model || !policy) throw new Error("Program source version is unavailable.");
  const teamConfigJson = team.configJson;
  const modelConfigurationJson = JSON.stringify({ routesJson: model.routesJson,
    pricingVersion: model.pricingVersion, preset: model.preset });
  const policyJson = policy.policyJson;
  return { teamConfigJson, modelConfigurationJson, policyJson,
    teamConfigHash: await controllerHash({ content: teamConfigJson }),
    modelConfigurationHash: await controllerHash({ content: modelConfigurationJson }),
    policyHash: await controllerHash({ content: policyJson }) };
}

export const createProgramDraft = mutation({
  args: { name: v.string(), idempotencyKey: v.string(), ...compositionArgs },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "operator");
    await validateComposition(ctx, args, actor.subject);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80 || !/^[a-zA-Z0-9:_-]{16,128}$/.test(args.idempotencyKey)) {
      throw new Error("Program name or idempotency key is invalid.");
    }
    const requestHash = await controllerHash({ name,
      sourceStrategyAccountId: String(args.sourceStrategyAccountId), teamVersionId: String(args.teamVersionId),
      modelConfigurationId: String(args.modelConfigurationId), policyId: String(args.policyId),
      strategyArtifactHash: args.strategyArtifactHash, adapterProfileHash: args.adapterProfileHash,
      runtimeCompatibility: args.runtimeCompatibility });
    const existing = await ctx.db.query("tradingPrograms").withIndex("by_idempotencyKey", (q: any) => q.eq("idempotencyKey", args.idempotencyKey)).first();
    if (existing) {
      if (existing.createdBySubject !== actor.subject || existing.requestHash !== requestHash) {
        throw new Error("Program idempotency key conflicts with an existing request.");
      }
      return { programId: existing._id, duplicate: true };
    }
    const now = Date.now();
    const programId = await ctx.db.insert("tradingPrograms", { name, createdBySubject: actor.subject,
      idempotencyKey: args.idempotencyKey, requestHash, createdAt: now, updatedAt: now });
    const { sourceStrategyAccountId, teamVersionId, modelConfigurationId, policyId,
      strategyArtifactHash, adapterProfileHash, runtimeCompatibility } = args;
    await ctx.db.insert("tradingProgramDrafts", { programId, sourceStrategyAccountId, teamVersionId,
      modelConfigurationId, policyId, strategyArtifactHash, adapterProfileHash, runtimeCompatibility,
      revision: 1, updatedBySubject: actor.subject, updatedAt: now });
    return { programId, duplicate: false };
  },
});

export const updateProgramDraft = mutation({
  args: { programId: v.id("tradingPrograms"), expectedRevision: v.number(), ...compositionArgs },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "operator");
    const program = await ctx.db.get(args.programId);
    if (!program || program.createdBySubject !== actor.subject) throw new Error("Program not found.");
    await validateComposition(ctx, args, actor.subject);
    const draft = await ctx.db.query("tradingProgramDrafts").withIndex("by_programId", (q: any) => q.eq("programId", program._id)).first();
    if (!draft || draft.revision !== args.expectedRevision) throw new Error("Program draft revision changed.");
    const { sourceStrategyAccountId, teamVersionId, modelConfigurationId, policyId,
      strategyArtifactHash, adapterProfileHash, runtimeCompatibility } = args;
    await ctx.db.patch(draft._id, { sourceStrategyAccountId, teamVersionId, modelConfigurationId,
      policyId, strategyArtifactHash, adapterProfileHash, runtimeCompatibility,
      revision: draft.revision + 1, updatedBySubject: actor.subject, updatedAt: Date.now() });
    return { programId: program._id, revision: draft.revision + 1 };
  },
});

export const freezeProgramVersion = mutation({
  args: { programId: v.id("tradingPrograms"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "operator");
    const program = await ctx.db.get(args.programId);
    if (!program || program.createdBySubject !== actor.subject) throw new Error("Program not found.");
    const draft = await ctx.db.query("tradingProgramDrafts").withIndex("by_programId", (q: any) => q.eq("programId", program._id)).first();
    if (!draft || draft.revision !== args.expectedRevision) throw new Error("Program draft revision changed.");
    await validateComposition(ctx, draft, actor.subject);
    const frozen = { ...draft, ...await frozenContentHashes(ctx, draft) };
    const latest = await ctx.db.query("tradingProgramVersions").withIndex("by_programId", (q: any) => q.eq("programId", program._id)).order("desc").first();
    const version = (latest?.version ?? 0) + 1;
    const contentHash = await controllerHash(manifest(String(program._id), version, frozen));
    if (latest) {
      const previousAtVersion = await controllerHash(manifest(String(program._id), latest.version, frozen));
      if (previousAtVersion === latest.contentHash) return { programVersionId: latest._id, version: latest.version, contentHash: latest.contentHash, duplicate: true };
    }
    const { sourceStrategyAccountId, teamVersionId, modelConfigurationId, policyId,
      strategyArtifactHash, adapterProfileHash, runtimeCompatibility } = draft;
    const programVersionId = await ctx.db.insert("tradingProgramVersions", { programId: program._id,
      version, sourceStrategyAccountId, teamVersionId, modelConfigurationId, policyId,
      strategyArtifactHash, adapterProfileHash, runtimeCompatibility,
      teamConfigJson: frozen.teamConfigJson, modelConfigurationJson: frozen.modelConfigurationJson,
      policyJson: frozen.policyJson,
      teamConfigHash: frozen.teamConfigHash, modelConfigurationHash: frozen.modelConfigurationHash,
      policyHash: frozen.policyHash, contentHash,
      frozenBySubject: actor.subject, createdAt: Date.now() });
    return { programVersionId, version, contentHash, duplicate: false };
  },
});

export const getProgramAssignment = query({ args: {}, handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication is required.");
  const state = await requireViewerStrategy(ctx, identity.subject);
  if (!state.user || !state.strategyAccount) {
    return { assignmentState: "unassigned", assignmentId: null, programVersionId: null,
      controllerMode: null, controllerRef: null };
  }
  const rows = await ctx.db.query("programAssignments").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
  const selected = mobileAssignmentState(rows);
  if (!selected.assignment) {
    const paused = rows.filter((row) => row.status === "paused");
    if (paused.length === 1 && (paused[0].userId !== state.user._id
        || paused[0].strategyAccountId !== state.strategyAccount._id)) {
      return { assignmentState: "invalid_assignment", assignmentId: null, programVersionId: null,
        controllerMode: null, controllerRef: null };
    }
    return { assignmentState: paused.length === 1 && selected.reason === "unassigned" ? "paused" : selected.reason,
      assignmentId: paused.length === 1 ? paused[0]._id : null,
      programVersionId: paused.length === 1 ? paused[0].programVersionId : null,
      controllerMode: paused.length === 1 ? paused[0].controllerMode ?? "shadow" : null,
      controllerRef: null };
  }
  if (selected.assignment.userId !== state.user._id || selected.assignment.strategyAccountId !== state.strategyAccount._id) {
    return { assignmentState: "invalid_assignment", assignmentId: null, programVersionId: null,
      controllerMode: null, controllerRef: null };
  }
  const version = await ctx.db.get(selected.assignment.programVersionId);
  const program = version ? await ctx.db.get(version.programId) : null;
  if (!version || !program || !/^[0-9a-f]{64}$/.test(version.contentHash)) {
    return { assignmentState: "invalid_assignment", assignmentId: null, programVersionId: null,
      controllerMode: null, controllerRef: null };
  }
  return { assignmentState: "active", assignmentId: selected.assignment._id, programVersionId: version._id,
    controllerMode: selected.assignment.controllerMode ?? "shadow",
    controllerRef: { schemaVersion: 1, environment: "live", strategyAccountId: String(state.strategyAccount._id),
      controllerKind: "managed_program", controllerId: String(selected.assignment._id),
      controllerVersionId: String(version._id), contentHash: version.contentHash } };
} });

export const stagePausedAssignment = mutation({
  args: { strategyAccountId: v.id("strategyAccounts"), programVersionId: v.id("tradingProgramVersions") },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "release");
    const [account, version] = await Promise.all([
      ctx.db.get(args.strategyAccountId), ctx.db.get(args.programVersionId),
    ]);
    if (!account || !version || !await ctx.db.get(version.programId)) throw new Error("Account or frozen program not found.");
    const rows = await ctx.db.query("programAssignments").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", account._id)).collect();
    if (rows.some((row: any) => row.status === "active")) throw new Error("An active assignment needs a separate release migration.");
    const existing = rows.find((row: any) => row.programVersionId === version._id && row.status === "paused");
    if (existing) return { assignmentId: existing._id, status: "paused" as const, duplicate: true };
    const now = Date.now();
    const assignmentId = await ctx.db.insert("programAssignments", { strategyAccountId: account._id,
      userId: account.userId, programVersionId: version._id, status: "paused", source: "explicit",
      controllerMode: "shadow", shadowCadenceEnabled: false,
      assignedBySubject: actor.subject,
      createdAt: now, updatedAt: now });
    return { assignmentId, status: "paused" as const, duplicate: false };
  },
});

export const activateManagedProgramShadow = mutation({
  args: { assignmentId: v.id("programAssignments") },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "release");
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || assignment.status === "revoked") throw new Error("Paused managed assignment not found.");
    const [account, version] = await Promise.all([
      ctx.db.get(assignment.strategyAccountId), ctx.db.get(assignment.programVersionId),
    ]);
    if (!account || account.userId !== assignment.userId || !version
        || !await ctx.db.get(version.programId)) {
      throw new Error("Managed assignment identity or frozen program is invalid.");
    }
    if (version.runtimeCompatibility !== "agent-v1"
        || await controllerHash({ content: version.teamConfigJson }) !== version.teamConfigHash
        || await controllerHash({ content: version.modelConfigurationJson }) !== version.modelConfigurationHash
        || await controllerHash({ content: version.policyJson }) !== version.policyHash
        || await controllerHash(manifest(String(version.programId), version.version, version)) !== version.contentHash) {
      throw new Error("Frozen managed program failed Shadow runtime integrity checks.");
    }
    const [source, teamVersion, modelRow, policyRow] = await Promise.all([
      ctx.db.get(version.sourceStrategyAccountId), ctx.db.get(version.teamVersionId),
      ctx.db.get(version.modelConfigurationId), ctx.db.get(version.policyId),
    ]);
    if (!source || !teamVersion || !modelRow || !policyRow
        || teamVersion.strategyAccountId !== source._id || modelRow.strategyAccountId !== source._id
        || policyRow.strategyAccountId !== source._id) {
      throw new Error("Frozen program source references are unavailable or inconsistent.");
    }
    try {
      const teamConfig = validateTeamConfig(JSON.parse(version.teamConfigJson));
      const frozenModel = JSON.parse(version.modelConfigurationJson);
      if (typeof frozenModel.routesJson !== "string" || typeof frozenModel.pricingVersion !== "string") {
        throw new Error("Frozen model configuration is incomplete.");
      }
      const routes = parseModelRouting(frozenModel.routesJson, true);
      estimateModelRouting(routes, teamConfig.tier, teamConfig.roles);
      const policy = parseAutomationPolicy(version.policyJson);
      if (!teamConfig.markets.some((market: string) => policy.allowedMarkets.includes(market))) {
        throw new Error("Frozen policy and team configuration have no shared markets.");
      }
    } catch (error) {
      throw new Error(`Frozen program is not executable by the Shadow runtime: ${error instanceof Error ? error.message : "invalid configuration"}`);
    }

    const rows = await ctx.db.query("programAssignments")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", account._id)).collect();
    const active = rows.filter((row: any) => row.status === "active");
    if (active.length === 1 && active[0]._id === assignment._id) {
      return { assignmentId: assignment._id, status: "active" as const,
        controllerMode: assignment.controllerMode ?? "shadow", duplicate: true };
    }
    if (active.length) {
      throw new Error("An active assignment needs a separate release migration.");
    }
    if (assignment.status !== "paused") throw new Error("Only a paused assignment can be activated for Shadow analysis.");
    const now = Date.now();
    await ctx.db.patch(assignment._id, { status: "active", controllerMode: "shadow",
      shadowCadenceEnabled: false, updatedAt: now });
    await ctx.db.insert("auditEvents", { strategyAccountId: account._id, userId: account.userId,
      actor: "release", kind: "managed_program.shadow_activated",
      summary: "Managed program assignment activated for private Shadow analysis",
      detail: JSON.stringify({ assignmentId: String(assignment._id), programVersionId: String(version._id),
        sourceStrategyAccountId: String(version.sourceStrategyAccountId), controllerMode: "shadow",
        authorizedBySubject: actor.subject }),
      refTable: "programAssignments", refId: String(assignment._id), createdAt: now });
    return { assignmentId: assignment._id, status: "active" as const,
      controllerMode: "shadow" as const, duplicate: false };
  },
});

export const getAccountControllers = query({ args: {}, handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication is required.");
  const state = await requireViewerStrategy(ctx, identity.subject);
  if (!state.user || !state.strategyAccount) return { accountId: null, customer: [], managed: null };
  const deployments = await ctx.db.query("agentMarketDeployments").withIndex("by_strategyAccountId_marketId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
  const customer = [];
  for (const deployment of deployments) {
    if (deployment.userId !== state.user._id) continue;
    const version = await ctx.db.get(deployment.teamVersionId);
    if (!version || version.teamId !== deployment.teamId || version.strategyAccountId !== state.strategyAccount._id) continue;
    customer.push({ marketId: deployment.marketId, status: deployment.status, mode: deployment.mode,
      controllerRef: await customerControllerRef({ strategyAccountId: String(state.strategyAccount._id),
        teamId: String(deployment.teamId), teamVersionId: String(version._id),
        deploymentId: String(deployment._id), configJson: version.configJson }) });
  }
  const rows = await ctx.db.query("programAssignments").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
  const selected = mobileAssignmentState(rows);
  const ownedActive = selected.assignment && selected.assignment.userId === state.user._id
    && selected.assignment.strategyAccountId === state.strategyAccount._id ? selected.assignment : null;
  const paused = rows.filter((row) => row.status === "paused");
  const ownedPaused = paused.length === 1 && paused[0].userId === state.user._id
    && paused[0].strategyAccountId === state.strategyAccount._id ? paused[0] : null;
  return { accountId: state.strategyAccount._id, customer, managed: ownedActive
    ? { assignmentId: ownedActive._id, status: ownedActive.status,
      controllerMode: ownedActive.controllerMode ?? "shadow" }
    : ownedPaused && selected.reason === "unassigned"
      ? { assignmentId: ownedPaused._id, status: ownedPaused.status,
        controllerMode: ownedPaused.controllerMode ?? "shadow" } : null,
    managedState: ownedActive ? "active" : selected.assignment ? "invalid_assignment"
      : ownedPaused && selected.reason === "unassigned" ? "paused"
      : paused.length === 1 && !ownedPaused ? "invalid_assignment" : selected.reason };
} });
