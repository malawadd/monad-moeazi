import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { appendMonadActivity, requireMonadOperator, reserveAutonomyOperatorLease, updateAutonomyOperatorLease } from "./monadHelpers";
const internalApi: any = internal;

async function run(ctx: any, runId: string) {
  return await ctx.db.query("monadPerpRuns").withIndex("by_runId", (q: any) => q.eq("runId", runId)).first();
}
async function order(ctx: any, orderId: string) {
  return await ctx.db.query("monadPerpOrders").withIndex("by_orderId", (q: any) => q.eq("orderId", orderId)).first();
}

export const getWorkerRun = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const row = await run(ctx, args.runId); if (!row) return null;
  return { ...row, markets: JSON.parse(row.marketsJson), mandate: JSON.parse(row.mandateTypedDataJson) };
} });
export const getOrders = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  return await ctx.db.query("monadPerpOrders").withIndex("by_runId_createdAt", (q: any) => q.eq("runId", args.runId)).order("asc").collect();
} });
export const getOrder = query({ args: { orderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); return await order(ctx, args.orderId);
} });
export const getOrderByIdempotency = query({ args: { idempotencyKey: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  return await ctx.db.query("monadPerpOrders").withIndex("by_idempotencyKey", (q: any) => q.eq("idempotencyKey", args.idempotencyKey)).first();
} });

export const queueFunding = mutation({
  args: { runId: v.string(), ownerAddress: v.string(), txHash: v.string(), rawTransaction: v.string(),
    transactionJson: v.string(), nonce: v.number(), executorAddress: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await run(ctx, args.runId);
    if (!row || row.ownerAddress !== args.ownerAddress.toLowerCase()) throw new Error("Prepared perp enrollment was not found.");
    if (!/^0x[a-f0-9]{64}$/i.test(args.txHash) || !/^0x[0-9a-f]+$/i.test(args.rawTransaction)
        || args.rawTransaction.length > 300_000 || !Number.isSafeInteger(args.nonce) || args.nonce < 0) throw new Error("Perp funding transaction is invalid.");
    const orderId = `${row.runId}:funding`;
    const prior = await order(ctx, orderId);
    if (prior && prior.txHash !== args.txHash) throw new Error("Perp funding order already has a different signed transaction.");
    if (row.status === "activation_pending" && prior) return { runId: row.runId, status: row.status, txHash: prior.txHash };
    if (row.status !== "prepared" || row.setupDeadline < Math.floor(Date.now() / 1000)) throw new Error("Perp enrollment preparation expired.");
    const nonceRows = await ctx.db.query("monadPerpOrders").withIndex("by_executor_nonce", (q: any) =>
      q.eq("executorAddress", args.executorAddress.toLowerCase()).eq("nonce", args.nonce)).collect();
    if (nonceRows.some((item: any) => item.orderId !== orderId && !["failed", "finalized"].includes(item.status))) throw new Error("Perp executor nonce is already reserved.");
    await reserveAutonomyOperatorLease(ctx, { executorAddress: args.executorAddress, orderId, workflow: "perp", expiresAt: row.setupDeadline * 1000 });
    if (!prior) await ctx.db.insert("monadPerpOrders", { runId: row.runId, venueId: "monad-mock-clearinghouse-v1", ownerAddress: row.ownerAddress,
      orderId, idempotencyKey: orderId, kind: "funding", status: "prepared", transactionJson: args.transactionJson,
      signedRawTransaction: args.rawTransaction, txHash: args.txHash, executorAddress: args.executorAddress.toLowerCase(),
      nonce: args.nonce, vaultAddress: row.vaultAddress, clearinghouseAddress: row.clearinghouseAddress,
      createdAt: Date.now(), updatedAt: Date.now() });
    const tickId = `${row.runId}:tick:${row.tickSequence}`;
    const scheduledFunctionId = await ctx.scheduler.runAfter(0, internalApi.monadPerpActions.dispatchTick, { runId: row.runId, tickId });
    await ctx.db.patch(row._id, { status: "activation_pending", fundingTxHash: args.txHash,
      fundingRawTransaction: args.rawTransaction, fundingNonce: args.nonce, fundingStatus: "prepared", executorAddress: args.executorAddress.toLowerCase(),
      nextTickId: tickId, scheduledFunctionId, tickSequence: row.tickSequence + 1, updatedAt: Date.now() });
    return { runId: row.runId, status: "activation_pending", txHash: args.txHash, tickId };
  },
});

