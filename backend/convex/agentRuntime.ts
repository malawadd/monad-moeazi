import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireLifecycleDecision } from "./evidenceLifecycle";
import { customerControllerRef, sameController } from "../lib/programOwnership";
import { controllerRefValidator } from "./agentValidators";
import { resolveManagedProgramContext } from "./managedProgramRuntime";
import { managedProposalExecutionContext } from "./managedProposalExecution";
import { ownedHyperliquidTradingAddress } from "./gatewayCredentialAuthority";
import { enqueueManagedProgramScheduledAnalysis, getManagedProgramScheduleContext,
  getManagedProgramScheduleState } from "./managedProgramCadence";

const ACTIVE = ["queued", "claimed", "running"] as const;

export const authorizeProfileSync = internalQuery({
  args: { subject: v.string(), profileId: v.id("agentProfiles") },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.archivedAt) throw new Error("Agent profile not found.");
    const user = await ctx.db.query("users").withIndex("by_authSubject", (q: any) =>
      q.eq("authSubject", args.subject)).first();
    if (!user || profile.userId !== user._id) throw new Error("Agent profile not found.");
    const subscriptions = await ctx.db.query("agentMarketSubscriptions")
      .withIndex("by_profileId", (q: any) => q.eq("profileId", profile._id)).collect();
    return { profile, markets: subscriptions.filter((row) => row.enabled).map((row) => row.marketId) };
  },
});

export const getScheduleProfile = internalQuery({
  args: {
    profileId: v.optional(v.id("agentProfiles")),
    assignmentId: v.optional(v.id("programAssignments")),
    subject: v.optional(v.string()),
    programVersionId: v.optional(v.id("tradingProgramVersions")),
    marketId: v.optional(v.string()),
    scheduleRevision: v.optional(v.number()),
    controllerRef: v.optional(controllerRefValidator),
  },
  handler: async (ctx, args) => {
    if (args.assignmentId) {
      if (args.programVersionId || args.marketId || args.scheduleRevision !== undefined || args.controllerRef) {
        if (!args.programVersionId || !args.marketId || args.scheduleRevision === undefined || !args.controllerRef) return null;
        return getManagedProgramScheduleContext(ctx, {
          assignmentId: args.assignmentId, programVersionId: args.programVersionId,
          marketId: args.marketId, scheduleRevision: args.scheduleRevision,
          controllerRef: args.controllerRef,
        });
      }
      return getManagedProgramScheduleState(ctx, args.assignmentId, args.subject);
    }
    if (!args.profileId) return null;
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.archivedAt) return null;
    const [strategy, credit, policy, subscriptions, deployments] = await Promise.all([
      ctx.db.get(profile.strategyAccountId),
      ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) =>
        q.eq("userId", profile.userId)).first(),
      ctx.db.query("automationPolicies").withIndex("by_strategyAccountId_status", (q: any) =>
        q.eq("strategyAccountId", profile.strategyAccountId).eq("status", "active")).first(),
      ctx.db.query("agentMarketSubscriptions").withIndex("by_profileId", (q: any) =>
        q.eq("profileId", profile._id)).collect(),
      ctx.db.query("agentMarketDeployments").withIndex("by_teamId_marketId", (q: any) =>
        q.eq("teamId", profile._id)).collect(),
    ]);
    const resolvedDeployments = [];
    for (const deployment of deployments) {
      const version = await ctx.db.get(deployment.teamVersionId);
      if (!version || version.teamId !== profile._id || version.strategyAccountId !== profile.strategyAccountId) continue;
      resolvedDeployments.push({ ...deployment, controllerRef: await customerControllerRef({
        strategyAccountId: String(profile.strategyAccountId), teamId: String(profile._id),
        teamVersionId: String(version._id), deploymentId: String(deployment._id), configJson: version.configJson,
      }) });
    }
    return {
      profile,
      strategy,
      availableCredits: credit ? credit.balance - credit.reserved : 0,
      policyVersion: policy?.version ?? null,
      markets: subscriptions.filter((row) => row.enabled).map((row) => row.marketId),
      deployments: resolvedDeployments,
    };
  },
});

