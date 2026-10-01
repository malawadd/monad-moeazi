import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireLifecycleDecision } from "./evidenceLifecycle";
import { parseAutomationPolicy } from "./helpers/agentPolicy";
import { requireV2SafetyDecision } from "./helpers/dependencySafetyVerification";
import { controllerRefValidator } from "./agentValidators";
import { customerControllerRef, sameController } from "../lib/programOwnership";
import { managedProgramActivationEligibility } from "./mobile";

export const claimNextAnalysisJob = internalMutation({
  args: { holderId: v.string(), leaseMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const leaseMs = Math.min(Math.max(args.leaseMs ?? 60_000, 10_000), 300_000);
    const queued = await ctx.db.query("analysisJobs").withIndex("by_status", (q) => q.eq("status", "queued")).order("asc").take(25);
    let job = queued[0] ?? null;
    if (!job) {
      const claimed = await ctx.db.query("analysisJobs").withIndex("by_status", (q) => q.eq("status", "claimed")).take(50);
      const expired = claimed.find((row) => (row.leaseExpiresAt ?? 0) <= now);
      if (expired) job = expired;
    }
    if (!job) return null;
    await ctx.db.patch(job._id, {
      status: "claimed", holderId: args.holderId, leaseExpiresAt: now + leaseMs,
      attempt: job.attempt + 1, startedAt: job.startedAt ?? now, updatedAt: now, error: undefined,
    });
    return await ctx.db.get(job._id);
  },
});

export const claimAnalysisJob = internalMutation({
  args: { jobId: v.id("analysisJobs"), holderId: v.string(), leaseMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return { claimed: false, reason: "not_found", job: null };
    const now = Date.now();
    const reclaimable = job.status === "claimed" && (job.leaseExpiresAt ?? 0) <= now;
    const sameHolder = job.status === "claimed" && job.holderId === args.holderId;
    if (sameHolder) return { claimed: true, reason: "already_claimed", job };
    if (job.status !== "queued" && !reclaimable) {
      return { claimed: false, reason: job.status, job };
    }
    const leaseMs = Math.min(Math.max(args.leaseMs ?? 600_000, 60_000), 900_000);
    await ctx.db.patch(job._id, {
      status: "claimed", holderId: args.holderId, leaseExpiresAt: now + leaseMs,
      attempt: job.attempt + 1, startedAt: job.startedAt ?? now, updatedAt: now, error: undefined,
    });
    return { claimed: true, reason: "claimed", job: await ctx.db.get(job._id) };
  },
});

export const heartbeatAnalysisJob = internalMutation({
  args: { jobId: v.id("analysisJobs"), holderId: v.string(), leaseMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.holderId !== args.holderId || !["claimed", "running"].includes(job.status)) return { heartbeated: false };
    const now = Date.now();
    await ctx.db.patch(job._id, { status: "running", leaseExpiresAt: now + (args.leaseMs ?? 60_000), updatedAt: now });
    return { heartbeated: true };
  },
});

