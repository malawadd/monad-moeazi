import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMonadOperator } from "./monadHelpers";

async function scenario(ctx: any, scenarioId: string) {
  return await ctx.db.query("monadVenueScenarios").withIndex("by_scenarioId", (q: any) => q.eq("scenarioId", scenarioId)).first();
}
async function run(ctx: any, runId: string) {
  return await ctx.db.query("monadVenueRuns").withIndex("by_runId", (q: any) => q.eq("runId", runId)).first();
}
function dto(row: any) { return { scenarioId: row.scenarioId, runId: row.runId, venueId: row.venueId, status: row.status,
  stepIndex: row.stepIndex, total: row.total, actions: JSON.parse(row.actionsJson), errorCode: row.errorCode ?? null,
  activeOrderId: row.activeOrderId ?? null, activeRequestId: row.activeRequestId ?? null, activeActionKind: row.activeActionKind ?? null,
  lastOrderId: row.lastOrderId ?? null, lastVenueOrderId: row.lastVenueOrderId ?? null,
  lastRequestId: row.lastRequestId ?? null, lastActionKind: row.lastActionKind ?? null,
  nextAt: row.nextAt, createdAt: row.createdAt, updatedAt: row.updatedAt }; }

export const createScenario = mutation({ args: { scenarioId: v.string(), idempotencyKey: v.string(), runId: v.string(),
  actionsJson: v.string(), intervalSeconds: v.number() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await run(ctx, args.runId); let actions: any;
  try { actions = JSON.parse(args.actionsJson); } catch { throw new Error("Perpl scenario actions are invalid."); }
  if (row?.optimizerStateJson) throw new Error("Deterministic optimizer runs do not accept competing scenarios.");
  if (!row || !["perpl-testnet-v1", "perpl-direct-testnet-v1"].includes(row.venueId) || row.status !== "active" || args.actionsJson.length > 30_000
    || !Array.isArray(actions) || actions.length < 1 || actions.length > 30 || args.intervalSeconds < 15 || args.intervalSeconds > 120
    || !/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey)) throw new Error("Perpl scenario requires an active run and 1–30 valid actions.");
  const prior = await ctx.db.query("monadVenueScenarios").withIndex("by_userId_idempotencyKey", (q: any) =>
    q.eq("userId", row.userId).eq("idempotencyKey", args.idempotencyKey)).first();
  if (prior) {
    if (prior.runId !== row.runId || prior.actionsJson !== args.actionsJson) throw new Error("Perpl scenario key was reused for different actions.");
    return dto(prior);
  }
  const active = await ctx.db.query("monadVenueScenarios").withIndex("by_run_createdAt", (q: any) =>
    q.eq("runId", row.runId)).order("desc").take(30);
  if (active.some((item: any) => ["queued", "running", "cancel_pending"].includes(item.status))) {
    throw new Error("A Perpl scenario is already active for this run.");
  }
  const now = Date.now(); const id = await ctx.db.insert("monadVenueScenarios", { scenarioId: args.scenarioId, runId: row.runId,
    venueId: row.venueId, userId: row.userId, ownerAddress: row.ownerAddress, idempotencyKey: args.idempotencyKey,
    actionsJson: args.actionsJson, intervalSeconds: args.intervalSeconds, status: "queued", stepIndex: 0,
    total: actions.length, nextAt: now, createdAt: now, updatedAt: now });
  return dto(await ctx.db.get(id));
} });

export const listScenarios = query({ args: { runId: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const rows = args.runId ? await ctx.db.query("monadVenueScenarios").withIndex("by_run_createdAt", (q: any) => q.eq("runId", args.runId)).order("desc").take(50)
    : await ctx.db.query("monadVenueScenarios").order("desc").take(50);
  return rows.map(dto);
} });

export const getScenario = query({ args: { scenarioId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await scenario(ctx, args.scenarioId); return row ? dto(row) : null;
} });

export const getScenarioForRun = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const rows = await ctx.db.query("monadVenueScenarios").withIndex("by_run_createdAt", (q: any) =>
    q.eq("runId", args.runId)).order("asc").take(30);
  const row = rows.find((item: any) => ["queued", "running", "cancel_pending"].includes(item.status)); return row ? dto(row) : null;
} });

