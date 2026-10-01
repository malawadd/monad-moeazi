import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerStrategy } from "./model";

function parseJson(value: string | undefined, fallback: unknown = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeMarket(value: string) {
  return value.trim().toUpperCase();
}

function normalizeMode(value: string | undefined) {
  return value === "insights" || value === "shadow" ? "shadow" : value ?? "shadow";
}

function readableProfile(profile: any) {
  if (!profile) return null;
  return {
    ...profile,
    authorityMode: normalizeMode(profile.authorityMode),
    effectiveAuthority: normalizeMode(profile.effectiveAuthority ?? profile.authorityMode),
    lifecycleStatus: profile.lifecycleStatus ?? (profile.paused ? "paused" : "draft"),
    name: profile.name ?? "My market agent",
  };
}

async function viewer(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const state = await requireViewerStrategy(ctx, identity.subject);
  return state.user && state.strategyAccount ? state : null;
}

function materialize(snapshot: any) {
  if (!snapshot) return null;
  return {
    analysisId: snapshot.analysisId,
    scope: snapshot.scope,
    marketId: snapshot.marketId,
    tier: snapshot.tier,
    status: snapshot.status,
    sourceFreshnessMs: snapshot.sourceFreshnessMs,
    validUntil: snapshot.validUntil,
    createdAt: snapshot.createdAt,
    providers: parseJson(snapshot.providersJson, []),
    visualization: parseJson(snapshot.payloadJson, {}),
  };
}

export const getPublicMarketAnalysis = query({
  args: { marketId: v.string() },
  handler: async (ctx, args) => {
    const marketId = normalizeMarket(args.marketId);
    const snapshot = await ctx.db.query("analysisSnapshots")
      .withIndex("by_scope_marketId", (q: any) => q.eq("scope", "public").eq("marketId", marketId))
      .order("desc").first();
    return {
      analysis: materialize(snapshot),
      stale: !snapshot || snapshot.validUntil <= Date.now(),
    };
  },
});

export const getAccountMarketAnalysis = query({
  args: { marketId: v.string() },
  handler: async (ctx, args) => {
    const state = await viewer(ctx);
    if (!state) return null;
    const marketId = normalizeMarket(args.marketId);
    const deployments = await ctx.db.query("agentMarketDeployments")
      .withIndex("by_strategyAccountId_marketId", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id).eq("marketId", marketId)).collect();
    const selected = deployments.length === 1 ? deployments[0] : null;
    const [privateSnapshot, publicSnapshot, profile] = await Promise.all([
      selected ? ctx.db.query("analysisSnapshots")
        .withIndex("by_deploymentId", (q: any) => q.eq("deploymentId", selected._id))
        .order("desc").first() : Promise.resolve(null),
      ctx.db.query("analysisSnapshots")
        .withIndex("by_scope_marketId", (q: any) => q.eq("scope", "public").eq("marketId", marketId))
        .order("desc").first(),
      selected ? ctx.db.get(selected.teamId) : Promise.resolve(null),
    ]);
    const visible = privateSnapshot ?? publicSnapshot;
    return {
      analysis: materialize(visible),
      personalized: Boolean(privateSnapshot),
      profile: readableProfile(profile),
      executionBlocked: Boolean(!selected || selected.status !== "active" || profile?.paused || state.strategyAccount.emergencyStop),
    };
  },
});

export const getAgentSettings = query({
  args: {},
  handler: async (ctx) => {
    const state = await viewer(ctx);
    if (!state) return null;
    const [profiles, activePolicy, drafts, creditAccount, proposals, approvals, modelConfiguration] = await Promise.all([
      ctx.db.query("agentProfiles")
        .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id)).collect(),
      ctx.db.query("automationPolicies")
        .withIndex("by_strategyAccountId_status", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id).eq("status", "active")).first(),
      ctx.db.query("automationPolicies")
        .withIndex("by_strategyAccountId_status", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id).eq("status", "draft"))
        .order("desc").take(5),
      ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) => q.eq("userId", state.user._id)).first(),
      ctx.db.query("tradeProposals").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id))
        .order("desc").take(20),
      ctx.db.query("approvalRequests").withIndex("by_userId_status", (q: any) => q.eq("userId", state.user._id).eq("status", "pending"))
        .order("desc").take(20),
      ctx.db.query("agentModelConfigurations").withIndex("by_strategyAccountId_status", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id).eq("status", "active")).first(),
    ]);
    const activeProfiles = profiles.filter((item: any) => !item.archivedAt);
    const versions = await Promise.all(activeProfiles.map((item: any) =>
      item.currentTeamVersionId ? ctx.db.get(item.currentTeamVersionId) : Promise.resolve(null)));
    const profile = activeProfiles.find((_item: any, index: number) =>
      (versions[index] as { status?: string } | null)?.status === "legacy")
      ?? (activeProfiles.length === 1 ? activeProfiles[0] : null);
    return {
      profile: readableProfile(profile),
      activePolicy: activePolicy ? { ...activePolicy, policy: parseJson(activePolicy.policyJson, {}) } : null,
      drafts: drafts.map((row: any) => ({ ...row, policy: parseJson(row.policyJson, {}), diff: parseJson(row.diffJson, {}) })),
      credits: creditAccount ? { balance: creditAccount.balance, reserved: creditAccount.reserved, available: creditAccount.balance - creditAccount.reserved } : null,
      proposals: proposals.map((row: any) => ({ ...row, payload: parseJson(row.payloadJson, {}) })),
      approvals,
      modelConfiguration: modelConfiguration ? {
        ...modelConfiguration, routes: parseJson(modelConfiguration.routesJson, {}),
      } : null,
      emergencyStop: state.strategyAccount.emergencyStop,
    };
  },
});