export const completeAnalysisJob = internalMutation({
  args: {
    jobId: v.id("analysisJobs"), holderId: v.string(), analysisId: v.string(),
    status: v.union(v.literal("fresh"), v.literal("degraded"), v.literal("failed")),
    payloadJson: v.string(), providersJson: v.string(), sourceFreshnessMs: v.number(), validUntil: v.number(),
    lifecycleDecisionHash: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job?.status === "completed") {
      return { snapshotId: null, jobId: job._id, duplicate: true };
    }
    if (!job || job.holderId !== args.holderId || !["claimed", "running"].includes(job.status)) throw new Error("Analysis job lease is not owned by this worker.");
    JSON.parse(args.payloadJson); JSON.parse(args.providersJson);
    await requireLifecycleDecision(ctx, { decisionHash: args.lifecycleDecisionHash,
      artifactId: args.analysisId, sink: "convex.analysis_projection",
      strategyAccountId: job.strategyAccountId,
      actualPayload: { artifact_type: "analysis_snapshot", content: args.payloadJson } });
    const now = Date.now();
    const snapshotValues = {
      controllerRef: job.controllerRef,
      teamId: job.teamId, teamVersionId: job.teamVersionId, deploymentId: job.deploymentId,
      programAssignmentId: job.programAssignmentId, programVersionId: job.programVersionId,
      agentReleaseVersionId: job.agentReleaseVersionId,
      strategyAccountId: job.strategyAccountId, scope: job.scope, marketId: job.marketId,
      analysisId: args.analysisId, tier: job.tier, status: args.status, payloadJson: args.payloadJson,
      providersJson: args.providersJson, sourceFreshnessMs: Math.max(0, args.sourceFreshnessMs),
      lifecycleDecisionHash: args.lifecycleDecisionHash,
      validUntil: Math.max(now, args.validUntil), createdAt: now,
    };
    const current = job.programAssignmentId
      ? await ctx.db.query("analysisSnapshots")
        .withIndex("by_programAssignmentId_marketId", (q) =>
          q.eq("programAssignmentId", job.programAssignmentId).eq("marketId", job.marketId)).first()
      : job.deploymentId
      ? await ctx.db.query("analysisSnapshots")
        .withIndex("by_deploymentId", (q) => q.eq("deploymentId", job.deploymentId)).first()
      : job.scope === "public"
      ? await ctx.db.query("analysisSnapshots")
        .withIndex("by_scope_marketId", (q) => q.eq("scope", "public").eq("marketId", job.marketId)).first()
      : await ctx.db.query("analysisSnapshots")
        .withIndex("by_strategyAccountId_scope_marketId", (q) =>
          q.eq("strategyAccountId", job.strategyAccountId).eq("scope", "private").eq("marketId", job.marketId),
        ).first();
    const snapshotId = current
      ? (await ctx.db.patch(current._id, snapshotValues), current._id)
      : await ctx.db.insert("analysisSnapshots", snapshotValues);
    await ctx.db.patch(job._id, {
      status: args.status === "failed" ? "failed" : "completed", completedAt: now, updatedAt: now,
      analysisId: args.analysisId,
      leaseExpiresAt: now, error: args.status === "failed" ? "Analysis completed without a valid synthesis." : undefined,
    });
    return { snapshotId, jobId: job._id, duplicate: false };
  },
});

export const failAnalysisJob = internalMutation({
  args: { jobId: v.id("analysisJobs"), holderId: v.string(), error: v.string(), retryable: v.boolean() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.holderId !== args.holderId || !["claimed", "running"].includes(job.status)) {
      return { failed: false };
    }
    const now = Date.now();
    const retry = args.retryable && job.attempt < 3;
    await ctx.db.patch(job._id, {
      status: retry ? "queued" : "failed", holderId: undefined, leaseExpiresAt: undefined,
      error: args.error.slice(0, 2_000), completedAt: retry ? undefined : now, updatedAt: now,
    });
    return { failed: true, retrying: retry };
  },
});

export const recordPolicyDraft = internalMutation({
  args: { jobId: v.id("analysisJobs"), policyJson: v.string(), diffJson: v.string() },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.strategyAccountId || !job.userId || job.trigger !== "policy_draft") throw new Error("Policy job not found.");
    const policy = parseAutomationPolicy(args.policyJson);
    JSON.parse(args.diffJson);
    const latest = await ctx.db.query("automationPolicies")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", job.strategyAccountId!)).order("desc").first();
    const source = JSON.parse(job.payloadJson ?? "{}") as { sourceText?: string };
    const now = Date.now();
    const policyId = await ctx.db.insert("automationPolicies", {
      strategyAccountId: job.strategyAccountId, userId: job.userId, version: (latest?.version ?? 0) + 1,
      status: "draft", sourceText: source.sourceText, policyJson: JSON.stringify(policy), diffJson: args.diffJson,
      createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(job._id, { status: "completed", completedAt: now, updatedAt: now, leaseExpiresAt: now });
    return { policyId };
  },
});

