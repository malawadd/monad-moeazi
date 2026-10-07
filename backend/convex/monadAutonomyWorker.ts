import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireMonadOperator, reserveAutonomyOperatorLease, updateAutonomyOperatorLease } from "./monadHelpers";

const internalApi: any = internal;
const terminal = ["completed", "incomplete_settlement", "recovered", "expired", "failed"];
const repeatable = ["activation_pending", "active", "settling", "uncertain"];

async function findRun(ctx: any, enrollmentId: string) {
  return await ctx.db.query("monadAutonomyEnrollments")
    .withIndex("by_enrollmentId", (q: any) => q.eq("enrollmentId", enrollmentId)).first();
}

async function assertNoActiveRun(ctx: any, owner: string, excludingId?: string) {
  for (const status of repeatable) {
    const row = await ctx.db.query("monadAutonomyEnrollments")
      .withIndex("by_owner_status", (q: any) => q.eq("ownerAddress", owner).eq("status", status)).first();
    if (row && row.enrollmentId !== excludingId) throw new Error("An autonomy enrollment is already active or settling for this owner.");
  }
}

export const getWorkerEnrollment = query({ args: { enrollmentId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const row = await findRun(ctx, args.enrollmentId);
  if (!row) return null;
  return { ...row, circleTypedData: JSON.parse(row.circleTypedDataJson),
    mandateTypedData: JSON.parse(row.mandateTypedDataJson), tokens: JSON.parse(row.tokensJson), pools: JSON.parse(row.poolsJson) };
} });

export const queueFunding = mutation({
  args: { enrollmentId: v.string(), ownerAddress: v.string(), txHash: v.string(), rawTransaction: v.string(),
    transactionJson: v.string(), nonce: v.number(), executorAddress: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await findRun(ctx, args.enrollmentId);
    if (!row || row.ownerAddress !== args.ownerAddress.toLowerCase()) throw new Error("Prepared autonomy enrollment was not found.");
    if (!/^0x[a-f0-9]{64}$/.test(args.txHash) || !/^0x[0-9a-f]+$/i.test(args.rawTransaction)
        || args.rawTransaction.length > 300_000 || !Number.isSafeInteger(args.nonce) || args.nonce < 0) {
      throw new Error("Autonomy funding transaction is invalid.");
    }
    if (row.status === "activation_pending" && row.fundingTxHash === args.txHash) return { ...row, repeated: true };
    if (row.status !== "prepared" || row.startBy < Math.floor(Date.now() / 1000)) {
      throw new Error("Autonomy preparation expired. Create a fresh Mera review.");
    }
    await assertNoActiveRun(ctx, row.ownerAddress, row.enrollmentId);
    const orderId = `${row.enrollmentId}:funding`;
    const priorOrder = await ctx.db.query("monadAutonomyOrders")
      .withIndex("by_orderId", (q: any) => q.eq("orderId", orderId)).first();
    if (priorOrder && priorOrder.txHash !== args.txHash) throw new Error("Enrollment funding order already has a different transaction.");
    const nonceRows = await ctx.db.query("monadAutonomyOrders")
      .withIndex("by_executor_nonce", (q: any) => q.eq("executorAddress", args.executorAddress.toLowerCase()).eq("nonce", args.nonce)).collect();
    if (nonceRows.some((item: any) => item.orderId !== orderId
        && ["prepared", "broadcasting", "submitted", "uncertain"].includes(item.status))) {
      throw new Error("Autonomy operator transaction nonce is already reserved.");
    }
    await reserveAutonomyOperatorLease(ctx, { executorAddress: args.executorAddress, orderId,
      workflow: "autonomy", expiresAt: row.startBy * 1000 });
    if (!priorOrder) await ctx.db.insert("monadAutonomyOrders", {
      enrollmentId: row.enrollmentId, ownerAddress: row.ownerAddress, orderId, tickId: `${row.enrollmentId}:funding`,
      kind: "funding", status: "prepared", transactionJson: args.transactionJson,
      signedRawTransaction: args.rawTransaction, txHash: args.txHash, nonce: args.nonce,
      executorAddress: args.executorAddress.toLowerCase(), quoteExpiresAt: row.startBy * 1000,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    const tickId = `${row.enrollmentId}:tick:${row.tickSequence}`;
    const scheduledFunctionId = await ctx.scheduler.runAfter(0, internal.monadAutonomyActions.dispatchTick,
      { enrollmentId: row.enrollmentId, tickId });
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "activation_pending", fundingTxHash: args.txHash,
      fundingRawTransaction: args.rawTransaction, fundingNonce: args.nonce,
      nextTickId: tickId, scheduledFunctionId, tickSequence: row.tickSequence + 1, updatedAt: now });
    await addEvent(ctx, row, { eventId: `${row.enrollmentId}:activation_pending`, type: "funding_submitted",
      status: "activation_pending", summary: "Atomic USDC funding and mandate authorization submitted", txHash: args.txHash });
    return { enrollmentId: row.enrollmentId, status: "activation_pending", txHash: args.txHash, tickId };
  },
});