export const getAgentExecutionContext = internalQuery({
  args: { strategyAccountId: v.id("strategyAccounts"), jobId: v.optional(v.id("analysisJobs")) },
  handler: async (ctx, args) => {
    const job = args.jobId ? await ctx.db.get(args.jobId) : null;
    if (job && job.strategyAccountId !== args.strategyAccountId) return null;
    if (job && (job.programAssignmentId || job.programVersionId
        || job.controllerRef?.controllerKind === "managed_program")) {
      if (job.scope !== "private") return null;
      const strategy = await ctx.db.get(args.strategyAccountId);
      if (!strategy || strategy.emergencyStop || strategy.status !== "active"
          || strategy.userId !== job.userId) return null;
      if (!job.controllerRef) return null;
      const managed = await resolveManagedProgramContext(ctx, job, strategy);
      if (!managed || !sameController(job.controllerRef, managed.controllerRef)) return null;
      return managed;
    }
    if (!job || job.scope !== "private" || !job.teamId || !job.teamVersionId || !job.deploymentId) return null;
    const deployment = await ctx.db.get(job.deploymentId);
    if (!deployment || deployment.status !== "active" || deployment.strategyAccountId !== args.strategyAccountId
        || deployment.teamId !== job.teamId || deployment.teamVersionId !== job.teamVersionId
        || deployment.marketId !== job.marketId || (job.controllerMode && deployment.mode !== job.controllerMode)) return null;
    const [profile, version, policy, strategy] = await Promise.all([
      ctx.db.get(job.teamId), ctx.db.get(job.teamVersionId),
      ctx.db.query("automationPolicies").withIndex("by_strategyAccountId_status", (q: any) =>
        q.eq("strategyAccountId", args.strategyAccountId).eq("status", "active")).first(),
      ctx.db.get(args.strategyAccountId),
    ]);
    if (!profile || !version || !policy || !strategy || profile.paused || profile.archivedAt
        || profile.strategyAccountId !== args.strategyAccountId || version.teamId !== profile._id
        || version.strategyAccountId !== strategy._id || version.userId !== profile.userId
        || job.userId !== profile.userId || deployment.userId !== profile.userId
        || strategy.userId !== profile.userId || policy.strategyAccountId !== strategy._id
        || strategy.emergencyStop || strategy.status !== "active") return null;
    const controllerRef = await customerControllerRef({ strategyAccountId: String(args.strategyAccountId),
      teamId: String(profile._id), teamVersionId: String(version._id),
      deploymentId: String(deployment._id), configJson: version.configJson });
    if (job.controllerRef && !sameController(job.controllerRef, controllerRef)) return null;
    const credit = await ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) =>
      q.eq("userId", profile.userId)).first();
    return {
      profile: {
        ...profile,
        authorityMode: deployment?.mode ?? (profile.authorityMode === "insights" ? "shadow" : profile.authorityMode),
      },
      teamVersionId: job.teamVersionId, deploymentId: job.deploymentId, controllerRef,
      policy: { ...policy, policy: JSON.parse(policy.policyJson) },
      strategy,
      availableCredits: credit ? credit.balance - credit.reserved : 0,
    };
  },
});