export const recordTradeProposal = internalMutation({
  args: {
    jobId: v.id("analysisJobs"),
    strategyAccountId: v.id("strategyAccounts"), analysisId: v.string(), policyVersion: v.number(),
    teamId: v.optional(v.id("agentProfiles")), teamVersionId: v.optional(v.id("agentTeamVersions")),
    deploymentId: v.optional(v.id("agentMarketDeployments")),
    programAssignmentId: v.optional(v.id("programAssignments")),
    programVersionId: v.optional(v.id("tradingProgramVersions")),
    marketId: v.string(), side: v.union(v.literal("long"), v.literal("short")), payloadJson: v.string(),
    confidence: v.number(), consensus: v.number(), idempotencyKey: v.string(), expiresAt: v.number(),
    agreementStrength: v.optional(v.number()), controllerRef: v.optional(controllerRefValidator),
    controllerMode: v.optional(v.union(v.literal("shadow"), v.literal("insights"),
      v.literal("approval_required"), v.literal("autopilot"))),
    proposalSafetyDecisionHash: v.string(), approvalSafetyDecisionHash: v.optional(v.string()),
    analysisSafetyDecisionHash: v.string(),
    lifecycleDecisionHash: v.string(),
  },
  handler: async (ctx, args) => {
    const proposal = JSON.parse(args.payloadJson);
    if (String(proposal.account_id) !== String(args.strategyAccountId)
        || String(proposal.analysis_id) !== args.analysisId
        || String(proposal.market).toUpperCase() !== args.marketId
        || proposal.side !== args.side) {
      throw new Error("Proposal payload identity does not match its controller binding.");
    }
    const duplicate = await ctx.db.query("tradeProposals").withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", args.idempotencyKey)).first();
    if (duplicate) {
      if (duplicate.strategyAccountId !== args.strategyAccountId || duplicate.analysisId !== args.analysisId
          || duplicate.jobId !== args.jobId || duplicate.controllerMode !== args.controllerMode
          || !duplicate.controllerRef || !args.controllerRef || !sameController(duplicate.controllerRef, args.controllerRef)
          || duplicate.programAssignmentId !== args.programAssignmentId
          || duplicate.programVersionId !== args.programVersionId
          || duplicate.payloadJson !== args.payloadJson || duplicate.marketId !== args.marketId
          || duplicate.side !== args.side || duplicate.policyVersion !== args.policyVersion
          || duplicate.confidence !== args.confidence || duplicate.consensus !== args.consensus
          || duplicate.agreementStrength !== (args.agreementStrength ?? Math.abs(args.consensus))
          || duplicate.expiresAt !== args.expiresAt
          || duplicate.proposalSafetyDecisionHash !== args.proposalSafetyDecisionHash
          || duplicate.approvalSafetyDecisionHash !== args.approvalSafetyDecisionHash
          || duplicate.analysisSafetyDecisionHash !== args.analysisSafetyDecisionHash
          || duplicate.lifecycleDecisionHash !== args.lifecycleDecisionHash) {
        throw new Error("Proposal idempotency key conflicts with another controller.");
      }
      return { proposalId: duplicate._id, status: duplicate.status, duplicate: true };
    }
    const strategy = await ctx.db.get(args.strategyAccountId);
    if (!strategy) throw new Error("Strategy account not found.");
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "completed" || job.analysisId !== args.analysisId
        || job.strategyAccountId !== args.strategyAccountId || job.scope !== "private"
        || job.teamId !== args.teamId || job.teamVersionId !== args.teamVersionId
        || job.deploymentId !== args.deploymentId
        || job.programAssignmentId !== args.programAssignmentId
        || job.programVersionId !== args.programVersionId || !job.controllerMode
        || job.controllerMode !== args.controllerMode || !args.controllerRef
        || (job.controllerRef && !sameController(job.controllerRef, args.controllerRef))) {
      throw new Error("Proposal is not bound to the completed analysis job.");
    }
    const controllerRef = args.controllerRef!;
    const managed = controllerRef.controllerKind === "managed_program";
    let managedAssignment: any = null;
    let managedPolicy: ReturnType<typeof parseAutomationPolicy> | null = null;
    if (managed) {
      if (args.teamId || args.teamVersionId || args.deploymentId
          || !args.programAssignmentId || !args.programVersionId
          || (args.controllerMode !== "shadow" && args.controllerMode !== "autopilot")) {
        throw new Error("Managed proposals require an owned Shadow or Autopilot assignment.");
      }
      const assignmentId = args.programAssignmentId!;
      const programVersionId = args.programVersionId!;
      const [assignment, version, activeRows] = await Promise.all([
        ctx.db.get(assignmentId), ctx.db.get(programVersionId),
        ctx.db.query("programAssignments").withIndex("by_strategyAccountId", (q: any) =>
          q.eq("strategyAccountId", args.strategyAccountId)).collect(),
      ]);
      if (!assignment || assignment.status !== "active" || assignment.strategyAccountId !== args.strategyAccountId
          || assignment.userId !== job.userId || assignment.source !== "explicit"
          || assignment.programVersionId !== programVersionId
          || (assignment.controllerMode ?? "shadow") !== args.controllerMode
          || !version || version.version !== args.policyVersion || version.contentHash !== controllerRef.contentHash
          || String(assignment._id) !== controllerRef.controllerId
          || String(version._id) !== controllerRef.controllerVersionId
          || String(args.strategyAccountId) !== controllerRef.strategyAccountId
          || activeRows.filter((row: any) => row.status === "active").length !== 1) {
        throw new Error("Managed program assignment or version changed after analysis.");
      }
      const policy = parseAutomationPolicy(version.policyJson);
      if (!policy.allowedMarkets.includes(args.marketId)) throw new Error("Managed program policy blocks this market.");
      managedAssignment = assignment;
      managedPolicy = policy;
    } else if (!args.teamId || !args.teamVersionId || !args.deploymentId
        || args.programAssignmentId || args.programVersionId) {
      throw new Error("An explicit customer deployment is required.");
    }
    let expectedRef = args.controllerRef;
    let customerProfile: any = null;
    let customerDeployment: any = null;
    if (!managed) {
      const teamId = args.teamId!;
      const teamVersionId = args.teamVersionId!;
      const deploymentId = args.deploymentId!;
      const [profile, version, deployment] = await Promise.all([
        ctx.db.get(teamId), ctx.db.get(teamVersionId), ctx.db.get(deploymentId),
      ]);
      if (!profile || profile.archivedAt || !version || version.teamId !== profile._id
          || version.strategyAccountId !== args.strategyAccountId) throw new Error("Active agent team version not configured.");
      if (profile.strategyAccountId !== args.strategyAccountId) throw new Error("Team does not own this strategy account.");
      if (!deployment || deployment.teamId !== profile._id || deployment.userId !== profile.userId
          || deployment.strategyAccountId !== args.strategyAccountId
          || deployment.teamVersionId !== teamVersionId || deployment.marketId !== args.marketId) {
        throw new Error("The selected market deployment changed. Review it before proceeding.");
      }
      expectedRef = await customerControllerRef({ strategyAccountId: String(args.strategyAccountId),
        teamId: String(profile._id), teamVersionId: String(version._id),
        deploymentId: String(deployment._id), configJson: version.configJson });
      if (!sameController(controllerRef, expectedRef)) throw new Error("Controller identity changed.");
      if (args.controllerMode && args.controllerMode !== deployment.mode) throw new Error("Deployment mode changed after analysis.");
      customerProfile = profile;
      customerDeployment = deployment;
    }
    if (!Number.isFinite(args.consensus) || args.consensus < -1 || args.consensus > 1
        || !Number.isFinite(args.confidence) || args.confidence < 0 || args.confidence > 1
        || (args.agreementStrength !== undefined && (!Number.isFinite(args.agreementStrength)
          || args.agreementStrength < 0 || args.agreementStrength > 1
          || Math.abs(args.consensus) !== args.agreementStrength))) {
      throw new Error("Proposal direction or agreement is invalid.");
    }
    const bindings = {
      analysis_decision_hash: args.analysisSafetyDecisionHash,
      market: String(proposal.market).toUpperCase(), policy_version: String(args.policyVersion),
      venue: String(proposal.candidate_venues?.[0] ?? "").toLowerCase(),
    };
    const safetyRequest = { proposal, analysis_id: args.analysisId };
    await requireLifecycleDecision(ctx, { decisionHash: args.lifecycleDecisionHash,
      artifactId: `proposal:${args.analysisId}`, sink: "convex.analysis_projection",
      strategyAccountId: args.strategyAccountId,
      actualPayload: { artifact_type: "trade_proposal", content: args.payloadJson } });
    await requireV2SafetyDecision(ctx, {
      decisionHash: args.proposalSafetyDecisionHash, operation: "propose",
      subjectKey: args.analysisId, strategyAccountId: args.strategyAccountId,
      bindings, request: safetyRequest,
    });
    let status: "simulated" | "pending_approval" | "approved" | "blocked" = managed
      ? args.controllerMode === "shadow" ? "simulated" : "blocked"
      : customerDeployment.mode === "shadow" || customerDeployment.mode === "insights"
        ? "simulated"
        : customerDeployment.mode === "approval_required" ? "pending_approval" : "approved";
    if ((!managed && customerProfile.paused) || strategy.emergencyStop || strategy.status !== "active"
        || (!managed && customerDeployment.status !== "active")) status = "blocked";
    if (managed && args.controllerMode === "autopilot") {
      const user = job.userId ? await ctx.db.get(job.userId) : null;
      const eligibility = user && await managedProgramActivationEligibility(ctx, user, strategy);
      if (managedAssignment?.status === "active" && managedAssignment.shadowCadenceEnabled === true
          && eligibility?.activationReady === true
          && proposal.candidate_venues?.length === 1
          && managedPolicy?.allowedVenues.includes(proposal.candidate_venues[0])) status = "approved";
    }
    if (status === "pending_approval") {
      await requireV2SafetyDecision(ctx, {
        decisionHash: args.approvalSafetyDecisionHash, operation: "request_approval",
        subjectKey: `approval:${args.analysisId}`, strategyAccountId: args.strategyAccountId,
        bindings, request: safetyRequest,
      });
    }
    const now = Date.now();
    const proposalId = await ctx.db.insert("tradeProposals", {
      ...args, userId: managed ? job.userId : customerProfile.userId, status, controllerRef: expectedRef,
      agentReleaseVersionId: job.agentReleaseVersionId,
      confidence: args.confidence, consensus: args.consensus,
      agreementStrength: args.agreementStrength ?? Math.abs(args.consensus), createdAt: now, updatedAt: now,
    });
    if (status === "pending_approval") {
      await ctx.db.insert("approvalRequests", {
        proposalId, strategyAccountId: args.strategyAccountId, userId: customerProfile.userId,
        teamId: customerProfile._id, teamVersionId: args.teamVersionId,
        deploymentId: args.deploymentId, status: "pending",
        expiresAt: args.expiresAt, createdAt: now, updatedAt: now,
      });
    }
    return { proposalId, status, duplicate: false };
  },
});

