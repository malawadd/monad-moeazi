import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  agentLifecycleStatus,
  analysisCadence,
  authorityMode,
  intelligenceTier,
} from "./agentValidators";
import { DEFAULT_AUTOMATION_POLICY, parseAutomationPolicy, validateProfileInput } from "./helpers/agentPolicy";
import { requireViewerStrategy } from "./model";

const CADENCE_MS = {
  on_demand: 0,
  "15m": 900_000,
  "5m": 300_000,
  "2m": 120_000,
  "1m": 60_000,
} as const;

function normalizeMarket(value: string) {
  const market = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_./:-]{0,63}$/.test(market)) throw new Error("Invalid market.");
  return market;
}

async function viewer(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication is required.");
  const state = await requireViewerStrategy(ctx, identity.subject);
  if (!state.user || !state.strategyAccount) throw new Error("Strategy account is required.");
  return state as { user: any; strategyAccount: any };
}

async function syncSubscriptions(
  ctx: any,
  profileId: any,
  state: { user: any; strategyAccount: any },
  markets: string[],
  now: number,
) {
  const existing = await ctx.db.query("agentMarketSubscriptions")
    .withIndex("by_profileId", (q: any) => q.eq("profileId", profileId)).collect();
  const wanted = new Set(markets);
  for (const row of existing) {
    await ctx.db.patch(row._id, { enabled: wanted.has(row.marketId), updatedAt: now });
    wanted.delete(row.marketId);
  }
  for (const marketId of wanted) {
    await ctx.db.insert("agentMarketSubscriptions", {
      profileId,
      strategyAccountId: state.strategyAccount._id,
      userId: state.user._id,
      marketId,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export const saveAgentProfile = mutation({
  args: {
    name: v.string(),
    tier: intelligenceTier,
    authorityMode,
    cadence: analysisCadence,
    watchMarkets: v.array(v.string()),
    eventTriggers: v.array(v.string()),
    dailyCreditLimit: v.number(),
  },
  handler: async (ctx, args) => {
    const state = await viewer(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 60) throw new Error("Agent name must be 2-60 characters.");
    validateProfileInput(args);
    const markets = [...new Set(args.watchMarkets.map(normalizeMarket))];
    if (markets.length === 0) throw new Error("Select at least one market.");
    const current = (await ctx.db.query("agentProfiles")
      .withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id)).collect()).find((row: any) => !row.archivedAt);
    const now = Date.now();
    const values = {
      name,
      tier: args.tier,
      authorityMode: args.authorityMode,
      cadence: args.cadence,
      watchMarkets: markets,
      eventTriggers: [...new Set(args.eventTriggers.map((item) => item.trim()).filter(Boolean))],
      dailyCreditLimit: args.dailyCreditLimit,
      lifecycleStatus: "draft" as const,
      paused: true,
      nextRunAt: undefined,
      scheduleRevision: (current?.scheduleRevision ?? 0) + 1,
      version: (current?.version ?? 0) + 1,
      userId: state.user._id,
      strategyAccountId: state.strategyAccount._id,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    const profileId = current
      ? (await ctx.db.patch(current._id, values), current._id)
      : await ctx.db.insert("agentProfiles", values);
    await syncSubscriptions(ctx, profileId, state, markets, now);
    return { profileId, lifecycleStatus: "draft" as const };
  },
});

export const activateAgentProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const state = await viewer(ctx);
    const profile = (await ctx.db.query("agentProfiles")
      .withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id)).collect()).find((row: any) => !row.archivedAt);
    if (!profile) throw new Error("Create your agent first.");
    const credit = await ctx.db.query("creditAccounts")
      .withIndex("by_userId", (q: any) => q.eq("userId", state.user._id)).first();
    if (!credit || credit.balance - credit.reserved <= 0) throw new Error("Credits are required.");
    let policy = await ctx.db.query("automationPolicies")
      .withIndex("by_strategyAccountId_status", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id).eq("status", "active")).first();
    const now = Date.now();
    if (!policy) {
      const policyId = await ctx.db.insert("automationPolicies", {
        strategyAccountId: state.strategyAccount._id,
        userId: state.user._id,
        version: 1,
        status: "active",
        sourceText: "Moeazi safe defaults",
        policyJson: JSON.stringify(DEFAULT_AUTOMATION_POLICY),
        createdAt: now,
        updatedAt: now,
        activatedAt: now,
      });
      policy = await ctx.db.get(policyId);
    }
    const cadenceMs = CADENCE_MS[profile.cadence];
    await ctx.db.patch(profile._id, {
      lifecycleStatus: "active",
      paused: false,
      activatedAt: profile.activatedAt ?? now,
      nextRunAt: cadenceMs ? now + cadenceMs : undefined,
      scheduleRevision: (profile.scheduleRevision ?? 0) + 1,
      version: profile.version + 1,
      updatedAt: now,
    });
    return { profileId: profile._id, policyId: policy?._id, lifecycleStatus: "active" as const };
  },
});

export const setAgentLifecycle = mutation({
  args: { status: agentLifecycleStatus },
  handler: async (ctx, args) => {
    const state = await viewer(ctx);
    const profile = (await ctx.db.query("agentProfiles")
      .withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id)).collect()).find((row: any) => !row.archivedAt);
    if (!profile) throw new Error("Agent not found.");
    if (args.status === "active") throw new Error("Use activation to resume this agent.");
    const now = Date.now();
    await ctx.db.patch(profile._id, {
      lifecycleStatus: args.status,
      paused: true,
      nextRunAt: undefined,
      scheduleRevision: (profile.scheduleRevision ?? 0) + 1,
      version: profile.version + 1,
      updatedAt: now,
    });
    return { profileId: profile._id, lifecycleStatus: args.status };
  },
});

export const saveAutomationPolicy = mutation({
  args: { policyJson: v.string() },
  handler: async (ctx, args) => {
    const state = await viewer(ctx);
    const next = parseAutomationPolicy(args.policyJson);
    const [latest, active] = await Promise.all([
      ctx.db.query("automationPolicies").withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id)).order("desc").first(),
      ctx.db.query("automationPolicies").withIndex("by_strategyAccountId_status", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id).eq("status", "active")).first(),
    ]);
    const previous = active ? parseAutomationPolicy(active.policyJson) : DEFAULT_AUTOMATION_POLICY;
    const diff = Object.fromEntries(Object.keys(next).filter((key) =>
      JSON.stringify(previous[key as keyof typeof previous])
        !== JSON.stringify(next[key as keyof typeof next]),
    ).map((key) => [key, {
      from: previous[key as keyof typeof previous],
      to: next[key as keyof typeof next],
    }]));
    const now = Date.now();
    const policyId = await ctx.db.insert("automationPolicies", {
      strategyAccountId: state.strategyAccount._id,
      userId: state.user._id,
      version: (latest?.version ?? 0) + 1,
      status: "draft",
      sourceText: "Edited in the guardrail editor",
      policyJson: JSON.stringify(next),
      diffJson: JSON.stringify(diff),
      createdAt: now,
      updatedAt: now,
    });
    return { policyId, version: (latest?.version ?? 0) + 1, diff };
  },
});