export const getTradeProposalExecutionContext = internalQuery({
  args: { proposalId: v.id("tradeProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) return null;
    await requireLifecycleDecision(ctx, { decisionHash: proposal.lifecycleDecisionHash,
      artifactId: `proposal:${proposal.analysisId}`, sink: "convex.analysis_projection",
      strategyAccountId: proposal.strategyAccountId,
      actualPayload: { artifact_type: "trade_proposal", content: proposal.payloadJson } });
    if (proposal.controllerRef?.controllerKind === "managed_program") {
      return managedProposalExecutionContext(ctx, proposal);
    }
    if (!proposal.teamId || !proposal.teamVersionId || !proposal.deploymentId) return null;
    const deployment = await ctx.db.get(proposal.deploymentId);
    if (!deployment || deployment.status !== "active" || deployment.strategyAccountId !== proposal.strategyAccountId
        || deployment.teamId !== proposal.teamId || deployment.teamVersionId !== proposal.teamVersionId
        || (proposal.controllerMode && deployment.mode !== proposal.controllerMode)) return null;
    const [profile, version, policy, strategy, credit] = await Promise.all([
      ctx.db.get(proposal.teamId), ctx.db.get(proposal.teamVersionId),
      ctx.db.query("automationPolicies").withIndex("by_strategyAccountId_status", (q: any) =>
        q.eq("strategyAccountId", proposal.strategyAccountId).eq("status", "active")).first(),
      ctx.db.get(proposal.strategyAccountId),
      ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) =>
        q.eq("userId", proposal.userId)).first(),
    ]);
    if (!profile || !version || !policy || !strategy || profile.paused || profile.archivedAt
        || profile.strategyAccountId !== proposal.strategyAccountId || version.teamId !== profile._id
        || version.strategyAccountId !== strategy._id || version.userId !== profile.userId
        || proposal.userId !== profile.userId || deployment.userId !== profile.userId
        || strategy.userId !== profile.userId || policy.strategyAccountId !== strategy._id
        || strategy.emergencyStop || strategy.status !== "active") return null;
    const controllerRef = await customerControllerRef({ strategyAccountId: String(proposal.strategyAccountId),
      teamId: String(profile._id), teamVersionId: String(version._id),
      deploymentId: String(deployment._id), configJson: version.configJson });
    if (proposal.controllerRef && !sameController(proposal.controllerRef, controllerRef)) return null;
    const payload = JSON.parse(proposal.payloadJson);
    const hyperliquidTradingAddress = payload.candidate_venues?.length === 1
      && payload.candidate_venues[0] === "hyperliquid"
      ? await ownedHyperliquidTradingAddress(ctx, strategy._id) : null;
    return {
      proposal: { ...proposal, payload },
      profile: {
        ...profile,
        authorityMode: deployment?.mode ?? (profile.authorityMode === "insights" ? "shadow" : profile.authorityMode),
      },
      controllerRef, policy: { ...policy, policy: JSON.parse(policy.policyJson) },
      hyperliquidTradingAddress,
      strategy,
      availableCredits: credit ? credit.balance - credit.reserved : 0,
    };
  },
});

export const authorizeProposalExecution = internalQuery({
  args: { subject: v.string(), proposalId: v.id("tradeProposals") },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new Error("Proposal not found.");
    await requireLifecycleDecision(ctx, { decisionHash: proposal.lifecycleDecisionHash,
      artifactId: `proposal:${proposal.analysisId}`, sink: "convex.analysis_projection",
      strategyAccountId: proposal.strategyAccountId,
      actualPayload: { artifact_type: "trade_proposal", content: proposal.payloadJson } });
    const user = await ctx.db.query("users").withIndex("by_authSubject", (q: any) =>
      q.eq("authSubject", args.subject)).first();
    if (!user || proposal.userId !== user._id) throw new Error("Proposal not found.");
    if (!proposal.teamId || !proposal.teamVersionId || !proposal.deploymentId || !proposal.controllerRef
        || proposal.controllerMode !== "approval_required") throw new Error("Proposal authority is unavailable.");
    const [team, version, deployment] = await Promise.all([
      ctx.db.get(proposal.teamId), ctx.db.get(proposal.teamVersionId), ctx.db.get(proposal.deploymentId),
    ]);
    if (!team || !version || !deployment || team.userId !== user._id
        || version.teamId !== team._id || version.strategyAccountId !== proposal.strategyAccountId
        || deployment.teamId !== team._id || deployment.teamVersionId !== version._id
        || deployment.strategyAccountId !== proposal.strategyAccountId
        || deployment.mode !== "approval_required" || deployment.status !== "active") {
      throw new Error("Proposal deployment changed.");
    }
    const expected = await customerControllerRef({ strategyAccountId: String(proposal.strategyAccountId),
      teamId: String(team._id), teamVersionId: String(version._id),
      deploymentId: String(deployment._id), configJson: version.configJson });
    if (!sameController(proposal.controllerRef, expected)) throw new Error("Proposal controller changed.");
    return { proposalId: proposal._id, status: proposal.status };
  },
});

