import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { intelligenceTier, authorityMode, analysisCadence } from "./agentValidators";
import { requireViewerStrategy } from "./model";
import { parseModelRouting } from "./helpers/modelRouting";
import { presetRouting } from "../lib/modelProviders";
import { defaultTeamConfig, teamConfigValidator, validateTeamConfig } from "./helpers/teamConfig";

async function owner(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in to manage teams.");
  const state = await requireViewerStrategy(ctx, identity.subject);
  if (!state.user || !state.strategyAccount) throw new Error("Set up your strategy account before creating teams.");
  return state as { user: { _id: any }; strategyAccount: { _id: any; status: string; emergencyStop: boolean } };
}

async function assertTeam(ctx: any, teamId: any, state: Awaited<ReturnType<typeof owner>>) {
  const team = await ctx.db.get(teamId);
  if (!team || team.archivedAt || team.userId !== state.user._id || team.strategyAccountId !== state.strategyAccount._id) {
    throw new Error("Team not found in your account.");
  }
  return team;
}

async function accountCapital(ctx: any, accountId: any) {
  const assets = await ctx.db.query("walletAssetStates")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", accountId)).collect();
  const capital = assets.filter((row: any) => row.includedInStrategyEquity);
  if (!capital.length || capital.some((row: any) => row.lastObservedAt < Date.now() - 300_000
      || !Number.isFinite(row.valueUsd))) return null;
  return capital.reduce((sum: number, row: any) => sum + Math.max(0, row.valueUsd), 0);
}

async function assertAllocation(ctx: any, accountId: any, teamId: any, allocation: number) {
  if (!allocation) return;
  const capital = await accountCapital(ctx, accountId);
  if (capital === null) throw new Error("Account capital is unavailable or stale. Refresh balances before reserving funds.");
  const peers = await ctx.db.query("agentProfiles")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", accountId)).collect();
  const reserved = peers.filter((row: any) => row._id !== teamId && !row.archivedAt)
    .reduce((sum: number, row: any) => sum + (row.allocationUsd ?? 0), 0);
  if (reserved + allocation > capital) throw new Error("Team allocations exceed available account capital.");
}

async function assertRoutingOwnership(ctx: any, accountId: any, json: string) {
  const routing = parseModelRouting(json, true);
  for (const route of routing.routes.filter((item) => item.credentialSource === "byok")) {
    const connection = await ctx.db.get(route.connectionId);
    if (!connection || connection.strategyAccountId !== accountId || connection.status !== "verified"
        || connection.provider !== route.provider) throw new Error("A selected model needs a verified provider connection.");
  }
  return routing;
}

async function futureTeamRouting(ctx: any, accountId: any) {
  const defaults = await ctx.db.query("agentTeamModelDefaults")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", accountId)).first();
  if (defaults) return { routesJson: defaults.routesJson, preset: defaults.preset };
  const legacy = await ctx.db.query("agentModelConfigurations")
    .withIndex("by_strategyAccountId_status", (q: any) =>
      q.eq("strategyAccountId", accountId).eq("status", "active")).first();
  return { routesJson: legacy?.routesJson ?? JSON.stringify(presetRouting("economy")),
    preset: legacy?.preset ?? "economy" };
}

export const create = mutation({
  args: { name: v.string(), tier: intelligenceTier },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 60) throw new Error("Team name must be 2–60 characters.");
    const peers = await ctx.db.query("agentProfiles")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
    if (peers.filter((row: any) => !row.archivedAt).length >= 12) throw new Error("This account already has 12 active teams.");
    const defaults = await futureTeamRouting(ctx, state.strategyAccount._id);
    const config = defaultTeamConfig(args.tier, defaults.routesJson);
    config.modelPreset = defaults.preset;
    const now = Date.now();
    const teamId = await ctx.db.insert("agentProfiles", {
      strategyAccountId: state.strategyAccount._id, userId: state.user._id, name,
      tier: args.tier, authorityMode: "shadow", cadence: config.cadence, watchMarkets: [],
      eventTriggers: [], dailyCreditLimit: config.dailyCreditLimit, paused: true,
      lifecycleStatus: "draft", allocationUsd: 0, version: 1, createdAt: now, updatedAt: now,
    });
    const versionId = await ctx.db.insert("agentTeamVersions", {
      teamId, strategyAccountId: state.strategyAccount._id, userId: state.user._id,
      version: 1, status: "saved", configJson: JSON.stringify(config), createdAt: now,
    });
    await ctx.db.patch(teamId, { currentTeamVersionId: versionId });
    return { teamId, versionId };
  },
});

