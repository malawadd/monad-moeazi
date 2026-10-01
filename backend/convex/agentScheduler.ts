import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const ACTIVE = new Set(["queued", "claimed", "running"]);
const CADENCE_MS = { "15m": 900_000, "5m": 300_000, "2m": 120_000, "1m": 60_000 } as const;

export const scheduleDueAnalysisJobs = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 100)));
    const profiles = await ctx.db.query("agentProfiles")
      .withIndex("by_nextRunAt", (q) => q.lte("nextRunAt", now)).take(limit);
    let created = 0;
    for (const profile of profiles) {
      if (profile.archivedAt || profile.paused || profile.cadence === "on_demand") continue;
      const strategy = await ctx.db.get(profile.strategyAccountId);
      const cadenceMs = CADENCE_MS[profile.cadence];
      await ctx.db.patch(profile._id, { nextRunAt: now + cadenceMs, updatedAt: now });
      if (!strategy || strategy.status !== "active" || strategy.emergencyStop) continue;
      for (const marketId of profile.watchMarkets) {
        const jobs = await ctx.db.query("analysisJobs")
          .withIndex("by_scope_marketId", (q) => q.eq("scope", "private").eq("marketId", marketId)).collect();
        const overlapping = jobs.some((job) => job.strategyAccountId === profile.strategyAccountId && ACTIVE.has(job.status));
        if (overlapping) continue;
        const bucket = Math.floor(now / cadenceMs);
        await ctx.db.insert("analysisJobs", {
          strategyAccountId: profile.strategyAccountId, userId: profile.userId, scope: "private",
          marketId, tier: profile.tier, trigger: `cadence:${profile.cadence}`, status: "queued",
          dedupeKey: `cadence:${profile.strategyAccountId}:${marketId}:${bucket}`,
          reservedCredits: 0, attempt: 0, createdAt: now, updatedAt: now,
        });
        created += 1;
      }
    }
    return { profiles: profiles.length, created };
  },
});
