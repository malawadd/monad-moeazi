/* eslint-disable @typescript-eslint/no-explicit-any */
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByAuthSubject } from "./model";
import { mobileMagicAccount } from "./mobileMagicWallet";
import { isTransactionHash } from "./helpers/mobileWithdrawal";
import { assertMobileChainActionsPaused } from "./mobileAuthOnly";

async function viewer(ctx: any) {
  assertMobileChainActionsPaused();
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication is required.");
  const user = await getUserByAuthSubject(ctx, identity.subject);
  if (!user) throw new Error("Moeazi account is not provisioned.");
  return { identity, user };
}

function publicStatus(row: any) {
  return {
    schemaVersion: "2026-09-14" as const,
    operationId: row.operationId,
    status: row.status,
    amount: row.amount,
    destination: row.destination,
    destinationKind: row.destinationKind,
    network: "Arbitrum" as const,
    asset: "USDC" as const,
    estimatedFeeWei: row.estimatedFeeWei,
    remainingAmount: row.remainingAmount,
    transactionHash: row.txHash,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    expiresAt: row.expiresAt,
    updatedAt: row.updatedAt,
  };
}

export const getContext = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, args) => {
    const user = await getUserByAuthSubject(ctx, args.subject);
    if (!user) throw new Error("Moeazi account is not provisioned.");
    const { wallet, strategyAccount: strategy } = await mobileMagicAccount(ctx, user);
    if (!wallet) throw new Error("Magic wallet is not ready.");
    const profiles = strategy ? await ctx.db.query("agentProfiles")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategy._id)).collect() : [];
    const assignments = strategy ? await ctx.db.query("programAssignments")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategy._id)).collect() : [];
    const managedAuthorities = await Promise.all(assignments
      .filter((assignment: any) => assignment.source === "explicit" && assignment.controllerMode === "autopilot")
      .map((assignment: any) => ctx.db.query("managedProgramActivationAuthorities")
        .withIndex("by_assignmentId", (q: any) => q.eq("assignmentId", assignment._id)).collect()));
    // A revoked native receipt means Start was previously authorized and Stop has
    // not yet been followed by an authoritative flat-position/settlement receipt.
    const managedPositionClosureUnconfirmed = assignments.some((assignment: any) => {
      if (assignment.source !== "explicit" || assignment.controllerMode !== "autopilot"
          || assignment.positionClosureState === "confirmed_flat") return false;
      const revokedReceiptExists = managedAuthorities.flat().some((receipt: any) =>
        String(receipt.assignmentId) === String(assignment._id) && receipt.state === "revoked");
      return assignment.positionClosureState === "unconfirmed" || assignment.status === "active" || revokedReceiptExists;
    });
    const operations = strategy ? await ctx.db.query("mobileUaOperations")
      .withIndex("by_strategyAccountId_status", (q: any) => q.eq("strategyAccountId", strategy._id).eq("status", "broadcast")).collect() : [];
    const reconciling = strategy ? await ctx.db.query("mobileUaOperations")
      .withIndex("by_strategyAccountId_status", (q: any) => q.eq("strategyAccountId", strategy._id).eq("status", "reconciling")).collect() : [];
    return {
      userId: user._id, strategyAccountId: strategy?._id,
      ownerAddress: wallet.ownerAddress,
      profilePaused: profiles.every((profile: any) => Boolean(profile.archivedAt || profile.paused))
        && !assignments.some((assignment: any) => assignment.status === "active"),
      strategyStatus: strategy?.status, emergencyStop: strategy?.emergencyStop ?? false,
      hasPendingExecution: operations.length + reconciling.length > 0,
      managedPositionClosureUnconfirmed,
    };
  },
});

export const getByIdempotency = internalQuery({
  args: { userId: v.id("users"), idempotencyKey: v.string() },
  handler: async (ctx, args) => await ctx.db.query("mobileWalletWithdrawals")
    .withIndex("by_userId_idempotencyKey", (q: any) => q.eq("userId", args.userId).eq("idempotencyKey", args.idempotencyKey)).first(),
});

export const getInternal = internalQuery({
  args: { operationId: v.string() },
  handler: async (ctx, args) => await ctx.db.query("mobileWalletWithdrawals")
    .filter((q: any) => q.eq(q.field("operationId"), args.operationId)).first(),
});

