"use node";

import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { STRATEGY_SLUG } from "./constants";

export const createStrategyAccount = action({
  args: {
    label: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ strategyAccountId: Id<"strategyAccounts">; created: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const userId = (await ctx.runMutation(internal.mutations.upsertViewerUser, {
      authSubject: identity.subject,
      authProvider: String(identity.authProvider ?? "particle"),
      walletAddress:
        typeof identity.walletAddress === "string"
          ? identity.walletAddress
          : typeof identity.particleWalletAddress === "string"
            ? identity.particleWalletAddress
            : undefined,
      particleWalletAddress:
        typeof identity.particleWalletAddress === "string"
          ? identity.particleWalletAddress
          : typeof identity.walletAddress === "string"
            ? identity.walletAddress
            : undefined,
      particleUuid: typeof identity.particleUuid === "string" ? identity.particleUuid : undefined,
      email: identity.email,
      displayName:
        identity.name ??
        [identity.givenName, identity.familyName].filter(Boolean).join(" ") ??
        identity.nickname,
    })) as Id<"users">;

    return await ctx.runMutation(internal.mutations.provisionStrategyAccountRecords, {
      userId,
      label: args.label ?? "LINK / USDC Delta Neutral",
      strategyType: STRATEGY_SLUG,
      venueWallets: [],
    }) as { strategyAccountId: Id<"strategyAccounts">; created: boolean };
  },
});

export const approveHyperliquidAgent = action({
  args: {
    agentName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const strategyAccount = await ctx.runQuery(internal.private.getStrategyAccountForAuthSubject, {
      authSubject: identity.subject,
    });
    if (!strategyAccount?._id) {
      throw new Error("Strategy account not provisioned");
    }

    return await ctx.runAction(internal.actions.executeHLApproveAgent, {
      strategyAccountId: strategyAccount._id,
      agentName: args.agentName,
      origin: "viewer",
    });
  },
});

export const rotateHyperliquidAgent = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const strategyAccount = await ctx.runQuery(internal.private.getStrategyAccountForAuthSubject, {
      authSubject: identity.subject,
    });
    if (!strategyAccount?._id) {
      throw new Error("Strategy account not provisioned");
    }

    return await ctx.runAction(internal.actions.rotateHyperliquidAgent, {
      strategyAccountId: strategyAccount._id,
    });
  },
});

export const refreshFundingState = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const strategyAccount = await ctx.runQuery(internal.private.getStrategyAccountForAuthSubject, {
      authSubject: identity.subject,
    });
    if (!strategyAccount?._id) {
      throw new Error("Strategy account not provisioned");
    }

    return await ctx.runAction(internal.actions.refreshManagedFundingState, {
      strategyAccountId: strategyAccount._id,
    });
  },
});

export const processWithdrawal = action({
  args: {
    withdrawalId: v.id("withdrawals"),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const strategyAccount = await ctx.runQuery(internal.private.getStrategyAccountForAuthSubject, {
      authSubject: identity.subject,
    });
    if (!strategyAccount?._id) {
      throw new Error("Strategy account not provisioned");
    }

    const withdrawal = await ctx.runQuery(internal.worker.getWithdrawalRequest, {
      withdrawalId: args.withdrawalId,
    });
    if (!withdrawal || withdrawal.strategyAccountId !== strategyAccount._id) {
      throw new Error("Withdrawal request not found");
    }

    const executionResult = await ctx.runAction(internal.actions.startWithdrawal, {
      strategyAccountId: strategyAccount._id,
      withdrawalId: args.withdrawalId,
    });
    const refreshResult = await ctx.runAction(internal.actions.refreshManagedFundingState, {
      strategyAccountId: strategyAccount._id,
    });

    return {
      executionResult,
      refreshResult,
    };
  },
});