export const transitionTradeProposal = internalMutation({
  args: {
    proposalId: v.id("tradeProposals"),
    status: v.union(v.literal("simulated"), v.literal("executing"), v.literal("executed"), v.literal("failed"), v.literal("expired"), v.literal("blocked")),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new Error("Trade proposal not found.");
    const now = Date.now();
    await ctx.db.patch(proposal._id, { status: args.status, updatedAt: now, decidedAt: proposal.decidedAt ?? now });
    return { proposalId: proposal._id, status: args.status };
  },
});

export const recordShadowExecution = internalMutation({
  args: {
    proposalId: v.id("tradeProposals"),
    entryPrice: v.number(),
    sizeUsd: v.number(),
    quoteReference: v.string(),
    safetyDecisionHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("shadowExecutions")
      .withIndex("by_proposalId", (q) => q.eq("proposalId", args.proposalId)).first();
    if (existing) return { executionId: existing._id, duplicate: true };
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || proposal.status !== "simulated") throw new Error("Shadow proposal not found.");
    const proposalPayload = JSON.parse(proposal.payloadJson);
    if (proposal.controllerRef?.controllerKind === "managed_program") {
      const [assignment, version, rows] = await Promise.all([
        proposal.programAssignmentId ? ctx.db.get(proposal.programAssignmentId) : null,
        proposal.programVersionId ? ctx.db.get(proposal.programVersionId) : null,
        ctx.db.query("programAssignments").withIndex("by_strategyAccountId", (q: any) =>
          q.eq("strategyAccountId", proposal.strategyAccountId)).collect(),
      ]);
      if (!assignment || assignment.status !== "active" || assignment.userId !== proposal.userId
          || assignment.strategyAccountId !== proposal.strategyAccountId
          || assignment.source !== "explicit"
          || assignment.programVersionId !== proposal.programVersionId || !version
          || version.contentHash !== proposal.controllerRef.contentHash
          || String(assignment._id) !== proposal.controllerRef.controllerId
          || String(version._id) !== proposal.controllerRef.controllerVersionId
          || proposal.controllerMode !== "shadow" || (assignment.controllerMode ?? "shadow") !== "shadow"
          || rows.filter((row: any) => row.status === "active").length !== 1) {
        throw new Error("Managed program assignment changed before Shadow simulation.");
      }
    }
    await requireLifecycleDecision(ctx, { decisionHash: proposal.lifecycleDecisionHash,
      artifactId: `proposal:${proposal.analysisId}`, sink: "convex.analysis_projection",
      strategyAccountId: proposal.strategyAccountId,
      actualPayload: { artifact_type: "trade_proposal", content: proposal.payloadJson } });
    const bindings = {
      account: String(proposalPayload.account_id), analysis_id: String(proposalPayload.analysis_id),
      market: String(proposalPayload.market).toUpperCase(), quote_reference: args.quoteReference,
      venue: String(proposalPayload.candidate_venues?.[0] ?? "").toLowerCase(),
    };
    await requireV2SafetyDecision(ctx, {
      decisionHash: args.safetyDecisionHash, operation: "simulate",
      subjectKey: proposalPayload.analysis_id, strategyAccountId: proposal.strategyAccountId,
      bindings, request: { proposal: proposalPayload, quote: {
        reference: args.quoteReference, price: args.entryPrice,
      } },
    });
    if (args.entryPrice <= 0 || args.sizeUsd <= 0) throw new Error("Invalid simulated fill.");
    const now = Date.now();
    const executionId = await ctx.db.insert("shadowExecutions", {
      proposalId: proposal._id,
      ...(proposal.teamId ? { teamId: proposal.teamId } : {}),
      ...(proposal.teamVersionId ? { teamVersionId: proposal.teamVersionId } : {}),
      ...(proposal.deploymentId ? { deploymentId: proposal.deploymentId } : {}),
      ...(proposal.programAssignmentId ? { programAssignmentId: proposal.programAssignmentId } : {}),
      ...(proposal.programVersionId ? { programVersionId: proposal.programVersionId } : {}),
      strategyAccountId: proposal.strategyAccountId,
      userId: proposal.userId,
      marketId: proposal.marketId,
      side: proposal.side,
      status: "open",
      entryPrice: args.entryPrice,
      markPrice: args.entryPrice,
      sizeUsd: args.sizeUsd,
      unrealizedPnlUsd: 0,
      realizedPnlUsd: 0,
      quoteReference: args.quoteReference,
      safetyDecisionHash: args.safetyDecisionHash,
      openedAt: now,
      updatedAt: now,
    });
    return { executionId, duplicate: false };
  },
});

export const getAnalysisJob = internalQuery({
  args: { jobId: v.id("analysisJobs") },
  handler: async (ctx, args) => await ctx.db.get(args.jobId),
});

export const listActivePublicDemand = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("publicMarketDemand").collect();
    return rows.filter((row) => row.expiresAt > now);
  },
});

export const cancelAutomaticAnalysisJobs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const batches = await Promise.all(["queued", "claimed", "running"].map((status) =>
      ctx.db.query("analysisJobs").withIndex("by_status", (q) => q.eq("status", status as any)).take(100),
    ));
    const automatic = batches.flat().filter((row) =>
      row.trigger === "viewer_demand" || row.trigger.startsWith("cadence:"));
    const now = Date.now();
    for (const row of automatic) {
      await ctx.db.patch(row._id, {
        status: "cancelled", holderId: undefined, leaseExpiresAt: undefined,
        error: "Automatic analysis disabled by operator", completedAt: now, updatedAt: now,
      });
    }
    return { cancelled: automatic.length };
  },
});
