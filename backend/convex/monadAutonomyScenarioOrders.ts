import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMonadOperator, reserveAutonomyOperatorLease, updateAutonomyOperatorLease } from "./monadHelpers";

export const getOrder = query({ args: { orderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  return await ctx.db.query("monadAutonomyScenarioOrders")
    .withIndex("by_orderId", (q: any) => q.eq("orderId", args.orderId)).first();
} });

export const getOrderByKey = query({ args: { idempotencyKey: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  return await ctx.db.query("monadAutonomyScenarioOrders")
    .withIndex("by_idempotencyKey", (q: any) => q.eq("idempotencyKey", args.idempotencyKey)).first();
} });

export const listScenarioOrders = query({ args: { scenarioId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  return await ctx.db.query("monadAutonomyScenarioOrders")
    .withIndex("by_scenario_step", (q: any) => q.eq("scenarioId", args.scenarioId)).order("desc").take(100);
} });

export const prepareOrder = mutation({
  args: { orderId: v.string(), idempotencyKey: v.string(), scenarioId: v.optional(v.string()), stepIndex: v.optional(v.number()),
    tokenIndex: v.number(), direction: v.union(v.literal("up"), v.literal("down")),
    kind: v.union(v.literal("approval"), v.literal("swap")), executorAddress: v.string(), nonce: v.number(),
    transactionJson: v.string(), signedRawTransaction: v.string(), txHash: v.string(), quoteExpiresAt: v.number(),
    inputAsset: v.string(), outputAsset: v.string(), inputAmountUnits: v.string(), expectedAmountOutUnits: v.string(),
    priceBeforeWad: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    if (args.tokenIndex < 0 || args.tokenIndex > 2 || !/^0x[a-f0-9]{64}$/i.test(args.txHash)
        || !/^0x[0-9a-f]+$/i.test(args.signedRawTransaction) || args.signedRawTransaction.length > 300_000
        || args.quoteExpiresAt <= Date.now() || args.quoteExpiresAt > Date.now() + 30_000) throw new Error("Scenario transaction terms are invalid or stale.");
    const prior = await ctx.db.query("monadAutonomyScenarioOrders")
      .withIndex("by_idempotencyKey", (q: any) => q.eq("idempotencyKey", args.idempotencyKey)).first();
    if (prior) {
      if (prior.txHash !== args.txHash || prior.orderId !== args.orderId) throw new Error("Scenario order key was reused for a different transaction.");
      return prior;
    }
    const nonceRows = await ctx.db.query("monadAutonomyScenarioOrders")
      .withIndex("by_executor_nonce", (q: any) => q.eq("executorAddress", args.executorAddress.toLowerCase()).eq("nonce", args.nonce)).collect();
    if (nonceRows.some((row: any) => ["prepared", "broadcasting", "submitted", "uncertain"].includes(row.status))) {
      throw new Error("Autonomy operator transaction nonce is already reserved.");
    }
    await reserveAutonomyOperatorLease(ctx, { executorAddress: args.executorAddress, orderId: args.orderId,
      workflow: "scenario", expiresAt: args.quoteExpiresAt });
    if (args.scenarioId) {
      const scenario = await ctx.db.query("monadAutonomyScenarios")
        .withIndex("by_scenarioId", (q: any) => q.eq("scenarioId", args.scenarioId)).first();
      if (!scenario || scenario.status !== "running" || scenario.stepIndex !== args.stepIndex) throw new Error("Scenario tick is stale or no longer running.");
    }
    const id = await ctx.db.insert("monadAutonomyScenarioOrders", { ...args, status: "prepared",
      createdAt: Date.now(), updatedAt: Date.now() });
    return await ctx.db.get(id);
  },
});