export const createFromPreset = mutation({
  args: {
    name: v.string(), tier: intelligenceTier, markets: v.array(v.string()),
    allocationUsd: v.number(), virtualCapitalUsd: v.number(), cadence: analysisCadence,
    dailyCreditLimit: v.number(), dailyProviderBudgetMicrousd: v.number(),
    maxPositionUsd: v.number(), maxExposurePct: v.number(), maxLossUsd: v.number(),
    freshnessMs: v.number(),
  },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 60) throw new Error("Team name must be 2–60 characters.");
    const peers = await ctx.db.query("agentProfiles")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
    if (peers.filter((row: any) => !row.archivedAt).length >= 12) throw new Error("This account already has 12 active teams.");
    const defaults = await futureTeamRouting(ctx, state.strategyAccount._id);
    const base = defaultTeamConfig(args.tier, defaults.routesJson);
    base.modelPreset = defaults.preset;
    const config = validateTeamConfig({ ...base, markets: args.markets,
      allocationUsd: args.allocationUsd, virtualCapitalUsd: args.virtualCapitalUsd,
      cadence: args.cadence, dailyCreditLimit: args.dailyCreditLimit,
      dailyProviderBudgetMicrousd: args.dailyProviderBudgetMicrousd,
      maxPositionUsd: args.maxPositionUsd, maxExposurePct: args.maxExposurePct,
      maxLossUsd: args.maxLossUsd, freshnessMs: args.freshnessMs });
    await assertRoutingOwnership(ctx, state.strategyAccount._id, config.modelRoutingJson);
    await assertAllocation(ctx, state.strategyAccount._id, "", config.allocationUsd);
    const now = Date.now();
    const teamId = await ctx.db.insert("agentProfiles", {
      strategyAccountId: state.strategyAccount._id, userId: state.user._id, name,
      tier: config.tier, authorityMode: "shadow", cadence: config.cadence,
      watchMarkets: [], eventTriggers: [], dailyCreditLimit: config.dailyCreditLimit,
      paused: true, lifecycleStatus: "draft", allocationUsd: config.allocationUsd,
      version: 1, createdAt: now, updatedAt: now,
    });
    const versionId = await ctx.db.insert("agentTeamVersions", {
      teamId, strategyAccountId: state.strategyAccount._id, userId: state.user._id,
      version: 1, status: "saved", configJson: JSON.stringify(config), createdAt: now,
    });
    await ctx.db.patch(teamId, { currentTeamVersionId: versionId });
    return { teamId, versionId };
  },
});

export const saveVersion = mutation({
  args: { teamId: v.id("agentProfiles"), config: teamConfigValidator },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    const team = await assertTeam(ctx, args.teamId, state);
    const config = validateTeamConfig(args.config);
    await assertRoutingOwnership(ctx, state.strategyAccount._id, config.modelRoutingJson);
    await assertAllocation(ctx, state.strategyAccount._id, args.teamId, config.allocationUsd);
    if (config.allocationUsd < (team.allocationUsd ?? 0)) {
      const deployments = await ctx.db.query("agentMarketDeployments")
        .withIndex("by_teamId_marketId", (q: any) => q.eq("teamId", team._id)).collect();
      if (deployments.some((row: any) => row.status === "active" || row.mode === "approval_required" || row.mode === "autopilot")) {
        throw new Error("Pause funded deployments and reconcile open obligations before reducing this team's allocation.");
      }
    }
    const latest = await ctx.db.query("agentTeamVersions")
      .withIndex("by_teamId", (q: any) => q.eq("teamId", args.teamId)).order("desc").first();
    const version = (latest?.version ?? 0) + 1;
    const versionId = await ctx.db.insert("agentTeamVersions", {
      teamId: args.teamId, strategyAccountId: state.strategyAccount._id, userId: state.user._id,
      version, status: "saved", configJson: JSON.stringify(config), createdAt: Date.now(),
    });
    await ctx.db.patch(team._id, { currentTeamVersionId: versionId,
      allocationUsd: config.allocationUsd, updatedAt: Date.now() });
    const draft = await ctx.db.query("agentTeamDrafts")
      .withIndex("by_teamId", (q: any) => q.eq("teamId", args.teamId)).first();
    if (draft) await ctx.db.delete(draft._id);
    return { teamId: args.teamId, versionId, version };
  },
});

export const saveDraft = mutation({
  args: { teamId: v.id("agentProfiles"), config: teamConfigValidator },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    await assertTeam(ctx, args.teamId, state);
    const existing = await ctx.db.query("agentTeamDrafts")
      .withIndex("by_teamId", (q: any) => q.eq("teamId", args.teamId)).first();
    const values = { teamId: args.teamId, strategyAccountId: state.strategyAccount._id,
      userId: state.user._id, configJson: JSON.stringify(args.config), updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("agentTeamDrafts", values);
    return { saved: true };
  },
});

