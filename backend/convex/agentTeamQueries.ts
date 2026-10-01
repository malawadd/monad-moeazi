import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerStrategy } from "./model";

async function owner(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const state = await requireViewerStrategy(ctx, identity.subject);
  return state.user && state.strategyAccount ? state : null;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const state = await owner(ctx);
    if (!state) return null;
    const accountId = state.strategyAccount._id;
    const [teams, deployments, assets, approvals, jobs, proposals, shadows] = await Promise.all([
      ctx.db.query("agentProfiles").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", accountId)).collect(),
      ctx.db.query("agentMarketDeployments").withIndex("by_strategyAccountId_marketId", (q: any) => q.eq("strategyAccountId", accountId)).collect(),
      ctx.db.query("walletAssetStates").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", accountId)).collect(),
      ctx.db.query("approvalRequests").withIndex("by_userId_status", (q: any) => q.eq("userId", state.user._id).eq("status", "pending")).take(100),
      ctx.db.query("analysisJobs").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", accountId)).order("desc").take(100),
      ctx.db.query("tradeProposals").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", accountId)).order("desc").take(100),
      ctx.db.query("shadowExecutions").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", accountId)).order("desc").take(100),
    ]);
    const freshnessCutoff = Date.now() - 300_000;
    const activeTeams = teams.filter((team: any) => !team.archivedAt);
    const currentVersions = await Promise.all(activeTeams.map((team: any) => ctx.db.query("agentTeamVersions")
      .withIndex("by_teamId", (q: any) => q.eq("teamId", team._id)).order("desc").first()));
    const drafts = await Promise.all(activeTeams.map((team: any) => ctx.db.query("agentTeamDrafts")
      .withIndex("by_teamId", (q: any) => q.eq("teamId", team._id)).first()));
    const deploymentVersions = await Promise.all(deployments.map((row: any) => ctx.db.get(row.teamVersionId)));
    const capitalAssets = assets.filter((asset: any) => asset.includedInStrategyEquity);
    const capitalAvailable = capitalAssets.length > 0
      && capitalAssets.every((asset: any) => asset.lastObservedAt >= freshnessCutoff && Number.isFinite(asset.valueUsd));
    const capitalUsd = capitalAvailable ? capitalAssets.reduce((total: number, asset: any) => total + Math.max(0, asset.valueUsd), 0) : null;
    return {
      accountId, accountStatus: state.strategyAccount.status,
      emergencyStop: state.strategyAccount.emergencyStop,
      capitalUsd, capitalObservedAt: capitalAvailable ? Math.min(...capitalAssets.map((asset: any) => asset.lastObservedAt)) : null,
      reservedUsd: activeTeams.reduce((total: number, team: any) => total + (team.allocationUsd ?? 0), 0),
      archivedTeams: teams.filter((team: any) => Boolean(team.archivedAt)),
      teams: activeTeams.map((team: any, index: number) => ({ ...team,
        savedVersion: (currentVersions[index] as any)?.version ?? null,
        hasDraft: Boolean(drafts[index]),
        currentConfig: (currentVersions[index] as any)?.configJson
          ? JSON.parse((currentVersions[index] as any).configJson) : null })),
      deployments: deployments.map((row: any, index: number) => ({ ...row,
        version: (deploymentVersions[index] as any)?.version ?? null }))
        .filter((row: any) => activeTeams.some((team: any) => team._id === row.teamId)), approvals,
      jobs: jobs.map((job: any) => ({ _id: job._id, teamId: job.teamId, teamVersionId: job.teamVersionId,
        deploymentId: job.deploymentId, marketId: job.marketId, status: job.status, createdAt: job.createdAt })),
      proposals: proposals.map((proposal: any) => ({ _id: proposal._id, teamId: proposal.teamId,
        teamVersionId: proposal.teamVersionId, deploymentId: proposal.deploymentId,
        marketId: proposal.marketId, status: proposal.status, createdAt: proposal.createdAt })),
      shadows: shadows.map((shadow: any) => ({ _id: shadow._id, teamId: shadow.teamId,
        deploymentId: shadow.deploymentId, marketId: shadow.marketId,
        unrealizedPnlUsd: shadow.unrealizedPnlUsd, realizedPnlUsd: shadow.realizedPnlUsd })),
    };
  },
});

export const detail = query({
  args: { teamId: v.id("agentProfiles") },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    if (!state) return null;
    const team = await ctx.db.get(args.teamId);
    if (!team || team.userId !== state.user._id || team.strategyAccountId !== state.strategyAccount._id) return null;
    const [versions, draft, deployments, jobs, proposals, shadows] = await Promise.all([
      ctx.db.query("agentTeamVersions").withIndex("by_teamId", (q: any) => q.eq("teamId", team._id)).order("desc").take(30),
      ctx.db.query("agentTeamDrafts").withIndex("by_teamId", (q: any) => q.eq("teamId", team._id)).first(),
      ctx.db.query("agentMarketDeployments").withIndex("by_teamId_marketId", (q: any) => q.eq("teamId", team._id)).collect(),
      ctx.db.query("analysisJobs").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", team.strategyAccountId)).order("desc").take(100),
      ctx.db.query("tradeProposals").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", team.strategyAccountId)).order("desc").take(100),
      ctx.db.query("shadowExecutions").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", team.strategyAccountId)).order("desc").take(100),
    ]);
    return {
      team,
      versions: versions.map((row: any) => ({ ...row, config: JSON.parse(row.configJson) })),
      draft: draft ? { ...draft, config: JSON.parse(draft.configJson) } : null,
      deployments,
      jobs: jobs.filter((row: any) => row.teamId === team._id),
      proposals: proposals.filter((row: any) => row.teamId === team._id),
      shadows: shadows.filter((row: any) => row.teamId === team._id),
    };
  },
});

export const market = query({
  args: { marketId: v.string() },
  handler: async (ctx, args) => {
    const state = await owner(ctx);
    if (!state) return { signedIn: false, teams: [], deployments: [], versions: [] };
    const marketId = args.marketId.trim().toUpperCase();
    const allTeams = await ctx.db.query("agentProfiles")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
    const teams = allTeams.filter((team: any) => !team.archivedAt);
    const deployments = await ctx.db.query("agentMarketDeployments")
      .withIndex("by_strategyAccountId_marketId", (q: any) =>
        q.eq("strategyAccountId", state.strategyAccount._id).eq("marketId", marketId)).collect();
    const versions = (await Promise.all(teams.map((team: any) => ctx.db.query("agentTeamVersions")
      .withIndex("by_teamId", (q: any) => q.eq("teamId", team._id)).order("desc").take(10)))).flat();
    return { signedIn: true, teams, deployments: deployments.filter((row: any) => teams.some((team: any) => team._id === row.teamId)),
      versions: versions.map((row: any) => ({ ...row, config: JSON.parse(row.configJson) })) };
  },
});
