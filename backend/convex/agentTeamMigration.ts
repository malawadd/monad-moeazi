import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { defaultTeamConfig } from "./helpers/teamConfig";
import { defaultModelRouting } from "./helpers/modelRouting";

// Bounded, idempotent migration. It records existing state without scheduling work.
export const run = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("agentProfiles")
      .paginate({ cursor: args.cursor ?? null, numItems: 20 });
    let migrated = 0;
    for (const team of page.page) {
      const existing = await ctx.db.query("agentTeamVersions")
        .withIndex("by_teamId", (q) => q.eq("teamId", team._id)).first();
      if (existing) continue;
      const routing = await ctx.db.query("agentModelConfigurations")
        .withIndex("by_strategyAccountId_status", (q) =>
          q.eq("strategyAccountId", team.strategyAccountId).eq("status", "active")).first();
      const config = defaultTeamConfig(team.tier,
        routing?.routesJson ?? JSON.stringify(defaultModelRouting()));
      config.markets = [...new Set(team.watchMarkets.map((market) => market.toUpperCase()))];
      config.cadence = team.cadence;
      config.dailyCreditLimit = team.dailyCreditLimit;
      const now = Date.now();
      const versionId = await ctx.db.insert("agentTeamVersions", {
        teamId: team._id, strategyAccountId: team.strategyAccountId, userId: team.userId,
        version: 1, status: "legacy", configJson: JSON.stringify(config), createdAt: now,
      });
      for (const marketId of config.markets) {
        const deployment = await ctx.db.query("agentMarketDeployments")
          .withIndex("by_teamId_marketId", (q) => q.eq("teamId", team._id).eq("marketId", marketId)).first();
        if (!deployment) await ctx.db.insert("agentMarketDeployments", {
          teamId: team._id, teamVersionId: versionId, strategyAccountId: team.strategyAccountId,
          userId: team.userId, marketId, venue: "hyperliquid", mode: team.authorityMode,
          status: team.paused ? "paused" : "active", createdAt: now, updatedAt: now,
        });
      }
      await ctx.db.patch(team._id, { currentTeamVersionId: versionId,
        allocationUsd: team.allocationUsd ?? 0 });
      migrated += 1;
    }
    return { migrated, examined: page.page.length, isDone: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor };
  },
});