export const duplicate = mutation({
  args: { teamId: v.id("agentProfiles"), name: v.string() },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    const source = await assertTeam(ctx, args.teamId, state);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 60) throw new Error("Team name must be 2–60 characters.");
    const latest = await ctx.db.query("agentTeamVersions")
      .withIndex("by_teamId", (q: any) => q.eq("teamId", source._id)).order("desc").first();
    if (!latest) throw new Error("Save this team before duplicating it.");
    const peers = await ctx.db.query("agentProfiles")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
    if (peers.filter((row: any) => !row.archivedAt).length >= 12) throw new Error("This account already has 12 active teams.");
    const config = JSON.parse(latest.configJson);
    config.allocationUsd = 0;
    const now = Date.now();
    const teamId = await ctx.db.insert("agentProfiles", {
      strategyAccountId: state.strategyAccount._id, userId: state.user._id, name,
      tier: config.tier, authorityMode: "shadow", cadence: config.cadence,
      watchMarkets: [], eventTriggers: [], dailyCreditLimit: config.dailyCreditLimit,
      paused: true, lifecycleStatus: "draft", allocationUsd: 0, version: 1,
      createdAt: now, updatedAt: now,
    });
    const versionId = await ctx.db.insert("agentTeamVersions", {
      teamId, strategyAccountId: state.strategyAccount._id, userId: state.user._id,
      version: 1, status: "saved", configJson: JSON.stringify(config), createdAt: now,
    });
    await ctx.db.patch(teamId, { currentTeamVersionId: versionId });
    return { teamId, versionId };
  },
});

export const configureMarket = mutation({
  args: { teamId: v.id("agentProfiles"), versionId: v.id("agentTeamVersions"),
    marketId: v.string(), venue: v.string(), mode: authorityMode },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    const team = await assertTeam(ctx, args.teamId, state);
    const version = await ctx.db.get(args.versionId);
    if (!version || version.teamId !== team._id) throw new Error("Saved team version not found.");
    const config = validateTeamConfig(JSON.parse(version.configJson));
    const marketId = args.marketId.trim().toUpperCase();
    if (!config.markets.includes(marketId)) throw new Error("Add this market to the saved team version first.");
    if (!/^[a-z0-9_-]{2,40}$/.test(args.venue)) throw new Error("Choose a supported venue.");
    const funded = args.mode !== "shadow" && args.mode !== "insights";
    if (funded) {
      if (!config.allocationUsd) throw new Error("Set a trading allocation before choosing Approval or Autopilot.");
      await assertAllocation(ctx, state.strategyAccount._id, team._id, config.allocationUsd);
      const competing = await ctx.db.query("agentMarketDeployments")
        .withIndex("by_strategyAccountId_marketId", (q: any) =>
          q.eq("strategyAccountId", state.strategyAccount._id).eq("marketId", marketId)).collect();
      if (competing.some((row: any) => row.teamId !== team._id && row.venue === args.venue
          && row.mode !== "shadow" && row.status !== "paused")) {
        throw new Error("Another team controls funded trading on this market and venue. Pause or resolve its position first.");
      }
    }
    const existing = await ctx.db.query("agentMarketDeployments")
      .withIndex("by_teamId_marketId", (q: any) => q.eq("teamId", team._id).eq("marketId", marketId)).first();
    const now = Date.now();
    const values = {
      teamId: team._id, teamVersionId: version._id, strategyAccountId: state.strategyAccount._id,
      userId: state.user._id, marketId, venue: args.venue, mode: args.mode,
      status: "paused" as const, blockedReason: undefined, updatedAt: now,
    };
    const deploymentId = existing
      ? (await ctx.db.patch(existing._id, values), existing._id)
      : await ctx.db.insert("agentMarketDeployments", { ...values, createdAt: now });
    return { deploymentId, status: "paused" as const };
  },
});

export const pauseDeployment = mutation({
  args: { deploymentId: v.id("agentMarketDeployments") },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    const deployment = await ctx.db.get(args.deploymentId);
    if (!deployment || deployment.userId !== state.user._id
        || deployment.strategyAccountId !== state.strategyAccount._id) {
      throw new Error("Market deployment not found in your account.");
    }
    if (deployment.status !== "paused") {
      const now = Date.now();
      await ctx.db.patch(deployment._id, { status: "paused", updatedAt: now });
      await ctx.db.insert("auditEvents", {
        strategyAccountId: state.strategyAccount._id, userId: state.user._id,
        actor: "viewer", kind: "agent.deployment.paused",
        summary: `Paused future team work on ${deployment.marketId}`,
        refTable: "agentMarketDeployments", refId: String(deployment._id), createdAt: now,
      });
    }
    return { deploymentId: deployment._id, status: "paused" as const,
      message: "Future team work is paused. Existing positions and obligations remain for review." };
  },
});