export const enqueueScheduledAnalysis = internalMutation({
  args: {
    profileId: v.optional(v.id("agentProfiles")),
    assignmentId: v.optional(v.id("programAssignments")),
    programVersionId: v.optional(v.id("tradingProgramVersions")),
    marketId: v.string(),
    scheduleRevision: v.number(),
    controllerRef: v.optional(controllerRefValidator),
    scheduledAtMs: v.optional(v.number()),
    trigger: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.assignmentId) {
      if (!args.programVersionId || !args.controllerRef || args.scheduledAtMs === undefined) {
        return { created: false, reason: "managed_schedule_binding_incomplete", job: null };
      }
      return enqueueManagedProgramScheduledAnalysis(ctx, {
        assignmentId: args.assignmentId, programVersionId: args.programVersionId,
        marketId: args.marketId, scheduleRevision: args.scheduleRevision,
        controllerRef: args.controllerRef, scheduledAtMs: args.scheduledAtMs,
      });
    }
    if (!args.profileId) return { created: false, reason: "schedule_binding_incomplete", job: null };
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.archivedAt || profile.scheduleRevision !== args.scheduleRevision) {
      return { created: false, reason: "stale_schedule", job: null };
    }
    if (profile.paused || profile.lifecycleStatus !== "active") {
      return { created: false, reason: "profile_paused", job: null };
    }
    const strategy = await ctx.db.get(profile.strategyAccountId);
    if (!strategy || strategy.status !== "active" || strategy.emergencyStop) {
      return { created: false, reason: "strategy_blocked", job: null };
    }
    if (!profile.watchMarkets.includes(args.marketId)) {
      return { created: false, reason: "market_not_watched", job: null };
    }
    const candidates = await ctx.db.query("agentMarketDeployments")
      .withIndex("by_teamId_marketId", (q: any) => q.eq("teamId", profile._id).eq("marketId", args.marketId)).collect();
    const active = candidates.filter((row: any) => row.status === "active");
    if (active.length !== 1) {
      return { created: false, reason: "deployment_paused", job: null };
    }
    const deployment = active[0];
    if (deployment.strategyAccountId !== profile.strategyAccountId || deployment.userId !== profile.userId
        || strategy.userId !== profile.userId) return { created: false, reason: "deployment_owner_mismatch", job: null };
    const teamVersion = await ctx.db.get(deployment.teamVersionId);
    if (!teamVersion || teamVersion.teamId !== profile._id
        || teamVersion.strategyAccountId !== profile.strategyAccountId
        || teamVersion.userId !== profile.userId) return { created: false, reason: "version_unavailable", job: null };
    for (const status of ACTIVE) {
      const existing = await ctx.db.query("analysisJobs")
        .withIndex("by_deploymentId_status", (q: any) =>
          q.eq("deploymentId", deployment._id).eq("status", status),
        ).first();
      if (existing) return { created: false, reason: "active_job", job: existing };
    }
    const now = Date.now();
    const bucket = Math.floor(now / 30_000);
    const id = await ctx.db.insert("analysisJobs", {
      strategyAccountId: profile.strategyAccountId,
      teamId: profile._id, teamVersionId: teamVersion._id, deploymentId: deployment._id,
      controllerRef: await customerControllerRef({ strategyAccountId: String(profile.strategyAccountId),
        teamId: String(profile._id), teamVersionId: String(teamVersion._id),
        deploymentId: String(deployment._id), configJson: teamVersion.configJson }),
      controllerMode: deployment.mode,
      userId: profile.userId,
      scope: "private",
      marketId: args.marketId,
      tier: JSON.parse(teamVersion.configJson).tier,
      trigger: args.trigger,
      status: "queued",
      dedupeKey: `schedule:${deployment._id}:${teamVersion._id}:${bucket}`,
      reservedCredits: 0,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { created: true, reason: "created", job: await ctx.db.get(id) };
  },
});