export const claimTick = mutation({
  args: { enrollmentId: v.string(), tickId: v.string(), holderId: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await findRun(ctx, args.enrollmentId);
    if (!row || terminal.includes(row.status)) return { claimed: false, reason: "terminal" };
    if (row.nextTickId !== args.tickId || row.lastTickId === args.tickId) return { claimed: false, reason: "duplicate" };
    const now = Date.now();
    if (row.status === "activation_pending" && row.nextTickId === args.tickId) {
      const funding = await ctx.db.query("monadAutonomyOrders")
        .withIndex("by_orderId", (q: any) => q.eq("orderId", `${row.enrollmentId}:funding`)).first();
      if (funding?.status === "prepared" && row.startBy * 1000 <= now) {
        await ctx.db.patch(funding._id, { status: "failed", updatedAt: now });
        await updateAutonomyOperatorLease(ctx, funding.orderId, "failed");
        await ctx.db.patch(row._id, { status: "failed", completedAt: now, updatedAt: now });
        return { claimed: false, reason: "funding_expired" };
        return { claimed: false, reason: "funding_expired" };
      }
    }
    if (row.leaseHolder && row.leaseExpiresAt && row.leaseExpiresAt > now) {
      await ctx.scheduler.runAfter(row.leaseExpiresAt - now + 1000, internalApi.monadAutonomyActions.dispatchTick,
        { enrollmentId: row.enrollmentId, tickId: args.tickId });
      return { claimed: false, reason: "leased", retryAfterMs: row.leaseExpiresAt - now };
    }
    await ctx.db.patch(row._id, { leaseHolder: args.holderId, leaseExpiresAt: now + 45_000, updatedAt: now });
    return { claimed: true, row };
  },
});

export const scheduleRetry = internalMutation({
  args: { enrollmentId: v.string(), tickId: v.string(), delayMs: v.number() },
  handler: async (ctx, args) => {
    const row = await findRun(ctx, args.enrollmentId);
    if (!row || terminal.includes(row.status) || row.nextTickId !== args.tickId) return false;
    await ctx.scheduler.runAfter(Math.max(1000, Math.min(60_000, args.delayMs)),
      internalApi.monadAutonomyActions.dispatchTick, { enrollmentId: args.enrollmentId, tickId: args.tickId });
    return true;
  },
});

export const scheduleScenarioRetry = internalMutation({
  args: { scenarioId: v.string(), tickId: v.string(), delayMs: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("monadAutonomyScenarios")
      .withIndex("by_scenarioId", (q: any) => q.eq("scenarioId", args.scenarioId)).first();
    if (!row || row.status !== "running" || row.nextTickId !== args.tickId) return false;
    await ctx.scheduler.runAfter(Math.max(1000, Math.min(60_000, args.delayMs)),
      internalApi.monadAutonomyActions.dispatchScenarioTick, { scenarioId: args.scenarioId, tickId: args.tickId });
    return true;
  },
});

