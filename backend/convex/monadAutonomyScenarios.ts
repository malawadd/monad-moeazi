import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireMonadOperator } from "./monadHelpers";

const internalApi: any = internal;
const terminal = ["completed", "blocked", "cancelled"];
async function findScenario(ctx: any, scenarioId: string) {
  return await ctx.db.query("monadAutonomyScenarios")
    .withIndex("by_scenarioId", (q: any) => q.eq("scenarioId", scenarioId)).first();
}
async function dto(ctx: any, row: any) {
  const events = await ctx.db.query("monadAutonomyScenarioEvents")
    .withIndex("by_scenario_timestamp", (q: any) => q.eq("scenarioId", row.scenarioId)).order("desc").take(50);
  return { scenarioId: row.scenarioId, direction: row.direction, tokenIndex: row.tokenIndex,
    status: row.status, stepsCompleted: row.stepIndex, stepsTotal: row.stepCount,
    intervalSeconds: row.intervalSeconds, swapAmountUnits: row.swapAmountUnits,
    nextTickAt: row.nextTickAt ?? null, lastTransactionHash: row.lastTxHash ?? null,
    lastBlockNumber: row.lastBlockNumber ?? null, errorCode: row.errorCode ?? null,
    events: events.reverse().map((event: any) => ({ type: event.type, status: event.status,
      timestamp: new Date(event.timestamp).toISOString(), transactionHash: event.transactionHash ?? null,
      blockNumber: event.blockNumber === undefined ? null : String(event.blockNumber),
      inputAmountUnits: event.inputAmountUnits ?? null, outputAmountUnits: event.outputAmountUnits ?? null,
      priceBeforeWad: event.priceBeforeWad ?? null, priceAfterWad: event.priceAfterWad ?? null,
      summary: event.summary })) };
}

export const getScenario = query({ args: { scenarioId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findScenario(ctx, args.scenarioId);
  return row ? await dto(ctx, row) : null;
} });

export const getScenarioByKey = query({ args: { idempotencyKey: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const row = await ctx.db.query("monadAutonomyScenarios")
    .withIndex("by_idempotencyKey", (q: any) => q.eq("idempotencyKey", args.idempotencyKey)).first();
  return row ? await dto(ctx, row) : null;
} });

export const createScenario = mutation({
  args: { scenarioId: v.string(), idempotencyKey: v.string(), tokenIndex: v.number(), poolAddress: v.string(),
    tokenAddress: v.string(), direction: v.union(v.literal("rising"), v.literal("flat"), v.literal("falling")),
    stepCount: v.number(), intervalSeconds: v.number(), swapAmountUnits: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey) || args.tokenIndex < 0 || args.tokenIndex > 2
        || args.stepCount < 1 || args.stepCount > 40 || args.direction === "flat" && args.stepCount % 2 !== 0
        || args.intervalSeconds < 15 || args.intervalSeconds > 120 || !/^\d+$/.test(args.swapAmountUnits)) {
      throw new Error("Monad autonomy scenario terms are invalid.");
    }
    const prior = await ctx.db.query("monadAutonomyScenarios")
      .withIndex("by_idempotencyKey", (q: any) => q.eq("idempotencyKey", args.idempotencyKey)).first();
    if (prior) {
      if (prior.tokenIndex !== args.tokenIndex || prior.direction !== args.direction || prior.stepCount !== args.stepCount
          || prior.intervalSeconds !== args.intervalSeconds || prior.swapAmountUnits !== args.swapAmountUnits) {
        throw new Error("Scenario idempotency key was reused for different terms.");
      }
      return await dto(ctx, prior);
    }
    const tickId = `${args.scenarioId}:tick:0`; const now = Date.now();
    const scheduledFunctionId: any = await ctx.scheduler.runAfter(0, internalApi.monadAutonomyActions.dispatchScenarioTick,
      { scenarioId: args.scenarioId, tickId });
    const id: any = await ctx.db.insert("monadAutonomyScenarios", { ...args, scenarioId: args.scenarioId,
      status: "running", stepIndex: 0, nextTickId: tickId, scheduledFunctionId,
      nextTickAt: now, createdAt: now, updatedAt: now });
    const row: any = await ctx.db.get(id);
    await addEvents(ctx, args.scenarioId, [{ eventId: `${args.scenarioId}:started`, type: "scenario_started",
      status: "running", summary: `${args.direction} scenario submitted to the funded test AMM`, timestamp: now }]);
    return await dto(ctx, row);
  },
});

