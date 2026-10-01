import { query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByAuthSubject } from "./model";

/** Minimal owner proof for the mobile-to-gateway Hyperliquid binding bridge. */
export const getHyperliquidBindingAttempt = query({
  args: { attemptId: v.id("venueSetupAttempts") },
  handler: async (ctx, { attemptId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject || !identity.walletAddress) return null;
    const user = await getUserByAuthSubject(ctx, identity.subject);
    if (!user) return null;
    const attempt = await ctx.db.get(attemptId);
    if (!attempt || attempt.venue !== "hyperliquid" || attempt.state !== "verifying"
      || !["approval", "autopilot"].includes(attempt.authorityMode)) return null;
    const [strategy, wallet] = await Promise.all([
      ctx.db.get(attempt.strategyAccountId), ctx.db.get(attempt.accountWalletId),
    ]);
    if (!strategy || strategy.userId !== user._id || !wallet || wallet.userId !== user._id
      || wallet.strategyAccountId !== strategy._id
      || wallet.ownerAddress.toLowerCase() !== String(identity.walletAddress).toLowerCase()) return null;
    const integration = await ctx.db.query("venueIntegrations")
      .withIndex("by_strategyAccountId_venue", (q) =>
        q.eq("strategyAccountId", strategy._id).eq("venue", "hyperliquid")).first();
    if (!integration || integration.activeSetupAttemptId !== attempt._id
      || integration.authorityMode !== attempt.authorityMode) return null;
    return { attemptId: attempt._id, ownerAddress: wallet.ownerAddress.toLowerCase(),
      authorityMode: attempt.authorityMode };
  },
});