export const persistOrder = mutation({
  args: { runId: v.string(), orderId: v.string(), idempotencyKey: v.string(), kind: v.string(),
    marketIndex: v.optional(v.number()), side: v.optional(v.string()), leverage: v.optional(v.number()),
    marginUnits: v.optional(v.string()), sizeWad: v.optional(v.string()), limitPriceWad: v.optional(v.string()),
    expectedPriceWad: v.optional(v.string()), validUntil: v.optional(v.number()), quoteBlockNumber: v.optional(v.number()),
    scenarioId: v.optional(v.string()), scenarioStep: v.optional(v.number()),
    vaultAddress: v.string(), clearinghouseAddress: v.string(), transactionJson: v.string(), rawTransaction: v.string(),
    txHash: v.string(), executorAddress: v.string(), nonce: v.number(), leaseExpiresAt: v.number() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await run(ctx, args.runId);
    if (!row || ["completed", "expired", "failed"].includes(row.status)) throw new Error("Perp run cannot accept another order.");
    if (args.scenarioId && (row.activeScenarioId !== args.scenarioId || !Number.isSafeInteger(args.scenarioStep))) {
      throw new Error("Perp scenario step no longer matches the active run.");
    }
    if (!/^[A-Za-z0-9._:-]{8,180}$/.test(args.orderId) || !/^[A-Za-z0-9._:-]{8,180}$/.test(args.idempotencyKey)
        || !/^0x[a-f0-9]{64}$/i.test(args.txHash) || !/^0x[0-9a-f]+$/i.test(args.rawTransaction)
        || args.rawTransaction.length > 300_000 || !Number.isSafeInteger(args.nonce) || args.nonce < 0) throw new Error("Perp signed transaction envelope is invalid.");
    const prior = await order(ctx, args.orderId);
    if (prior) {
      if (prior.txHash !== args.txHash || prior.idempotencyKey !== args.idempotencyKey) throw new Error("Perp order id was reused for different terms.");
      return prior;
    }
    const byKey = await ctx.db.query("monadPerpOrders").withIndex("by_idempotencyKey", (q: any) => q.eq("idempotencyKey", args.idempotencyKey)).first();
    if (byKey) throw new Error("Perp order idempotency key is already in use.");
    const nonceRows = await ctx.db.query("monadPerpOrders").withIndex("by_executor_nonce", (q: any) =>
      q.eq("executorAddress", args.executorAddress.toLowerCase()).eq("nonce", args.nonce)).collect();
    if (nonceRows.some((item: any) => !["failed", "finalized"].includes(item.status))) throw new Error("Perp executor nonce is already reserved.");
    await reserveAutonomyOperatorLease(ctx, { executorAddress: args.executorAddress, orderId: args.orderId,
      workflow: "perp", expiresAt: args.leaseExpiresAt });
    const now = Date.now();
    const { rawTransaction, leaseExpiresAt: _leaseExpiresAt, ...stored } = args;
    const id = await ctx.db.insert("monadPerpOrders", { ...stored, venueId: "monad-mock-clearinghouse-v1", ownerAddress: row.ownerAddress,
      signedRawTransaction: rawTransaction,
      status: "prepared", executorAddress: args.executorAddress.toLowerCase(), createdAt: now, updatedAt: now });
    return await ctx.db.get(id);
  },
});

export const requestStop = mutation({ args: { runId: v.string(), orderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const runRow = await run(ctx, args.runId); const orderRow = await order(ctx, args.orderId);
  if (!runRow || !orderRow || orderRow.runId !== runRow.runId || orderRow.kind !== "stop"
      || orderRow.status !== "prepared" || !["active", "activation_pending", "uncertain"].includes(runRow.status)) {
    throw new Error("Perp stop request does not match an active owner run.");
  }
  const tickId = `${runRow.runId}:tick:${runRow.tickSequence}`;
  const scheduledFunctionId = await ctx.scheduler.runAfter(0, internalApi.monadPerpActions.dispatchTick,
    { runId: runRow.runId, tickId });
  await ctx.db.patch(runRow._id, { status: "stopping", stopOrderId: orderRow.orderId,
    nextTickId: tickId, scheduledFunctionId, tickSequence: runRow.tickSequence + 1, updatedAt: Date.now() });
  return { runId: runRow.runId, status: "stopping", phase: "prepared", transactionHash: null };
} });

export const updateOrder = mutation({
  args: { orderId: v.string(), status: v.string(), blockNumber: v.optional(v.number()), blockHash: v.optional(v.string()),
    receiptStatus: v.optional(v.number()), gasUsed: v.optional(v.string()), effectiveGasPrice: v.optional(v.string()), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await order(ctx, args.orderId); if (!row) throw new Error("Perp order was not found.");
    const allowed = ["prepared", "broadcasting", "submitted", "executed", "finalized", "failed", "uncertain"];
    if (!allowed.includes(args.status) || ["finalized", "failed"].includes(row.status) && row.status !== args.status) throw new Error("Perp order state transition is invalid.");
    await ctx.db.patch(row._id, { status: args.status, blockNumber: args.blockNumber ?? row.blockNumber,
      blockHash: args.blockHash ?? row.blockHash, receiptStatus: args.receiptStatus ?? row.receiptStatus,
      gasUsed: args.gasUsed ?? row.gasUsed, effectiveGasPrice: args.effectiveGasPrice ?? row.effectiveGasPrice,
      errorCode: args.errorCode ?? row.errorCode, updatedAt: Date.now() });
    await updateAutonomyOperatorLease(ctx, row.orderId, args.status);
    if (row.kind === "funding") {
      const ownerRun = await run(ctx, row.runId);
      if (ownerRun) await ctx.db.patch(ownerRun._id, { fundingStatus: args.status, updatedAt: Date.now() });
    }
    if (args.status === "submitted" && row.status !== "submitted") {
      const ownerRun = await run(ctx, row.runId);
      if (ownerRun) {
        const eventId = `perp:${row.runId}:${row.orderId}:submitted`;
        const prior = await ctx.db.query("monadPerpEvents").withIndex("by_eventId", (q: any) => q.eq("eventId", eventId)).first();
        if (!prior) {
          const summary = `Perp ${row.kind} transaction submitted to Monad`;
          await ctx.db.insert("monadPerpEvents", { runId: row.runId, venueId: "monad-mock-clearinghouse-v1", ownerAddress: row.ownerAddress, eventId,
            timestamp: Date.now(), type: "perp_order_submitted", status: "submitted", summary,
            orderId: row.orderId, txHash: row.txHash });
          await appendMonadActivity(ctx, { userId: ownerRun.userId, ownerAddress: row.ownerAddress,
            activityId: eventId, kind: "perp_order_submitted", status: "submitted", summary, txHash: row.txHash,
            venueId: "monad-mock-clearinghouse-v1", dataJson: JSON.stringify({ runId: row.runId, orderId: row.orderId, kind: row.kind }) });
        }
      }
    }
    return { orderId: row.orderId, status: args.status, txHash: row.txHash };
  },
});
