import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { appendMonadActivity, requireMonadOperator, reserveAutonomyOperatorLease, updateAutonomyOperatorLease } from "./monadHelpers";
import { perpTickClaimDecision } from "./monadPerpLeaseRules";
import { progressScenario } from "./monadPerpScenarios";
import { economicActivePnl, economicTerminalPnl, finalizedReturnUnits } from "./monadPerpAccounting";
import { venueDispatchTickArgs } from "./monadVenueWatchdogRules";
const internalApi: any = internal;
const terminal = ["completed", "expired", "failed", "liquidated"];

async function findRun(ctx: any, runId: string) {
  return await ctx.db.query("monadPerpRuns").withIndex("by_runId", (q: any) => q.eq("runId", runId)).first();
}
export const getWorkerRun = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findRun(ctx, args.runId);
  return row ? { ...row, markets: JSON.parse(row.marketsJson), mandate: JSON.parse(row.mandateTypedDataJson) } : null;
} });

export const claimTick = mutation({ args: { runId: v.string(), tickId: v.string(), holderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findRun(ctx, args.runId);
  const now = Date.now();
  const decision = perpTickClaimDecision(row, args.tickId, now);
  if (!decision.claimed) {
    if (decision.reason === "leased") await ctx.scheduler.runAfter(decision.retryAfterMs ?? 1000,
      internal.monadPerpActions.dispatchTick, venueDispatchTickArgs(args));
    return decision;
  }
  await ctx.db.patch(row._id, { leaseHolder: args.holderId, leaseExpiresAt: now + 45_000, updatedAt: now });
  return { claimed: true, row };
} });

export const scheduleRetry = internalMutation({ args: { runId: v.string(), tickId: v.string(), delayMs: v.number() },
  handler: async (ctx, args) => {
    const row = await findRun(ctx, args.runId);
    if (!row || terminal.includes(row.status) || row.nextTickId !== args.tickId) return false;
    await ctx.scheduler.runAfter(Math.max(1000, Math.min(60_000, args.delayMs)),
      internalApi.monadPerpActions.dispatchTick, { runId: args.runId, tickId: args.tickId });
    return true;
  } });

export const getObservations = query({ args: { runId: v.string(), limit: v.optional(v.number()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  return await ctx.db.query("monadPerpObservations").withIndex("by_run_time", (q: any) => q.eq("runId", args.runId))
    .order("desc").take(Math.max(3, Math.min(240, Math.floor(args.limit ?? 120))));
} });

export const completeTick = mutation({
  args: { runId: v.string(), tickId: v.string(), holderId: v.string(), status: v.string(),
    availableUsdcUnits: v.string(), realizedPnlUsdcUnits: v.string(), unrealizedPnlUsdcUnits: v.string(),
    markPriceWad: v.string(), equityUsdcUnits: v.string(),
    operatorGasMonWei: v.string(), positionJson: v.union(v.string(), v.null()), pendingOrderJson: v.union(v.string(), v.null()),
    expiresAt: v.union(v.number(), v.null()), activatedAt: v.union(v.number(), v.null()), stoppedAt: v.union(v.number(), v.null()),
    lastObservedBlock: v.number(), observations: v.array(v.any()), events: v.array(v.any()),
    continueAfter: v.boolean(), nextDelayMs: v.number() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx); const row = await findRun(ctx, args.runId);
    if (!row || row.leaseHolder !== args.holderId || row.nextTickId !== args.tickId || row.lastTickId === args.tickId) return { accepted: false, reason: "lease_lost" };
    if (args.lastObservedBlock < (row.lastObservedBlock ?? 0) || !/^\d+$/.test(args.availableUsdcUnits)
        || !/^-?\d+$/.test(args.realizedPnlUsdcUnits) || !/^-?\d+$/.test(args.unrealizedPnlUsdcUnits)
        || !/^\d+$/.test(args.operatorGasMonWei)) throw new Error("Perp tick reconciliation is invalid or non-monotonic.");
    const now = Date.now();
    for (const item of args.observations) {
      const prior = await ctx.db.query("monadPerpObservations").withIndex("by_run_market_time", (q: any) =>
        q.eq("runId", row.runId).eq("marketIndex", item.marketIndex)).order("desc").first();
      if (prior?.blockNumber !== item.blockNumber) await ctx.db.insert("monadPerpObservations", { ...item,
        runId: row.runId, ownerAddress: row.ownerAddress, createdAt: now });
    }
    for (const event of args.events) await persistEvent(ctx, row, event);
    let returnedUnits = args.events.map(finalizedReturnUnits).find((value) => value !== null)
      ?? row.returnedUsdcUnits ?? null;
    if (terminal.includes(args.status) && !returnedUnits) returnedUnits = await terminalReturn(ctx, row.runId);
    const realizedPnl = returnedUnits ? economicTerminalPnl(row.amountUnits, returnedUnits)
      : row.activatedAt || args.activatedAt ? economicActivePnl({ startingUnits: row.amountUnits,
        availableUnits: args.availableUsdcUnits, positionJson: args.positionJson,
        pendingOrderJson: args.pendingOrderJson }) : args.realizedPnlUsdcUnits;
    await progressScenario(ctx, row, args.events, args.status);
    let nextTickId: string | undefined; let scheduledFunctionId: any;
    const repeat = args.continueAfter && !terminal.includes(args.status);
    if (repeat) {
      nextTickId = `${row.runId}:tick:${row.tickSequence}`;
      scheduledFunctionId = await ctx.scheduler.runAfter(Math.max(1000, Math.min(60_000, args.nextDelayMs)),
        internalApi.monadPerpActions.dispatchTick, { runId: row.runId, tickId: nextTickId });
    }
    await ctx.db.patch(row._id, { status: args.status, availableUsdcUnits: args.availableUsdcUnits,
      realizedPnlUsdcUnits: realizedPnl, returnedUsdcUnits: returnedUnits ?? undefined,
      unrealizedPnlUsdcUnits: args.unrealizedPnlUsdcUnits,
      markPriceWad: args.markPriceWad, equityUsdcUnits: args.equityUsdcUnits,
      operatorGasMonWei: args.operatorGasMonWei, positionJson: args.positionJson ?? undefined,
      pendingOrderJson: args.pendingOrderJson ?? undefined, expiresAt: args.expiresAt ?? undefined,
      activatedAt: args.activatedAt ?? row.activatedAt, stoppedAt: args.stoppedAt ?? undefined,
      lastObservedBlock: args.lastObservedBlock, lastTickId: args.tickId, nextTickId, scheduledFunctionId,
      tickSequence: repeat ? row.tickSequence + 1 : row.tickSequence, leaseHolder: undefined, leaseExpiresAt: undefined,
      completedAt: terminal.includes(args.status) ? now : undefined, updatedAt: now });
    return { accepted: true, nextTickId };
  },
});

