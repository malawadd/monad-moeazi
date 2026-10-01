import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireProgramActor } from "./helpers/programScope";
import { applyCreditGrant } from "./agentCredits";

/** Exact lookup only; email can identify a different account than a Magic wallet. */
export const lookup = query({
  args: { identifier: v.string() },
  handler: async (ctx, { identifier }) => {
    await requireProgramActor(ctx, "operator");
    const value = identifier.trim();
    if (!value || value.length > 320) throw new Error("Enter an exact email, Magic wallet, or user ID.");
    const id = ctx.db.normalizeId("users", value);
    const walletAddress = /^0x[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : null;
    const emailRows = !id && !walletAddress ? await ctx.db.query("users").take(1001) : [];
    const users = id ? [await ctx.db.get(id)].filter(Boolean) : walletAddress
      ? await ctx.db.query("users").withIndex("by_walletAddress", (q) => q.eq("walletAddress", walletAddress)).take(20)
      : emailRows.filter((user) => user.email?.trim().toLowerCase() === value.toLowerCase());
    if (walletAddress) {
      const wallets = await ctx.db.query("accountWallets")
        .withIndex("by_ownerAddress", (q) => q.eq("ownerAddress", walletAddress)).take(20);
      for (const wallet of wallets) {
        const user = await ctx.db.get(wallet.userId);
        if (user && !users.some((candidate) => candidate?._id === user._id)) users.push(user);
      }
    }
    const matches = [];
    for (const user of users) {
      if (!user) continue;
      const [account, wallets] = await Promise.all([
        ctx.db.query("creditAccounts").withIndex("by_userId", (q) => q.eq("userId", user._id)).first(),
        ctx.db.query("accountWallets").withIndex("by_userId", (q) => q.eq("userId", user._id)).take(10),
      ]);
      const magicWallet = wallets.find((wallet) => wallet.walletProvider === "magic");
      matches.push({
        userId: user._id, email: user.email ?? null,
        walletAddress: magicWallet?.ownerAddress ?? user.walletAddress ?? null,
        magicWalletLinked: Boolean(magicWallet),
        balance: account?.balance ?? 0, reserved: account?.reserved ?? 0,
        available: (account?.balance ?? 0) - (account?.reserved ?? 0),
      });
    }
    matches.sort((a, b) => Number(b.magicWalletLinked) - Number(a.magicWalletLinked)
      || b.available - a.available);
    return { matches, truncated: emailRows.length > 1000 || Boolean(walletAddress && users.length === 20) };
  },
});

/** Test credits are product credits, never deposits or venue collateral. */
export const grant = mutation({
  args: { userId: v.id("users"), expectedEmail: v.optional(v.string()), amount: v.number(), requestId: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "operator");
    const user = await ctx.db.get(args.userId);
    if (!user || (args.expectedEmail !== undefined && user.email !== args.expectedEmail)) {
      throw new Error("Target account changed. Look it up again.");
    }
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,44}$/i.test(args.requestId)) {
      throw new Error("Invalid grant request ID.");
    }
    const reference = `operator-test-credit:${args.requestId}`;
    const result = await applyCreditGrant(ctx, {
      userId: args.userId, amount: args.amount, reference,
      metadataJson: JSON.stringify({ source: "local_operator_console", operator: actor.subject }),
    });
    return { ...result, reference, userId: args.userId };
  },
});