export const createPrepared = internalMutation({
  args: {
    userId: v.id("users"), strategyAccountId: v.optional(v.id("strategyAccounts")),
    operationId: v.string(), idempotencyKey: v.string(), ownerAddress: v.string(),
    destination: v.string(), destinationKind: v.union(v.literal("wallet"), v.literal("contract")),
    amount: v.string(), amountRaw: v.string(), remainingAmount: v.string(),
    transactionJson: v.string(), preparedHash: v.string(), expectedNonce: v.number(),
    observedBlock: v.number(), estimatedFeeWei: v.string(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("mobileWalletWithdrawals")
      .withIndex("by_userId_idempotencyKey", (q: any) => q.eq("userId", args.userId).eq("idempotencyKey", args.idempotencyKey)).first();
    if (existing) return existing;
    const now = Date.now();
    const nonceReservation = await ctx.db.query("mobileWalletWithdrawals")
      .withIndex("by_userId_operationId", (q: any) => q.eq("userId", args.userId))
      .filter((q: any) => q.and(
        q.eq(q.field("ownerAddress"), args.ownerAddress),
        q.eq(q.field("expectedNonce"), args.expectedNonce),
        q.gt(q.field("expiresAt"), now),
        q.or(
          q.eq(q.field("status"), "prepared"),
          q.eq(q.field("status"), "submitted"),
          q.eq(q.field("status"), "confirming"),
          q.eq(q.field("status"), "uncertain"),
        ),
      )).first();
    if (nonceReservation) throw new Error("Another withdrawal is already being reviewed or confirmed. Finish it before preparing a new one.");
    const id = await ctx.db.insert("mobileWalletWithdrawals", {
      ...args, chainId: 42161, tokenAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
      status: "prepared", createdAt: now, updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const reportBroadcast = mutation({
  args: {
    operationId: v.string(),
    outcome: v.union(v.literal("submitted"), v.literal("cancelled"), v.literal("uncertain")),
    transactionHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await viewer(ctx);
    const row = await ctx.db.query("mobileWalletWithdrawals")
      .withIndex("by_userId_operationId", (q: any) => q.eq("userId", user._id).eq("operationId", args.operationId)).first();
    if (!row) throw new Error("Withdrawal operation was not found.");
    if (["completed", "failed", "cancelled", "expired"].includes(row.status)) return publicStatus(row);
    if (args.outcome === "submitted" && (!args.transactionHash || !isTransactionHash(args.transactionHash))) {
      throw new Error("A valid transaction hash is required.");
    }
    if (row.status !== "prepared" && row.status !== "uncertain" && args.outcome !== "submitted") {
      throw new Error("This withdrawal can no longer be changed.");
    }
    const now = Date.now();
    const status = args.outcome === "submitted" ? "submitted" : args.outcome;
    const patch: any = { status, broadcastReportedAt: now, updatedAt: now };
    if (args.transactionHash) patch.txHash = args.transactionHash.toLowerCase();
    await ctx.db.patch(row._id, patch);
    if (row.strategyAccountId) {
      const summary = status === "submitted" ? "USDC withdrawal submitted" : status === "uncertain" ? "USDC withdrawal is being checked" : "USDC withdrawal cancelled";
      await ctx.db.insert("auditEvents", {
        strategyAccountId: row.strategyAccountId, userId: row.userId, actor: "mobile",
        kind: `wallet.withdrawal.${status}`, summary,
        detail: JSON.stringify({ operationId: row.operationId, amount: row.amount, asset: "USDC", txHash: patch.txHash }),
        refTable: "mobileWalletWithdrawals", refId: String(row._id), createdAt: now,
      });
    }
    return publicStatus({ ...row, ...patch });
  },
});

export const updateStatus = internalMutation({
  args: {
    operationId: v.string(),
    status: v.union(v.literal("submitted"), v.literal("confirming"), v.literal("completed"), v.literal("failed"), v.literal("expired"), v.literal("needs_attention")),
    txHash: v.optional(v.string()), failureCode: v.optional(v.string()), failureMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("mobileWalletWithdrawals").filter((q: any) => q.eq(q.field("operationId"), args.operationId)).first();
    if (!row) throw new Error("Withdrawal operation was not found.");
    const now = Date.now();
    const patch: any = { status: args.status, updatedAt: now };
    if (args.txHash) patch.txHash = args.txHash.toLowerCase();
    if (args.failureCode) patch.failureCode = args.failureCode;
    if (args.failureMessage) patch.failureMessage = args.failureMessage;
    if (args.status === "completed") patch.completedAt = now;
    await ctx.db.patch(row._id, patch);
    if (row.strategyAccountId && ["completed", "failed", "needs_attention"].includes(args.status)) {
      const title = args.status === "completed" ? "USDC withdrawal completed" : args.status === "failed" ? "USDC withdrawal failed" : "USDC withdrawal needs attention";
      await ctx.db.insert("auditEvents", {
        strategyAccountId: row.strategyAccountId, userId: row.userId, actor: "system",
        kind: `wallet.withdrawal.${args.status}`, summary: title,
        detail: JSON.stringify({ operationId: row.operationId, amount: row.amount, asset: "USDC", txHash: args.txHash ?? row.txHash }),
        refTable: "mobileWalletWithdrawals", refId: String(row._id), createdAt: now,
      });
    }
    return publicStatus({ ...row, ...patch });
  },
});

export const getStatus = query({
  args: { operationId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await viewer(ctx);
    const row = await ctx.db.query("mobileWalletWithdrawals")
      .withIndex("by_userId_operationId", (q: any) => q.eq("userId", user._id).eq("operationId", args.operationId)).first();
    return row ? publicStatus(row) : null;
  },
});

export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await viewer(ctx);
    const rows = await ctx.db.query("mobileWalletWithdrawals")
      .filter((q: any) => q.eq(q.field("userId"), user._id)).order("desc").take(30);
    return rows.map(publicStatus);
  },
});