export const getObservations = query({
  args: { enrollmentId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const limit = Math.max(3, Math.min(120, Math.floor(args.limit ?? 24)));
    return await ctx.db.query("monadAutonomyObservations")
      .withIndex("by_enrollment_time", (q: any) => q.eq("enrollmentId", args.enrollmentId))
      .order("desc").take(limit);
  },
});

export const completeTick = mutation({
  args: { enrollmentId: v.string(), tickId: v.string(), holderId: v.string(),
    status: v.union(v.literal("activation_pending"), v.literal("active"), v.literal("settling"),
      v.literal("completed"), v.literal("incomplete_settlement"), v.literal("recovered"),
      v.literal("expired"), v.literal("failed"), v.literal("uncertain")),
    availableUsdcUnits: v.string(), realizedPnlUsdcUnits: v.string(), operatorGasMonWei: v.string(),
    cyclesCompleted: v.number(), openPositionJson: v.union(v.string(), v.null()), latestDecisionJson: v.string(),
    expiresAt: v.union(v.number(), v.null()), activatedAt: v.union(v.number(), v.null()),
    lastObservedBlock: v.number(), lastCycleCompletedAt: v.union(v.number(), v.null()),
    observations: v.array(v.any()), events: v.array(v.any()), continueAfter: v.boolean(), nextDelayMs: v.number() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await findRun(ctx, args.enrollmentId);
    if (!row || row.leaseHolder !== args.holderId || row.nextTickId !== args.tickId || row.lastTickId === args.tickId) {
      return { accepted: false, reason: "lease_lost" };
    }
    const now = Date.now();
    for (const observation of args.observations) {
      await ctx.db.insert("monadAutonomyObservations", { ...observation,
        enrollmentId: row.enrollmentId, ownerAddress: row.ownerAddress, createdAt: now });
    }
    for (const event of args.events) await addEvent(ctx, row, event);
    let nextTickId: string | null = null; let scheduledFunctionId: any;
    const repeat = args.continueAfter && !terminal.includes(args.status);
    if (repeat) {
      nextTickId = `${row.enrollmentId}:tick:${row.tickSequence}`;
      scheduledFunctionId = await ctx.scheduler.runAfter(Math.max(1000, Math.min(60_000, args.nextDelayMs)),
        internalApi.monadAutonomyActions.dispatchTick, { enrollmentId: row.enrollmentId, tickId: nextTickId });
    }
    await ctx.db.patch(row._id, { status: args.status, availableUsdcUnits: args.availableUsdcUnits,
      realizedPnlUsdcUnits: args.realizedPnlUsdcUnits, operatorGasMonWei: args.operatorGasMonWei,
      cyclesCompleted: args.cyclesCompleted, openPositionJson: args.openPositionJson ?? undefined,
      latestDecisionJson: args.latestDecisionJson, expiresAt: args.expiresAt ?? undefined,
      activatedAt: args.activatedAt ?? row.activatedAt,
      lastObservedBlock: args.lastObservedBlock, lastCycleCompletedAt: args.lastCycleCompletedAt ?? undefined,
      lastTickId: args.tickId, leaseHolder: undefined, leaseExpiresAt: undefined,
      nextTickId: nextTickId ?? undefined, scheduledFunctionId, tickSequence: repeat ? row.tickSequence + 1 : row.tickSequence,
      completedAt: terminal.includes(args.status) ? now : undefined, updatedAt: now });
    return { accepted: true, nextTickId, scheduledFunctionId };
  },
});

