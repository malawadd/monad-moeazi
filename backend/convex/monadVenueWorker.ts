import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendMonadActivity, requireMonadOperator } from "./monadHelpers";

const internalApi: any = internal;
async function findRun(ctx: any, runId: string) {
  return await ctx.db.query("monadVenueRuns").withIndex("by_runId", (q: any) => q.eq("runId", runId)).first();
}
async function event(ctx: any, row: any, item: any) {
  const eventId = `${row.venueId}:${row.runId}:${item.eventId}`;
  if (await ctx.db.query("monadVenueEvents").withIndex("by_eventId", (q: any) => q.eq("eventId", eventId)).first()) return;
  const kind = String(item.kind ?? "perpl_status").startsWith("perp_") || String(item.kind ?? "").startsWith("perpl_")
    ? String(item.kind) : `perpl_${String(item.kind ?? "status")}`;
  const dataJson = item.dataJson ? String(item.dataJson).slice(0, 20_000) : item.data ? JSON.stringify(item.data).slice(0, 20_000) : undefined;
  const timestamp = Number(item.timestamp ?? Date.now()); const summary = String(item.summary ?? kind).slice(0, 300);
  await ctx.db.insert("monadVenueEvents", { eventId, runId: row.runId, venueId: row.venueId, userId: row.userId,
    ownerAddress: row.ownerAddress, kind, status: String(item.status ?? "observed"), summary, timestamp,
    ...(item.orderId ? { orderId: String(item.orderId) } : {}), ...(item.txHash ? { txHash: String(item.txHash) } : {}),
    ...(Number.isSafeInteger(item.blockNumber) ? { blockNumber: item.blockNumber } : {}), ...(dataJson ? { dataJson } : {}) });
  await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: row.ownerAddress, activityId: eventId,
    kind, status: String(item.status ?? "observed"), summary, venueId: row.venueId, txHash: item.txHash, dataJson });
}

export const getWorkerRun = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); return await findRun(ctx, args.runId);
} });

export const claimTick = mutation({ args: { runId: v.string(), tickId: v.string(), holderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findRun(ctx, args.runId); const now = Date.now();
  if (!row || row.nextTickId !== args.tickId || row.lastTickId === args.tickId) return { claimed: false, reason: "stale" };
  if (row.leaseExpiresAt && row.leaseExpiresAt > now) {
    await ctx.scheduler.runAfter(Math.max(1_000, row.leaseExpiresAt - now), internalApi.monadVenueActions.dispatchTick, args);
    return { claimed: false, reason: "leased" };
  }
  await ctx.db.patch(row._id, { leaseHolder: args.holderId, leaseExpiresAt: now + 45_000, updatedAt: now });
  return { claimed: true, row };
} });

export const scheduleRetry = internalMutation({ args: { runId: v.string(), tickId: v.string(), delayMs: v.number() }, handler: async (ctx, args) => {
  const row = await findRun(ctx, args.runId); if (!row || row.nextTickId !== args.tickId) return false;
  await ctx.scheduler.runAfter(Math.max(1_000, Math.min(60_000, args.delayMs)), internalApi.monadVenueActions.dispatchTick,
    { runId: args.runId, tickId: args.tickId }); return true;
} });

export const getObservations = query({ args: { runId: v.string(), marketId: v.optional(v.number()), limit: v.optional(v.number()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const limit = Math.max(3, Math.min(240, Math.floor(args.limit ?? 120)));
  if (Number.isSafeInteger(args.marketId)) return await ctx.db.query("monadVenueObservations").withIndex("by_run_market_time", (q: any) =>
    q.eq("runId", args.runId).eq("marketId", args.marketId)).order("desc").take(limit);
  return await ctx.db.query("monadVenueObservations").withIndex("by_run_time", (q: any) => q.eq("runId", args.runId)).order("desc").take(limit);
} });

export const recordObservations = mutation({ args: { runId: v.string(), snapshots: v.array(v.any()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findRun(ctx, args.runId); if (!row) throw new Error("Perpl run not found.");
  if (args.snapshots.length > 16) throw new Error("Too many Perpl market observations.");
  for (const item of args.snapshots) {
    if (!Number.isSafeInteger(item.marketId) || !Number.isSafeInteger(item.blockNumber) || item.blockNumber < 0
      || !Number.isSafeInteger(item.observedAt) || item.snapshotJson?.length > 12_000) throw new Error("Perpl market observation is invalid.");
    const prior = await ctx.db.query("monadVenueObservations").withIndex("by_run_market_time", (q: any) =>
      q.eq("runId", row.runId).eq("marketId", item.marketId)).order("desc").first();
    if (prior?.blockNumber !== item.blockNumber) await ctx.db.insert("monadVenueObservations", { runId: row.runId,
      venueId: row.venueId, ownerAddress: row.ownerAddress, marketId: item.marketId, blockNumber: item.blockNumber,
      observedAt: item.observedAt, finalized: Boolean(item.finalized), snapshotJson: item.snapshotJson, createdAt: Date.now() });
  }
  return { recorded: args.snapshots.length };
} });

export const updateWorkerState = mutation({ args: { runId: v.string(), tickId: v.string(), holderId: v.string(),
  status: v.string(), phase: v.string(), patchJson: v.string(), eventJson: v.optional(v.string()),
  continueAfter: v.boolean(), nextDelayMs: v.number() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findRun(ctx, args.runId); if (!row) throw new Error("Perpl run not found.");
  if (row.leaseHolder !== args.holderId || row.nextTickId !== args.tickId || row.lastTickId === args.tickId) return { accepted: false, reason: "lease_lost" };
  if (!new Set(["activation_pending", "active", "stopping", "settling", "uncertain", "incomplete_settlement", "completed", "failed"]).has(args.status)
    || args.patchJson.length > 30_000) throw new Error("Perpl worker state patch is invalid.");
  const patch = JSON.parse(args.patchJson); let nextTickId: string | undefined; let scheduledFunctionId: any;
  const repeat = args.continueAfter && !["completed", "failed"].includes(args.status);
  if (repeat) {
    nextTickId = `${row.runId}:tick:${row.tickSequence}`;
    scheduledFunctionId = await ctx.scheduler.runAfter(Math.max(1_000, Math.min(60_000, args.nextDelayMs)),
      internalApi.monadVenueActions.dispatchTick, { runId: row.runId, tickId: nextTickId });
  }
  await ctx.db.patch(row._id, { ...patch, status: args.status, phase: args.phase, lastTickId: args.tickId,
    nextTickId, scheduledFunctionId, tickSequence: repeat ? row.tickSequence + 1 : row.tickSequence,
    leaseHolder: undefined, leaseExpiresAt: undefined, completedAt: args.status === "completed" ? Date.now() : undefined, updatedAt: Date.now() });
  if (args.eventJson) await event(ctx, row, JSON.parse(args.eventJson));
  return { runId: row.runId, status: args.status, phase: args.phase, nextTickId };
} });