export const getTradeAgentSummary = query({
  args: { marketId: v.string(), teamId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const state = await viewer(ctx);
    if (!state) return { signedIn: false, agent: null };
    const marketId = normalizeMarket(args.marketId);
    const deployments = await ctx.db.query("agentMarketDeployments")
      .withIndex("by_strategyAccountId_marketId", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id).eq("marketId", marketId)).collect();
    const selected = args.teamId
      ? deployments.filter((row) => String(row.teamId) === args.teamId) : deployments;
    if (selected.length !== 1) return { signedIn: true, agent: null,
      selectionRequired: deployments.length > 1 };
    const deployment = selected[0];
    const [profile, snapshot, latestProposal, pending, shadows] = await Promise.all([
      ctx.db.get(deployment.teamId),
      ctx.db.query("analysisSnapshots")
        .withIndex("by_deploymentId", (q: any) => q.eq("deploymentId", deployment._id)).first(),
      ctx.db.query("tradeProposals")
        .withIndex("by_deploymentId", (q: any) => q.eq("deploymentId", deployment._id))
        .order("desc").first(),
      ctx.db.query("approvalRequests")
        .withIndex("by_deploymentId_status", (q: any) =>
          q.eq("deploymentId", deployment._id).eq("status", "pending")).take(20),
      ctx.db.query("shadowExecutions")
        .withIndex("by_deploymentId", (q: any) => q.eq("deploymentId", deployment._id))
        .order("desc").take(20),
    ]);
    if (!profile || profile.strategyAccountId !== state.strategyAccount._id) return { signedIn: true, agent: null };
    const shadow = shadows.find((row) => row.status === "open");
    const payload = parseJson(snapshot?.payloadJson, {}) as any;
    const consensus = Number(payload?.consensus ?? payload?.visualization?.consensus ?? 0);
    const confidence = Number(payload?.confidence ?? payload?.visualization?.confidence ?? 0);
    const thesis = payload?.summary ?? payload?.thesis ??
      (consensus > 0.15 ? "Evidence leans bullish." : consensus < -0.15 ? "Evidence leans bearish." : "Evidence remains mixed.");
    return {
      signedIn: true,
      agent: {
        profile: readableProfile({ ...profile, authorityMode: deployment.mode }),
        deploymentId: deployment._id,
        marketId,
        thesis,
        confidence,
        freshnessMs: snapshot ? Math.max(0, Date.now() - snapshot.createdAt) : null,
        latestAction: latestProposal ? {
          side: latestProposal.side, status: latestProposal.status,
          createdAt: latestProposal.createdAt, payload: parseJson(latestProposal.payloadJson, {}),
        } : null,
        pendingApprovals: pending.length,
        shadow: shadow ? {
          sizeUsd: shadow.sizeUsd, unrealizedPnlUsd: shadow.unrealizedPnlUsd,
          entryPrice: shadow.entryPrice, markPrice: shadow.markPrice,
        } : null,
        health: deployment.status !== "active" || profile.paused || state.strategyAccount.emergencyStop ? "paused or blocked" : "healthy",
        scenarios: payload?.visualization?.scenarios ?? payload?.scenarios ?? [],
        conflicts: payload?.conflicts ?? payload?.visualization?.conflicts ?? [],
      },
    };
  },
});

export const getAgentActivity = query({
  args: {},
  handler: async (ctx) => {
    const state = await viewer(ctx);
    if (!state) return null;
    const id = state.strategyAccount._id;
    const [jobs, proposals, shadowExecutions, audits] = await Promise.all([
      ctx.db.query("analysisJobs").withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", id)).order("desc").take(30),
      ctx.db.query("tradeProposals").withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", id)).order("desc").take(30),
      ctx.db.query("shadowExecutions").withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", id)).order("desc").take(30),
      ctx.db.query("auditEvents").withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", id)).order("desc").take(30),
    ]);
    return {
      jobs,
      proposals: proposals.map((row: any) => ({ ...row, payload: parseJson(row.payloadJson, {}) })),
      shadowExecutions,
      audits: audits.map((row: any) => ({ ...row, detailData: parseJson(row.detail, {}) })),
    };
  },
});

export const getCredits = query({
  args: {},
  handler: async (ctx) => {
    const state = await viewer(ctx);
    if (!state) return null;
    const account = await ctx.db.query("creditAccounts")
      .withIndex("by_userId", (q: any) => q.eq("userId", state.user._id)).first();
    if (!account) return { balance: 0, reserved: 0, available: 0, ledger: [], claimedStarter: false };
    const [ledger, claim] = await Promise.all([
      ctx.db.query("creditLedger").withIndex("by_userId", (q: any) =>
        q.eq("userId", state.user._id)).order("desc").take(50),
      ctx.db.query("creditClaims").withIndex("by_userId_kind", (q: any) =>
        q.eq("userId", state.user._id).eq("kind", "development_starter")).first(),
    ]);
    return {
      balance: account.balance,
      reserved: account.reserved,
      available: account.balance - account.reserved,
      ledger: ledger.map((row: any) => ({ ...row, metadata: parseJson(row.metadataJson, {}) })),
      claimedStarter: Boolean(claim),
    };
  },
});