export const advanceScenario = mutation({ args: { scenarioId: v.string(), expectedStepIndex: v.number(),
  status: v.string(), errorCode: v.optional(v.string()), activeOrderId: v.optional(v.string()),
  activeRequestId: v.optional(v.number()), activeActionKind: v.optional(v.string()),
  venueOrderId: v.optional(v.number()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await scenario(ctx, args.scenarioId); if (!row) return null;
  if (!["queued", "running", "cancel_pending"].includes(row.status) || row.stepIndex !== args.expectedStepIndex) return dto(row);
  const now = Date.now();
  if (args.status === "dispatch") {
    if (row.status !== "queued" || !args.activeOrderId || !Number.isSafeInteger(args.activeRequestId)
      || !args.activeActionKind) return dto(row);
    await ctx.db.patch(row._id, { status: "running", activeOrderId: args.activeOrderId,
      activeRequestId: args.activeRequestId, activeActionKind: args.activeActionKind,
      errorCode: undefined, nextAt: now + row.intervalSeconds * 1000, updatedAt: now });
  } else if (args.status === "cancel_dispatch") {
    if (row.status !== "cancel_pending" || !args.activeOrderId || !Number.isSafeInteger(args.activeRequestId)) return dto(row);
    await ctx.db.patch(row._id, { lastOrderId: row.activeOrderId,
      lastVenueOrderId: args.venueOrderId ?? row.lastVenueOrderId, lastRequestId: row.activeRequestId ?? row.lastRequestId,
      lastActionKind: row.activeActionKind, activeOrderId: args.activeOrderId, activeRequestId: args.activeRequestId,
      activeActionKind: "scenario_cancel_order", errorCode: undefined, nextAt: now + 5_000, updatedAt: now });
  } else if (args.status === "advance") {
    if (row.status !== "running" || !row.activeOrderId) return dto(row);
    const stepIndex = Math.min(row.total, row.stepIndex + 1);
    await ctx.db.patch(row._id, { stepIndex, status: stepIndex >= row.total ? "completed" : "queued",
      lastOrderId: row.activeOrderId, lastVenueOrderId: args.venueOrderId ?? row.lastVenueOrderId,
      lastRequestId: row.activeRequestId ?? row.lastRequestId, lastActionKind: row.activeActionKind,
      activeOrderId: undefined,
      activeRequestId: undefined, activeActionKind: undefined, errorCode: undefined,
      nextAt: now + row.intervalSeconds * 1000, updatedAt: now });
  } else if (args.status === "uncertain") {
    await ctx.db.patch(row._id, { errorCode: args.errorCode ?? "perpl_scenario_action_uncertain",
      nextAt: now + 5_000, updatedAt: now });
  } else if (args.status === "blocked") {
    await ctx.db.patch(row._id, { status: "blocked", errorCode: args.errorCode ?? "perpl_scenario_action_blocked", updatedAt: now });
  } else if (args.status === "finish_cancelled") {
    await ctx.db.patch(row._id, { status: "canceled", activeOrderId: undefined,
      activeRequestId: undefined, activeActionKind: undefined, errorCode: "operator_cancelled", updatedAt: now });
  } else return dto(row);
  return dto(await ctx.db.get(row._id));
} });

export const cancelScenario = mutation({ args: { scenarioId: v.string(), reason: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await scenario(ctx, args.scenarioId); if (!row) return null;
  if (row.status === "queued" && row.lastOrderId) await ctx.db.patch(row._id, { status: "cancel_pending",
    activeOrderId: row.lastOrderId, activeRequestId: row.lastRequestId, activeActionKind: row.lastActionKind,
    errorCode: args.reason?.slice(0, 80) ?? "operator_cancelled", canceledAt: Date.now(), updatedAt: Date.now() });
  else if (row.status === "queued") await ctx.db.patch(row._id, { status: "canceled", errorCode: args.reason?.slice(0, 80), canceledAt: Date.now(), updatedAt: Date.now() });
  else if (row.status === "running") await ctx.db.patch(row._id, { status: "cancel_pending",
    errorCode: args.reason?.slice(0, 80) ?? "operator_cancelled", canceledAt: Date.now(), updatedAt: Date.now() });
  return dto(await ctx.db.get(row._id));
} });
