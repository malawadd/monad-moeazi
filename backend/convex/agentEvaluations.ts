import { v } from "convex/values";
import { internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { parseModelRouting } from "./helpers/modelRouting";

async function ownerForSubject(ctx: QueryCtx, subject: string) {
  const user = await ctx.db.query("users")
    .withIndex("by_authSubject", (q) => q.eq("authSubject", subject)).first();
  if (!user) return null;
  const strategy = await ctx.db.query("strategyAccounts")
    .withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
  return strategy ? { userId: user._id, strategyAccountId: strategy._id } : null;
}

export const listModelConfigurations = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, args) => {
    const owner = await ownerForSubject(ctx, args.subject);
    if (!owner) return [];
    const rows = await ctx.db.query("agentModelConfigurations")
      .withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", owner.strategyAccountId))
      .order("desc").take(50);
    return rows.map((row) => ({
      version: row.version, status: row.status, preset: row.preset,
      routes: parseModelRouting(row.routesJson),
      estimatedCredits: row.estimatedCredits,
      estimatedProviderCostMicrousd: row.estimatedProviderCostMicrousd,
      maximumProviderCostMicrousd: row.maximumProviderCostMicrousd,
      createdAt: row.createdAt, activatedAt: row.activatedAt,
    }));
  },
});

export const getModelConfiguration = internalQuery({
  args: { subject: v.string(), version: v.number() },
  handler: async (ctx, args) => {
    const owner = await ownerForSubject(ctx, args.subject);
    if (!owner) return null;
    const rows = await ctx.db.query("agentModelConfigurations")
      .withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", owner.strategyAccountId))
      .collect();
    const config = rows.find((row) => row.version === args.version);
    if (!config) return null;
    const routing = parseModelRouting(config.routesJson);
    const connectionIds = [...new Set(
      routing.routes.filter((route) => route.connectionId).map((route) => route.connectionId!),
    )];
    const connections: Array<{
      id: string; provider: "openai" | "deepseek" | "openrouter";
      status: string; secretRef: string;
    }> = [];
    for (const id of connectionIds) {
      const row = await ctx.db.get(id as Id<"modelProviderConnections">);
      if (row && row.strategyAccountId === owner.strategyAccountId) connections.push({
        id: String(row._id), provider: row.provider,
        status: row.status, secretRef: row.secretRef,
      });
    }
    return {
      ...config, strategyAccountId: owner.strategyAccountId,
      routes: routing, connections,
    };
  },
});
