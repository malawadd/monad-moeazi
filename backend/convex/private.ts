import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  getActiveStrategyConfig,
  getExecutionsSince,
  getLatestBalanceSnapshot,
  getUserByAuthSubject,
  getVenueAccountsByStrategyAccountId,
  getWalletSecretByVenueAccountId,
} from "./model";

export const getStrategyAccountForAuthSubject = internalQuery({
  args: {
    authSubject: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getUserByAuthSubject(ctx, args.authSubject);
    if (!user) {
      return null;
    }

    return await ctx.db
      .query("strategyAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
  },
});

export const getManagedAccountByWalletAddress = internalQuery({
  args: {
    walletAddress: v.string(),
  },
  handler: async (ctx, args) => {
    const normalized = args.walletAddress.toLowerCase().replace(/^0x/, "");
    const venueAccounts = await ctx.db.query("venueAccounts").collect();
    const venueAccount = venueAccounts.find(
      (account: any) =>
        String(account.walletAddress ?? "").toLowerCase().replace(/^0x/, "") === normalized ||
        String(account.accountRef ?? "").toLowerCase().endsWith(normalized),
    );
    if (!venueAccount) {
      return null;
    }

    const [strategyAccount, walletAssetStates] = await Promise.all([
      ctx.db.get(venueAccount.strategyAccountId),
      ctx.db
        .query("walletAssetStates")
        .withIndex("by_venueAccountId", (q) => q.eq("venueAccountId", venueAccount._id))
        .collect(),
    ]);

    return {
      strategyAccount,
      venueAccount,
      walletAssetStates,
    };
  },
});

export const getManagedWalletContext = internalQuery({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    role: v.union(
      v.literal("optimism_execution_wallet"),
      v.literal("hyperliquid_master_wallet"),
      v.literal("hyperliquid_agent_wallet"),
    ),
  },
  handler: async (ctx, args) => {
    const venueAccounts = await getVenueAccountsByStrategyAccountId(ctx, args.strategyAccountId);
    const venueAccount = venueAccounts.find((account: any) => account.role === args.role);
    if (!venueAccount) {
      throw new Error(`Managed venue account not found for role ${args.role}`);
    }

    const walletSecret = await getWalletSecretByVenueAccountId(ctx, venueAccount._id);
    if (!walletSecret) {
      throw new Error(`Managed wallet secret not found for role ${args.role}`);
    }

    return {
      venueAccount,
      walletSecret,
    };
  },
});

export const getHyperliquidWalletPair = internalQuery({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
  },
  handler: async (ctx, args) => {
    const venueAccounts = await getVenueAccountsByStrategyAccountId(ctx, args.strategyAccountId);
    const master = venueAccounts.find((account: any) => account.role === "hyperliquid_master_wallet");
    const agent = venueAccounts.find((account: any) => account.role === "hyperliquid_agent_wallet");

    if (!master || !agent) {
      throw new Error("HyperLiquid master/agent wallets are not provisioned");
    }

    const [masterSecret, agentSecret] = await Promise.all([
      getWalletSecretByVenueAccountId(ctx, master._id),
      getWalletSecretByVenueAccountId(ctx, agent._id),
    ]);

    if (!masterSecret || !agentSecret) {
      throw new Error("HyperLiquid wallet secrets are missing");
    }

    return {
      master,
      masterSecret,
      agent,
      agentSecret,
    };
  },
});

export const getStrategyExecutionContext = internalQuery({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
  },
  handler: async (ctx, args) => {
    const strategyAccount = await ctx.db.get(args.strategyAccountId);
    if (!strategyAccount) {
      throw new Error("Strategy account not found");
    }

    const [config, venueAccounts, latestSnapshot] = await Promise.all([
      getActiveStrategyConfig(ctx, args.strategyAccountId),
      getVenueAccountsByStrategyAccountId(ctx, args.strategyAccountId),
      getLatestBalanceSnapshot(ctx, args.strategyAccountId),
    ]);

    return {
      strategyAccount,
      config,
      venueAccounts,
      latestSnapshot,
    };
  },
});

export const getStrategyPolicyContext = internalQuery({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
  },
  handler: async (ctx, args) => {
    const strategyAccount = await ctx.db.get(args.strategyAccountId);
    if (!strategyAccount) {
      throw new Error("Strategy account not found");
    }

    const [config, recentExecutions] = await Promise.all([
      getActiveStrategyConfig(ctx, args.strategyAccountId),
      getExecutionsSince(ctx, args.strategyAccountId, Date.now() - 86_400_000),
    ]);

    return {
      strategyAccount,
      config,
      recentExecutions,
    };
  },
});
