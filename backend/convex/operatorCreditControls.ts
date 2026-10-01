import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireProgramActor } from "./helpers/programScope";

const KEY = "development-analysis-credit-charging";

export async function chargingPaused(ctx: any): Promise<boolean> {
  if (process.env.AGENT_DEV_CONTROLS_ENABLED !== "true") return false;
  const row = await ctx.db.query("devCreditControls")
    .withIndex("by_key", (q: any) => q.eq("key", KEY)).first();
  return row?.chargingEnabled === false;
}

export const read = query({
  args: {},
  handler: async (ctx) => {
    await requireProgramActor(ctx, "operator");
    const row = await ctx.db.query("devCreditControls")
      .withIndex("by_key", (q) => q.eq("key", KEY)).first();
    return { enabled: process.env.AGENT_DEV_CONTROLS_ENABLED === "true",
      chargingEnabled: process.env.AGENT_DEV_CONTROLS_ENABLED === "true"
        ? row?.chargingEnabled !== false : true,
      version: row?.version ?? 0, updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null };
  },
});

export const set = mutation({
  args: { chargingEnabled: v.boolean(), expectedVersion: v.number() },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "operator");
    if (process.env.AGENT_DEV_CONTROLS_ENABLED !== "true") {
      throw new Error("Development credit controls are disabled.");
    }
    const row = await ctx.db.query("devCreditControls")
      .withIndex("by_key", (q) => q.eq("key", KEY)).first();
    if (args.expectedVersion !== (row?.version ?? 0)) {
      throw new Error("Credit controls changed. Refresh before trying again.");
    }
    const version = (row?.version ?? 0) + 1;
    const value = { chargingEnabled: args.chargingEnabled, version,
      updatedAt: Date.now(), updatedBy: actor.subject };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert("devCreditControls", { key: KEY, ...value });
    return { enabled: true, ...value };
  },
});