export const claimBroadcast = mutation({
  args: { orderId: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx); const row = await getOrderRow(ctx, args.orderId);
    if (!row) throw new Error("Scenario transaction was not found.");
    if (row.status !== "prepared") return { claimed: false, status: row.status, txHash: row.txHash };
    const lease = await ctx.db.query("monadAutonomyOperatorLease")
      .withIndex("by_key", (q: any) => q.eq("key", "monad-autonomy-executor")).first();
    if (!lease || lease.orderId !== row.orderId || lease.workflow !== "scenario") {
      await ctx.db.patch(row._id, { status: "failed", updatedAt: Date.now() });
      return { claimed: false, status: "failed", txHash: row.txHash };
    }
    if (row.quoteExpiresAt <= Date.now()) {
      await ctx.db.patch(row._id, { status: "failed", updatedAt: Date.now() });
      await updateAutonomyOperatorLease(ctx, row.orderId, "failed");
      return { claimed: false, status: "failed", txHash: row.txHash };
    }
    await ctx.db.patch(row._id, { status: "broadcasting", updatedAt: Date.now() });
    await updateAutonomyOperatorLease(ctx, row.orderId, "broadcasting");
    return { claimed: true, signedRawTransaction: row.signedRawTransaction, txHash: row.txHash };
  },
});

export const recordSubmitted = mutation({ args: { orderId: v.string(), txHash: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await getOrderRow(ctx, args.orderId);
  if (!row || row.txHash !== args.txHash || !["broadcasting", "submitted", "uncertain"].includes(row.status)) throw new Error("Scenario tx does not match its persisted signed payload.");
  await ctx.db.patch(row._id, { status: "submitted", updatedAt: Date.now() });
  await updateAutonomyOperatorLease(ctx, row.orderId, "submitted");
  return { status: "submitted", txHash: row.txHash };
} });

export const recordUncertain = mutation({ args: { orderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await getOrderRow(ctx, args.orderId);
  if (!row || !["broadcasting", "submitted", "uncertain"].includes(row.status)) return null;
  await ctx.db.patch(row._id, { status: "uncertain", updatedAt: Date.now() });
  await updateAutonomyOperatorLease(ctx, row.orderId, "uncertain");
  return { status: "uncertain", txHash: row.txHash };
} });

export const recordRejected = mutation({
  args: { orderId: v.string(), reasonCode: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx); const row = await getOrderRow(ctx, args.orderId);
    if (!row || row.status !== "broadcasting") return null;
    const rejectionCode = args.reasonCode.replace(/[^a-z0-9_]/gi, "_").slice(0, 80);
    await ctx.db.patch(row._id, { status: "failed", rejectionCode, updatedAt: Date.now() });
    await updateAutonomyOperatorLease(ctx, row.orderId, "failed");
    return { status: "failed", txHash: row.txHash, rejectionCode };
  },
});

export const recordReceipt = mutation({
  args: { orderId: v.string(), txHash: v.string(), receiptStatus: v.number(), blockNumber: v.number(),
    blockHash: v.string(), canonicalBlockHash: v.string(), finalized: v.boolean(), outputAmountUnits: v.optional(v.string()),
    priceAfterWad: v.optional(v.string()), gasUsed: v.string(), effectiveGasPrice: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx); const row = await getOrderRow(ctx, args.orderId);
    if (!row || row.txHash !== args.txHash || ![0, 1].includes(args.receiptStatus)
        || row.blockNumber && row.blockNumber !== args.blockNumber
        || args.blockHash.toLowerCase() !== args.canonicalBlockHash.toLowerCase()) throw new Error("Scenario receipt failed canonical validation.");
    const status = args.finalized ? args.receiptStatus ? "finalized" : "failed" : "submitted";
    await ctx.db.patch(row._id, { status, receiptStatus: args.receiptStatus, blockNumber: args.blockNumber,
      blockHash: args.blockHash, ...(args.outputAmountUnits ? { outputAmountUnits: args.outputAmountUnits } : {}),
      ...(args.priceAfterWad ? { priceAfterWad: args.priceAfterWad } : {}), gasUsed: args.gasUsed,
      effectiveGasPrice: args.effectiveGasPrice, updatedAt: Date.now() });
    await updateAutonomyOperatorLease(ctx, row.orderId, status);
    return { ...row, status, receiptStatus: args.receiptStatus, blockNumber: args.blockNumber,
      outputAmountUnits: args.outputAmountUnits, priceAfterWad: args.priceAfterWad };
  },
});

async function getOrderRow(ctx: any, orderId: string) {
  return await ctx.db.query("monadAutonomyScenarioOrders")
    .withIndex("by_orderId", (q: any) => q.eq("orderId", orderId)).first();
}
