import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerStrategy } from "./model";
import type { Id } from "./_generated/dataModel";
import { parseModelRouting } from "./helpers/modelRouting";
import { presetRouting } from "../lib/modelProviders";

const preset = v.union(v.literal("economy"), v.literal("balanced"), v.literal("quality"), v.literal("custom"));

async function owner(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in to manage model defaults.");
  const state = await requireViewerStrategy(ctx, identity.subject);
  if (!state.user || !state.strategyAccount) throw new Error("Set up a strategy account before saving model defaults.");
  return state as { user: { _id: any }; strategyAccount: { _id: any } };
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const state = await owner(ctx);
    const saved = await ctx.db.query("agentTeamModelDefaults")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", state.strategyAccount._id)).first();
    if (saved) return { preset: saved.preset, routesJson: saved.routesJson, version: saved.version, seeded: true };
    const legacy = await ctx.db.query("agentModelConfigurations")
      .withIndex("by_strategyAccountId_status", (q) =>
        q.eq("strategyAccountId", state.strategyAccount._id).eq("status", "active")).first();
    return { preset: legacy?.preset ?? "economy", routesJson: legacy?.routesJson ?? JSON.stringify(presetRouting("economy")),
      version: 0, seeded: false };
  },
});

export const save = mutation({
  args: { preset, routesJson: v.string(), expectedVersion: v.number() },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    const routing = parseModelRouting(args.routesJson, true);
    for (const route of routing.routes.filter((item) => item.credentialSource === "byok")) {
      const connection = await ctx.db.get(route.connectionId as Id<"modelProviderConnections">);
      if (!connection || connection.strategyAccountId !== state.strategyAccount._id
        || connection.userId !== state.user._id || connection.status !== "verified"
        || connection.provider !== route.provider) {
        throw new Error(`The ${route.slot} route needs a verified ${route.provider} connection owned by this account.`);
      }
    }
    const existing = await ctx.db.query("agentTeamModelDefaults")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", state.strategyAccount._id)).first();
    if ((existing?.version ?? 0) !== args.expectedVersion) {
      throw new Error("Defaults changed in another tab. Refresh and review them before saving.");
    }
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { preset: args.preset, routesJson: JSON.stringify(routing),
        version: existing.version + 1, updatedAt: now });
      return { version: existing.version + 1 };
    }
    await ctx.db.insert("agentTeamModelDefaults", { strategyAccountId: state.strategyAccount._id,
      userId: state.user._id, preset: args.preset, routesJson: JSON.stringify(routing),
      version: 1, createdAt: now, updatedAt: now });
    return { version: 1 };
  },
});

// Bounded and idempotent. This records future-team defaults without touching active routes or teams.
export const migrate = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("strategyAccounts").paginate({ cursor: args.cursor ?? null, numItems: 20 });
    let migrated = 0;
    for (const account of page.page) {
      const existing = await ctx.db.query("agentTeamModelDefaults")
        .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", account._id)).first();
      if (existing) continue;
      const legacy = await ctx.db.query("agentModelConfigurations")
        .withIndex("by_strategyAccountId_status", (q) =>
          q.eq("strategyAccountId", account._id).eq("status", "active")).first();
      const now = Date.now();
      await ctx.db.insert("agentTeamModelDefaults", { strategyAccountId: account._id, userId: account.userId,
        preset: legacy?.preset ?? "economy",
        routesJson: legacy?.routesJson ?? JSON.stringify(presetRouting("economy")),
        version: 1, createdAt: now, updatedAt: now });
      migrated++;
    }
    return { migrated, examined: page.page.length, isDone: page.isDone,
      nextCursor: page.isDone ? null : page.continueCursor };
  },
});
