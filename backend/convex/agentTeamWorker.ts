import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getOwnedVersion = internalQuery({
  args: { subject: v.string(), teamId: v.id("agentProfiles"), versionId: v.id("agentTeamVersions") },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_authSubject", (q) => q.eq("authSubject", args.subject)).first();
    if (!user) return null;
    const [team, version] = await Promise.all([ctx.db.get(args.teamId), ctx.db.get(args.versionId)]);
    if (!team || team.archivedAt || !version || team.userId !== user._id || version.userId !== user._id || version.teamId !== team._id
        || version.strategyAccountId !== team.strategyAccountId) return null;
    return { teamId: team._id, versionId: version._id, version: version.version,
      accountId: team.strategyAccountId, config: JSON.parse(version.configJson) };
  },
});
