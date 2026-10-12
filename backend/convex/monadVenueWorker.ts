import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendMonadActivity, requireMonadOperator } from "./monadHelpers";
import { venueDispatchTickArgs, venueWatchdogDecision } from "./monadVenueWatchdogRules";

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

export const pauseEntries = mutation({ args: { runId: v.string(), reason: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findRun(ctx, args.runId);
  if (!row || row.venueId !== "perpl-direct-testnet-v1" || !row.optimizerStateJson
    || !["active", "stopping", "settling", "uncertain", "incomplete_settlement"].includes(row.status)
    || !/^[a-z][a-z0-9_]{3,63}$/.test(args.reason)) throw new Error("Perpl optimizer entry pause is invalid.");
  if (row.entryPausedAt) return { paused: true, alreadyPaused: true };
  await ctx.db.patch(row._id, { entryPausedAt: Date.now(), entryPauseReason: args.reason });
  await event(ctx, row, { eventId: "entries_paused", kind: "perpl_optimizer_safety",
    status: "paused", summary: "New autonomous entries paused after a worker safety incident; exits and settlement remain enabled." });
  return { paused: true, alreadyPaused: false };
} });

export const claimTick = mutation({ args: { runId: v.string(), tickId: v.string(), holderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findRun(ctx, args.runId); const now = Date.now();
  if (!row || row.nextTickId !== args.tickId || row.lastTickId === args.tickId) return { claimed: false, reason: "stale" };
  if (row.leaseExpiresAt && row.leaseExpiresAt > now) {
    const scheduledFunctionId = await ctx.scheduler.runAfter(Math.max(1_000, row.leaseExpiresAt - now), internal.monadVenueActions.dispatchTick,
      venueDispatchTickArgs(args));
    await ctx.db.patch(row._id, { scheduledFunctionId, nextTickDueAt: row.leaseExpiresAt });
    return { claimed: false, reason: "leased" };
  }
  await ctx.db.patch(row._id, { leaseHolder: args.holderId, leaseExpiresAt: now + 45_000, updatedAt: now });
  return { claimed: true, row };
} });

export const scheduleRetry = internalMutation({ args: { runId: v.string(), tickId: v.string(), delayMs: v.number(),
  reason: v.optional(v.string()) }, handler: async (ctx, args) => {
  const row = await findRun(ctx, args.runId); if (!row || row.nextTickId !== args.tickId) return false;
  const delay = Math.max(1_000, Math.min(60_000, args.delayMs));
  const scheduledFunctionId = await ctx.scheduler.runAfter(delay, internal.monadVenueActions.dispatchTick,
    venueDispatchTickArgs(args));
  await ctx.db.patch(row._id, { scheduledFunctionId, nextTickDueAt: Date.now() + delay,
    lastWorkerError: args.reason?.slice(0, 180) ?? row.lastWorkerError,
    lastWorkerErrorAt: args.reason ? Date.now() : row.lastWorkerErrorAt,
    consecutiveWorkerFailures: (row.consecutiveWorkerFailures ?? 0) + 1 });
  return true;
} });

export const watchdogRuns = internalMutation({ args: {}, handler: async (ctx) => {
  const now = Date.now(); let inspected = 0; let retried = 0; let paused = 0;
  for (const venueId of ["perpl-direct-testnet-v1", "perpl-testnet-v1"]) {
    for (const status of ["activation_pending", "active", "stopping", "settling", "uncertain", "incomplete_settlement"]) {
      const rows = await ctx.db.query("monadVenueRuns").withIndex("by_venue_status_createdAt", (q: any) =>
        q.eq("venueId", venueId).eq("status", status)).order("desc").take(100);
      for (const row of rows) {
        inspected += 1;
        const decision = venueWatchdogDecision(row, now);
        if (!decision.requeue && !decision.pauseEntries) continue;
        const patch: Record<string, unknown> = {};
        if (decision.pauseEntries) {
          patch.entryPausedAt = now; patch.entryPauseReason = "worker_tick_overdue"; paused += 1;
          await event(ctx, row, { eventId: `watchdog_pause:${row.nextTickId}`, kind: "perpl_optimizer_safety",
            status: "paused", summary: "New autonomous entries paused because worker checks stopped; exits and settlement remain enabled." });
        }
        if (decision.requeue) {
          patch.scheduledFunctionId = await ctx.scheduler.runAfter(0, internal.monadVenueActions.dispatchTick,
            venueDispatchTickArgs({ runId: row.runId, tickId: row.nextTickId! }));
          patch.nextTickDueAt = now; patch.watchdogLastRetryAt = now;
          patch.watchdogRetryCount = (row.watchdogRetryCount ?? 0) + 1; retried += 1;
          await event(ctx, row, { eventId: `watchdog_retry:${row.nextTickId}`, kind: "perpl_worker_recovery",
            status: "retrying", summary: "A stalled Perpl worker tick is being retried with its original tick ID." });
        }
        await ctx.db.patch(row._id, patch);
      }
    }
  }
  return { inspected, retried, paused };
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
      internal.monadVenueActions.dispatchTick, venueDispatchTickArgs({ runId: row.runId, tickId: nextTickId }));
  }
  const now = Date.now();
  await ctx.db.patch(row._id, { ...patch, status: args.status, phase: args.phase, lastTickId: args.tickId,
    nextTickId, scheduledFunctionId, tickSequence: repeat ? row.tickSequence + 1 : row.tickSequence,
    leaseHolder: undefined, leaseExpiresAt: undefined, completedAt: args.status === "completed" ? now : undefined,
    lastSuccessfulTickAt: now, nextTickDueAt: repeat ? now + Math.max(1_000, Math.min(60_000, args.nextDelayMs)) : undefined,
    lastWorkerError: undefined, lastWorkerErrorAt: undefined, consecutiveWorkerFailures: 0, updatedAt: now });
  if (args.eventJson) await event(ctx, row, JSON.parse(args.eventJson));
  return { runId: row.runId, status: args.status, phase: args.phase, nextTickId };
} });
