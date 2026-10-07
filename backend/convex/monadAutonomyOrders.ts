import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMonadOperator, reserveAutonomyOperatorLease, updateAutonomyOperatorLease } from "./monadHelpers";

export const getOrder = query({ args: { orderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  return await ctx.db.query("monadAutonomyOrders")
    .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId)).first();
} });

export const listOrders = query({ args: { enrollmentId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  return await ctx.db.query("monadAutonomyOrders")
    .withIndex("by_enrollmentId_createdAt", (q: any) => q.eq("enrollmentId", args.enrollmentId))
    .order("desc").take(20);
} });

export const prepareOrder = mutation({
  args: { enrollmentId: v.string(), ownerAddress: v.string(), orderId: v.string(), tickId: v.string(),
    kind: v.union(v.literal("buy"), v.literal("sell"), v.literal("settle"), v.literal("recovery")),
    transactionJson: v.string(), signedRawTransaction: v.string(), txHash: v.string(), nonce: v.number(),
    executorAddress: v.string(),
    quoteId: v.string(), quoteExpiresAt: v.number(), tokenIndex: v.optional(v.number()),
    amountInUnits: v.optional(v.string()), minimumOutUnits: v.string(), expectedAmountOutUnits: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await ctx.db.query("monadAutonomyEnrollments")
      .withIndex("by_enrollmentId", (q: any) => q.eq("enrollmentId", args.enrollmentId)).first();
    if (!row || row.ownerAddress !== args.ownerAddress.toLowerCase()
        || !["activation_pending", "active", "settling", "uncertain"].includes(row.status)) {
      throw new Error("Active autonomy enrollment was not found for this order.");
    }
    if (args.quoteExpiresAt <= Date.now() || args.quoteExpiresAt > Date.now() + 30_000
        || !/^\d+$/.test(args.expectedAmountOutUnits)
        || !/^0x[a-f0-9]{64}$/.test(args.txHash) || !/^0x[0-9a-f]+$/i.test(args.signedRawTransaction)
        || args.signedRawTransaction.length > 300_000) throw new Error("Autonomy order envelope or quote is invalid.");
    const prior = await ctx.db.query("monadAutonomyOrders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId)).first();
    if (prior) {
      if (prior.txHash !== args.txHash || prior.enrollmentId !== args.enrollmentId) throw new Error("Order ID was reused with different transaction terms.");
      return prior;
    }
    const nonceRows = await ctx.db.query("monadAutonomyOrders")
      .withIndex("by_executor_nonce", (q: any) => q.eq("executorAddress", args.executorAddress.toLowerCase()).eq("nonce", args.nonce)).collect();
    if (nonceRows.some((item: any) => ["prepared", "broadcasting", "submitted", "uncertain"].includes(item.status))) {
      throw new Error("Autonomy operator transaction nonce is already reserved.");
    }
    await reserveAutonomyOperatorLease(ctx, { executorAddress: args.executorAddress, orderId: args.orderId,
      workflow: "autonomy", expiresAt: args.quoteExpiresAt });
    const id = await ctx.db.insert("monadAutonomyOrders", { ...args, status: "prepared",
      createdAt: Date.now(), updatedAt: Date.now() });
    return await ctx.db.get(id);
  },
});

export const claimBroadcast = mutation({
  args: { orderId: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await ctx.db.query("monadAutonomyOrders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId)).first();
    if (!row) throw new Error("Autonomy order was not found.");
    if (row.status !== "prepared") return { claimed: false, status: row.status, txHash: row.txHash };
    const lease = await ctx.db.query("monadAutonomyOperatorLease")
      .withIndex("by_key", (q: any) => q.eq("key", "monad-autonomy-executor")).first();
    if (!lease || lease.orderId !== row.orderId || lease.workflow !== "autonomy") {
      await ctx.db.patch(row._id, { status: "failed", updatedAt: Date.now() });
      return { claimed: false, status: "failed", txHash: row.txHash };
    }
    if (!row.signedRawTransaction || !row.txHash || (row.quoteExpiresAt && row.quoteExpiresAt <= Date.now())) {
      await ctx.db.patch(row._id, { status: "failed", rejectionCode: "quote_expired_or_payload_missing", updatedAt: Date.now() });
      await updateAutonomyOperatorLease(ctx, row.orderId, "failed");
      return { claimed: false, status: "failed", txHash: row.txHash };
    }
    await ctx.db.patch(row._id, { status: "broadcasting", updatedAt: Date.now() });
    await updateAutonomyOperatorLease(ctx, row.orderId, "broadcasting");
    return { claimed: true, signedRawTransaction: row.signedRawTransaction, txHash: row.txHash,
      ownerAddress: row.ownerAddress, enrollmentId: row.enrollmentId };
  },
});

export const recordSubmitted = mutation({
  args: { orderId: v.string(), txHash: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await ctx.db.query("monadAutonomyOrders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId)).first();
    if (!row || row.txHash !== args.txHash) throw new Error("Autonomy transaction hash differs from its persisted raw transaction.");
    if (!["broadcasting", "submitted", "uncertain"].includes(row.status)) throw new Error("Autonomy order is not awaiting a receipt.");
    await ctx.db.patch(row._id, { status: "submitted", updatedAt: Date.now() });
    await updateAutonomyOperatorLease(ctx, row.orderId, "submitted");
    return { status: "submitted", txHash: row.txHash };
  },
});

export const recordUncertain = mutation({
  args: { orderId: v.string() }, handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await ctx.db.query("monadAutonomyOrders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId)).first();
    if (!row || !["broadcasting", "submitted", "uncertain"].includes(row.status)) return null;
    await ctx.db.patch(row._id, { status: "uncertain", updatedAt: Date.now() });
    await updateAutonomyOperatorLease(ctx, row.orderId, "uncertain");
    return { status: "uncertain", txHash: row.txHash };
} });

export const recordRejected = mutation({
  args: { orderId: v.string(), reasonCode: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await ctx.db.query("monadAutonomyOrders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId)).first();
    if (!row || row.status !== "broadcasting") return null;
    const rejectionCode = args.reasonCode.replace(/[^a-z0-9_]/gi, "_").slice(0, 80);
    await ctx.db.patch(row._id, { status: "failed", rejectionCode, updatedAt: Date.now() });
    await updateAutonomyOperatorLease(ctx, row.orderId, "failed");
    return { status: "failed", txHash: row.txHash, rejectionCode };
  },
});

export const recordReceipt = mutation({
  args: { orderId: v.string(), txHash: v.string(), receiptStatus: v.number(), blockNumber: v.number(),
    blockHash: v.string(), canonicalBlockHash: v.string(), finalized: v.boolean(),
    amountOutUnits: v.optional(v.string()), gasUsed: v.string(), effectiveGasPrice: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await ctx.db.query("monadAutonomyOrders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId)).first();
    if (!row || row.txHash !== args.txHash || ![0, 1].includes(args.receiptStatus)
        || args.blockHash.toLowerCase() !== args.canonicalBlockHash.toLowerCase()) {
      throw new Error("Autonomy receipt is noncanonical or does not match its order.");
    }
    const status = args.finalized ? args.receiptStatus === 1 ? "finalized" : "failed" : "submitted";
    await ctx.db.patch(row._id, { status, receiptStatus: args.receiptStatus, blockNumber: args.blockNumber,
      blockHash: args.blockHash, ...(args.amountOutUnits ? { amountOutUnits: args.amountOutUnits } : {}),
      gasUsed: args.gasUsed, effectiveGasPrice: args.effectiveGasPrice, updatedAt: Date.now() });
    await updateAutonomyOperatorLease(ctx, row.orderId, status);
    return { ...row, status, receiptStatus: args.receiptStatus, blockNumber: args.blockNumber,
      amountOutUnits: args.amountOutUnits, gasUsed: args.gasUsed, effectiveGasPrice: args.effectiveGasPrice };
  },
});
