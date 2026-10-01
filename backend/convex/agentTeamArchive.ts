import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerStrategy } from "./model";
import { teamArchiveBlockers } from "./helpers/teamArchive";

async function owned(ctx: any, teamId: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Sign in to manage this team.");
  const state = await requireViewerStrategy(ctx, identity.subject);
  const team = await ctx.db.get(teamId);
  if (!team || !state.user || !state.strategyAccount || team.userId !== state.user._id
      || team.strategyAccountId !== state.strategyAccount._id) {
    throw new Error("Team is unavailable in your account.");
  }
  return { state, team };
}

async function blockers(ctx: any, team: any) {
  const [deployments, ...obligations] = await Promise.all([
    ctx.db.query("agentMarketDeployments").withIndex("by_teamId_marketId", (q: any) => q.eq("teamId", team._id)).collect(),
    ...(["queued", "claimed", "running"] as const).map((status) =>
      ctx.db.query("analysisJobs").withIndex("by_teamId_status", (q: any) => q.eq("teamId", team._id).eq("status", status)).first()),
    ...(["pending_approval", "approved", "executing"] as const).map((status) =>
      ctx.db.query("tradeProposals").withIndex("by_teamId_status", (q: any) => q.eq("teamId", team._id).eq("status", status)).first()),
    ctx.db.query("approvalRequests").withIndex("by_teamId_status", (q: any) => q.eq("teamId", team._id).eq("status", "pending")).first(),
    ctx.db.query("shadowExecutions").withIndex("by_teamId_status", (q: any) => q.eq("teamId", team._id).eq("status", "open")).first(),
    ctx.db.query("creditReservations").withIndex("by_teamId_status", (q: any) => q.eq("teamId", team._id).eq("status", "active")).first(),
  ]);
  const present = (start: number, end: number) => obligations.slice(start, end).filter(Boolean);
  return teamArchiveBlockers(team, { deployments, jobs: present(0, 3), proposals: present(3, 6),
    approvals: present(6, 7), shadows: present(7, 8), reservations: present(8, 9) });
}

export const archiveStatus = query({
  args: { teamId: v.id("agentProfiles") },
  handler: async (ctx, args) => {
    const { team } = await owned(ctx, args.teamId);
    return { archived: Boolean(team.archivedAt), blockers: team.archivedAt ? [] : await blockers(ctx, team) };
  },
});

export const archive = mutation({
  args: { teamId: v.id("agentProfiles"), confirmation: v.string() },
  handler: async (ctx, args) => {
    const { state, team } = await owned(ctx, args.teamId);
    if (team.archivedAt) return { archived: true };
    if (args.confirmation !== team.name) throw new Error("Type the team name exactly to confirm deletion.");
    const issues = await blockers(ctx, team);
    if (issues.length) throw new Error(issues.join(" "));
    const now = Date.now();
    await ctx.db.patch(team._id, { archivedAt: now, paused: true, updatedAt: now });
    await ctx.db.insert("auditEvents", { strategyAccountId: state.strategyAccount._id,
      userId: state.user._id, actor: "viewer", kind: "agent.team.archived",
      summary: `Deleted team ${team.name ?? team._id} from active use`,
      refTable: "agentProfiles", refId: String(team._id), createdAt: now });
    return { archived: true };
  },
});

export const restore = mutation({
  args: { teamId: v.id("agentProfiles") },
  handler: async (ctx, args) => {
    const { state, team } = await owned(ctx, args.teamId);
    if (!team.archivedAt) return { restored: true };
    const peers = await ctx.db.query("agentProfiles")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", team.strategyAccountId)).collect();
    const active = peers.filter((row: any) => !row.archivedAt);
    if (active.length >= 12) throw new Error("This account already has 12 active teams. Delete another team before restoring this one.");
    if ((team.allocationUsd ?? 0) > 0) {
      const assets = await ctx.db.query("walletAssetStates")
        .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", team.strategyAccountId)).collect();
      const capital = assets.filter((row: any) => row.includedInStrategyEquity);
      if (!capital.length || capital.some((row: any) => row.lastObservedAt < Date.now() - 300_000 || !Number.isFinite(row.valueUsd)))
        throw new Error("Trading capital is unavailable or stale. Refresh balances before restoring this allocated team.");
      const available = capital.reduce((sum: number, row: any) => sum + Math.max(0, row.valueUsd), 0);
      const reserved = active.reduce((sum: number, row: any) => sum + (row.allocationUsd ?? 0), 0);
      if (reserved + team.allocationUsd > available)
        throw new Error("Restoring this allocation would exceed available capital. Adjust other teams first.");
    }
    const now = Date.now();
    await ctx.db.patch(team._id, { archivedAt: undefined, paused: true,
      lifecycleStatus: "paused", updatedAt: now });
    await ctx.db.insert("auditEvents", { strategyAccountId: state.strategyAccount._id,
      userId: state.user._id, actor: "viewer", kind: "agent.team.restored",
      summary: `Restored team ${team.name ?? team._id} in paused state`,
      refTable: "agentProfiles", refId: String(team._id), createdAt: now });
    return { restored: true };
  },
});