export const reconcileTerminal = mutation({
  args: { enrollmentId: v.string(), status: v.string(), finalizedBlockNumber: v.number(),
    availableUsdcUnits: v.string(), realizedPnlUsdcUnits: v.string(), operatorGasMonWei: v.string(),
    cyclesCompleted: v.number(), reconciledOrders: v.array(v.object({ orderId: v.string(), kind: v.string(),
      txHash: v.string(), blockNumber: v.number(), receiptStatus: v.number() })) },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await findRun(ctx, args.enrollmentId);
    if (!row || !["completed", "incomplete_settlement", "recovered"].includes(row.status)
        || row.status !== args.status || args.finalizedBlockNumber < (row.lastObservedBlock ?? 0)
        || !/^-?\d+$/.test(args.realizedPnlUsdcUnits)
        || !/^\d+$/.test(args.availableUsdcUnits) || !/^\d+$/.test(args.operatorGasMonWei)
        || args.cyclesCompleted !== row.cyclesCompleted) {
      throw new Error("Terminal autonomy reconciliation terms are invalid.");
    }
    for (const order of args.reconciledOrders) {
      const saved = await ctx.db.query("monadAutonomyOrders")
        .withIndex("by_orderId", (q: any) => q.eq("orderId", order.orderId)).first();
      if (!saved || saved.enrollmentId !== row.enrollmentId || saved.txHash !== order.txHash
          || saved.receiptStatus !== order.receiptStatus || saved.blockNumber !== order.blockNumber
          || saved.status !== (order.receiptStatus === 1 ? "finalized" : "failed")) {
        throw new Error("A terminal order receipt was not persisted.");
      }
      await addEvent(ctx, row, { eventId: `${order.orderId}:receipt`, type: `${order.kind}_receipt`,
        status: saved.status, summary: `${order.kind} receipt reconciled after vault settlement`,
        txHash: order.txHash, blockNumber: order.blockNumber, orderId: order.orderId });
    }
    await ctx.db.patch(row._id, { availableUsdcUnits: args.availableUsdcUnits,
      realizedPnlUsdcUnits: args.realizedPnlUsdcUnits, operatorGasMonWei: args.operatorGasMonWei,
      lastObservedBlock: args.finalizedBlockNumber, updatedAt: Date.now() });
    return { enrollmentId: row.enrollmentId, status: row.status,
      availableUsdcUnits: args.availableUsdcUnits, realizedPnlUsdcUnits: args.realizedPnlUsdcUnits,
      operatorGasMonWei: args.operatorGasMonWei, reconciledOrders: args.reconciledOrders.length };
  },
});

async function addEvent(ctx: any, row: any, event: any) {
  const prior = await ctx.db.query("monadAutonomyEvents")
    .withIndex("by_eventId", (q: any) => q.eq("eventId", event.eventId)).first();
  if (prior) return;
  await ctx.db.insert("monadAutonomyEvents", { enrollmentId: row.enrollmentId, ownerAddress: row.ownerAddress,
    eventId: event.eventId, timestamp: event.timestamp ?? Date.now(), type: event.type,
    status: event.status, summary: String(event.summary ?? event.type).slice(0, 300),
    ...(event.ruleVersion ? { ruleVersion: event.ruleVersion } : {}),
    ...(event.signal ? { signalJson: JSON.stringify(event.signal) } : {}),
    ...(event.inputs ? { inputsJson: JSON.stringify(event.inputs).slice(0, 20_000) } : {}),
    ...(event.output ? { outputJson: JSON.stringify(event.output).slice(0, 20_000) } : {}),
    ...(event.orderId ? { orderId: event.orderId } : {}), ...(event.txHash ? { txHash: event.txHash } : {}),
    ...(event.blockNumber !== undefined ? { blockNumber: event.blockNumber } : {}),
    ...(event.amountInUnits ? { amountInUnits: event.amountInUnits } : {}),
    ...(event.amountOutUnits ? { amountOutUnits: event.amountOutUnits } : {}),
    ...(event.tokenAddress ? { tokenAddress: event.tokenAddress } : {}),
    ...(event.tokenSymbol ? { tokenSymbol: event.tokenSymbol } : {}) });
}
