import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireProgramActor } from "./helpers/programScope";

// Inventory only. No migration or assignment write is allowed from this query.
export const dryRun = query({
  args: { cursor: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireProgramActor(ctx, "operator");
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));
    const page = await ctx.db.query("strategyAccounts").paginate({ cursor: args.cursor ?? null, numItems: limit });
    const accounts = [];
    for (const account of page.page) {
      const [teams, deployments, assignments] = await Promise.all([
        ctx.db.query("agentProfiles").withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", account._id)).collect(),
        ctx.db.query("agentMarketDeployments").withIndex("by_strategyAccountId_marketId", (q) => q.eq("strategyAccountId", account._id)).collect(),
        ctx.db.query("programAssignments").withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", account._id)).collect(),
      ]);
      const unresolved = [];
      const activeTeams = teams.filter((team) => !team.archivedAt);
      const activeDeployments = deployments.filter((deployment) => deployment.status === "active");
      for (const team of activeTeams) {
        if (!deployments.some((deployment) => deployment.teamId === team._id)) {
          unresolved.push({ code: "TEAM_WITHOUT_DEPLOYMENT", teamId: String(team._id) });
        }
      }
      for (const deployment of activeDeployments) {
        const team = activeTeams.find((row) => row._id === deployment.teamId);
        const version = await ctx.db.get(deployment.teamVersionId);
        if (!team || !version || version.teamId !== team._id || version.strategyAccountId !== account._id
            || team.userId !== account.userId || deployment.userId !== account.userId) {
          unresolved.push({ code: "BROKEN_DEPLOYMENT_BINDING", deploymentId: String(deployment._id) });
        }
      }
      const activeAssignments = assignments.filter((row) => row.status === "active");
      if (!activeAssignments.length) unresolved.push({ code: "MOBILE_UNASSIGNED" });
      if (activeAssignments.length > 1) unresolved.push({ code: "MOBILE_AMBIGUOUS_ASSIGNMENT" });
      if (activeAssignments.some((row) => row.userId !== account.userId)) unresolved.push({ code: "ASSIGNMENT_OWNER_MISMATCH" });
      accounts.push({ strategyAccountId: account._id, userId: account.userId,
        teamCount: activeTeams.length, activeDeploymentCount: activeDeployments.length,
        activeAssignmentCount: activeAssignments.length,
        explicitDeployments: activeDeployments.map((row) => ({ deploymentId: row._id,
          teamId: row.teamId, teamVersionId: row.teamVersionId, marketId: row.marketId, mode: row.mode })),
        unresolved });
    }
    return { schemaVersion: 1, dryRun: true, accounts, continueCursor: page.continueCursor,
      isDone: page.isDone, unresolvedCount: accounts.reduce((count, row) => count + row.unresolved.length, 0) };
  },
});