async function terminalReturn(ctx: any, runId: string) {
  const events = await ctx.db.query("monadPerpEvents").withIndex("by_run_timestamp", (q: any) =>
    q.eq("runId", runId)).order("desc").take(30);
  return events.map(finalizedReturnUnits).find((value: string | null) => value !== null) ?? null;
}

export const repairTerminalAccounting = mutation({ args: { runId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const row = await findRun(ctx, args.runId);
  if (!row || !["completed", "expired"].includes(row.status)) throw new Error("Only settled perp runs can be reconciled.");
  const returnedUnits = await terminalReturn(ctx, row.runId);
  if (!returnedUnits) throw new Error("No finalized onchain settlement event is stored for this run.");
  const orders = await ctx.db.query("monadPerpOrders").withIndex("by_runId_createdAt", (q: any) =>
    q.eq("runId", row.runId)).collect();
  const gas = orders.reduce((total: bigint, order: any) => ["finalized", "failed"].includes(order.status)
    && order.receiptStatus !== undefined
      ? total + BigInt(order.gasUsed ?? "0") * BigInt(order.effectiveGasPrice ?? "0") : total, 0n);
  const realizedPnlUsdcUnits = economicTerminalPnl(row.amountUnits, returnedUnits);
  await ctx.db.patch(row._id, { returnedUsdcUnits: returnedUnits, realizedPnlUsdcUnits,
    operatorGasMonWei: gas.toString(), updatedAt: Date.now() });
  return { runId: row.runId, returnedUsdcUnits: returnedUnits, realizedPnlUsdcUnits,
    operatorGasMonWei: gas.toString() };
} });

async function persistEvent(ctx: any, row: any, event: any) {
  const eventId = `perp:${row.runId}:${event.eventId}`;
  const prior = await ctx.db.query("monadPerpEvents").withIndex("by_eventId", (q: any) => q.eq("eventId", eventId)).first();
  if (prior) return;
  const payloadJson = event.payload ? JSON.stringify(event.payload).slice(0, 20_000) : undefined;
  await ctx.db.insert("monadPerpEvents", { runId: row.runId, venueId: "monad-mock-clearinghouse-v1", ownerAddress: row.ownerAddress, eventId,
    timestamp: event.timestamp ?? Date.now(), type: event.type, status: event.status,
    summary: String(event.summary ?? event.type).slice(0, 300), ...(event.orderId ? { orderId: event.orderId } : {}),
    ...(event.txHash ? { txHash: event.txHash } : {}), ...(event.blockNumber !== undefined ? { blockNumber: event.blockNumber } : {}),
    ...(payloadJson ? { payloadJson } : {}) });
  if (event.activity !== false) await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: row.ownerAddress, activityId: eventId,
    kind: event.type, status: event.status, summary: event.summary ?? event.type, txHash: event.txHash,
    venueId: "monad-mock-clearinghouse-v1", dataJson: payloadJson ?? JSON.stringify({ runId: row.runId, orderId: event.orderId }) });
}