export const claimScenarioTick = mutation({
  args: { scenarioId: v.string(), tickId: v.string(), holderId: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx); const row = await findScenario(ctx, args.scenarioId);
    if (!row || terminal.includes(row.status) || row.nextTickId !== args.tickId || row.lastTickId === args.tickId) return { claimed: false, reason: "stale_or_terminal" };
    const now = Date.now();
    if (row.leaseHolder && row.leaseExpiresAt > now) {
      await ctx.scheduler.runAfter(row.leaseExpiresAt - now + 1000,
        internalApi.monadAutonomyActions.dispatchScenarioTick, { scenarioId: row.scenarioId, tickId: args.tickId });
      return { claimed: false, reason: "leased" };
    }
    await ctx.db.patch(row._id, { leaseHolder: args.holderId, leaseExpiresAt: now + 60_000, updatedAt: now });
    return { claimed: true, row };
  },
});

export const completeScenarioStep = mutation({
  args: { scenarioId: v.string(), tickId: v.string(), holderId: v.string(), stepCompleted: v.boolean(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("blocked")),
    event: v.optional(v.any()), flatTokenAmountUnits: v.union(v.string(), v.null()),
    lastTxHash: v.union(v.string(), v.null()), lastBlockNumber: v.union(v.number(), v.null()),
    errorCode: v.union(v.string(), v.null()), nextDelayMs: v.number() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx); const row = await findScenario(ctx, args.scenarioId);
    if (!row || row.leaseHolder !== args.holderId || row.nextTickId !== args.tickId) return { accepted: false };
    if (args.event) await addEvents(ctx, row.scenarioId, [args.event]);
    const nextStep = row.stepIndex + (args.stepCompleted ? 1 : 0);
    const done = args.status === "running" && nextStep >= row.stepCount;
    const status = done ? "completed" : args.status;
    const repeat = status === "running";
    const nextTickId = repeat ? `${row.scenarioId}:tick:${nextStep}` : undefined;
    const due = Date.now() + Math.max(1000, Math.min(120_000, args.nextDelayMs));
    const scheduledFunctionId = repeat ? await ctx.scheduler.runAfter(due - Date.now(),
      internalApi.monadAutonomyActions.dispatchScenarioTick, { scenarioId: row.scenarioId, tickId: nextTickId! }) : undefined;
    await ctx.db.patch(row._id, { status, stepIndex: nextStep, flatTokenAmountUnits: args.flatTokenAmountUnits ?? undefined,
      nextTickId, nextTickAt: repeat ? due : undefined, scheduledFunctionId,
      lastTickId: args.stepCompleted ? args.tickId : row.lastTickId,
      lastTxHash: args.lastTxHash ?? undefined, lastBlockNumber: args.lastBlockNumber ?? undefined,
      errorCode: args.errorCode ?? undefined, leaseHolder: undefined, leaseExpiresAt: undefined,
      completedAt: repeat ? undefined : Date.now(), updatedAt: Date.now() });
    return { accepted: true, status, stepsCompleted: nextStep, stepsTotal: row.stepCount, nextTickId };
  },
});

async function addEvents(ctx: any, scenarioId: string, events: any[]) {
  for (const event of events) {
    const prior = await ctx.db.query("monadAutonomyScenarioEvents")
      .withIndex("by_eventId", (q: any) => q.eq("eventId", event.eventId)).first();
    if (prior) continue;
    await ctx.db.insert("monadAutonomyScenarioEvents", { scenarioId, eventId: event.eventId,
      type: String(event.type), status: String(event.status), timestamp: event.timestamp ?? Date.now(),
      summary: String(event.summary ?? event.type).slice(0, 240), ...(event.transactionHash ? { transactionHash: event.transactionHash } : {}),
      ...(event.blockNumber !== undefined ? { blockNumber: event.blockNumber } : {}),
      ...(event.inputAmountUnits ? { inputAmountUnits: event.inputAmountUnits } : {}),
      ...(event.outputAmountUnits ? { outputAmountUnits: event.outputAmountUnits } : {}),
      ...(event.priceBeforeWad ? { priceBeforeWad: event.priceBeforeWad } : {}),
      ...(event.priceAfterWad ? { priceAfterWad: event.priceAfterWad } : {}) });
  }
}
