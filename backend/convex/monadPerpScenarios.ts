import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendMonadActivity, requireMonadOperator } from "./monadHelpers";
import { perpScenarioStepResult } from "./monadPerpScenarioRules";

const parse = (value: string) => JSON.parse(value);
async function findScenario(ctx: any, scenarioId: string) {
  return await ctx.db.query("monadPerpScenarios").withIndex("by_scenarioId", (q: any) => q.eq("scenarioId", scenarioId)).first();
}
async function findRun(ctx: any, runId: string) {
  return await ctx.db.query("monadPerpRuns").withIndex("by_runId", (q: any) => q.eq("runId", runId)).first();
}
function dto(row: any, run?: any) {
  const script = parse(row.scriptJson);
  return { scenarioId: row.scenarioId, idempotencyKey: row.idempotencyKey, runId: row.runId,
    ownerAddress: row.ownerAddress, status: row.status, stepIndex: row.stepIndex, stepsTotal: script.length,
    currentStep: script[row.stepIndex] ?? null, script, errorCode: row.errorCode ?? null,
    createdAt: row.createdAt, updatedAt: row.updatedAt, completedAt: row.completedAt ?? null,
    runStatus: run?.status ?? null, expiresAt: run?.expiresAt ?? null, vaultAddress: run?.vaultAddress ?? null };
}

export const getScenario = query({ args: { scenarioId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findScenario(ctx, args.scenarioId);
  return row ? dto(row, await findRun(ctx, row.runId)) : null;
} });

export const listScenarios = query({ args: { runId: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const rows = args.runId
    ? await ctx.db.query("monadPerpScenarios").withIndex("by_runId", (q: any) => q.eq("runId", args.runId)).order("desc").take(30)
    : await ctx.db.query("monadPerpScenarios").order("desc").take(30);
  return await Promise.all(rows.map(async (row: any) => dto(row, await findRun(ctx, row.runId))));
} });

export const getScenarioForRun = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const run = await findRun(ctx, args.runId);
  if (!run?.activeScenarioId) return null;
  const row = await findScenario(ctx, run.activeScenarioId);
  return row?.status === "running" ? { ...dto(row, run), script: parse(row.scriptJson) } : null;
} });

export const createScenario = mutation({
  args: { scenarioId: v.string(), idempotencyKey: v.string(), runId: v.string(), scriptJson: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const script = parse(args.scriptJson);
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey) || !/^[-A-Za-z0-9]{8,100}$/.test(args.scenarioId)
        || !Array.isArray(script) || script.length < 1 || script.length > 60 || args.scriptJson.length > 40_000) {
      throw new Error("Perp scenario metadata is invalid or too large.");
    }
    const prior = await ctx.db.query("monadPerpScenarios").withIndex("by_idempotencyKey", (q: any) =>
      q.eq("idempotencyKey", args.idempotencyKey)).first();
    if (prior) {
      if (prior.runId !== args.runId || prior.scriptJson !== args.scriptJson) throw new Error("Perp scenario key was reused for different terms.");
      return dto(prior, await findRun(ctx, prior.runId));
    }
    const run = await findRun(ctx, args.runId);
    if (!run || !["active", "uncertain"].includes(run.status)) throw new Error("Perp scenario requires an active enrolled run.");
    if (run.activeScenarioId) {
      const active = await findScenario(ctx, run.activeScenarioId);
      if (active?.status === "running") throw new Error("This perp run already has an active operator scenario.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("monadPerpScenarios", { ...args, ownerAddress: run.ownerAddress,
      status: "running", stepIndex: 0, createdAt: now, updatedAt: now });
    await ctx.db.patch(run._id, { activeScenarioId: args.scenarioId, updatedAt: now });
    const row = await ctx.db.get(id);
    await event(ctx, run, args.scenarioId, "started", "perp_scenario_started", "running", "Operator perp scenario started", { stepsTotal: script.length });
    return dto(row, { ...run, activeScenarioId: args.scenarioId });
  },
});

export const cancelScenario = mutation({ args: { scenarioId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await findScenario(ctx, args.scenarioId);
  if (!row) return null;
  if (row.status !== "running") return dto(row, await findRun(ctx, row.runId));
  const run = await findRun(ctx, row.runId); const now = Date.now();
  await ctx.db.patch(row._id, { status: "cancelled", completedAt: now, updatedAt: now });
  if (run?.activeScenarioId === row.scenarioId) await ctx.db.patch(run._id, { activeScenarioId: undefined, updatedAt: now });
  await event(ctx, run, row.scenarioId, "cancelled", "perp_scenario_cancelled", "cancelled", "Operator scenario cancelled; autonomous rule resumes");
  return dto({ ...row, status: "cancelled", completedAt: now }, run ? { ...run, activeScenarioId: undefined } : undefined);
} });

export async function progressScenario(ctx: any, run: any, events: any[], runStatus: string) {
  if (!run.activeScenarioId) return;
  const row = await findScenario(ctx, run.activeScenarioId);
  if (!row || row.status !== "running") return;
  const now = Date.now();
  if (["completed", "expired", "liquidated"].includes(runStatus)) {
    await ctx.db.patch(row._id, { status: runStatus === "completed" ? "owner_stopped" : runStatus, completedAt: now, updatedAt: now });
    await ctx.db.patch(run._id, { activeScenarioId: undefined, updatedAt: now });
    await event(ctx, run, row.scenarioId, `run-${runStatus}`, `perp_scenario_${runStatus}`, runStatus,
      `Perp run ended while the scenario was active`, { runStatus });
    return;
  }
  const stepResult = perpScenarioStepResult(events, row.scenarioId, row.stepIndex);
  if (stepResult === "blocked") {
    const blocked = events.find((item) => (item.scenarioId === row.scenarioId || item.payload?.scenarioId === row.scenarioId)
      && Number(item.scenarioStep ?? item.payload?.scenarioStep) === row.stepIndex
      && (item.type === "perp_action_blocked" || item.type === "perp_order_failed" || item.status === "blocked"
        || Number(item.payload?.receiptStatus) === 0));
    const code = String(blocked?.payload?.reasonCode ?? blocked?.summary ?? "scenario_action_failed");
    await ctx.db.patch(row._id, { status: "blocked", errorCode: code, completedAt: now, updatedAt: now });
    await ctx.db.patch(run._id, { activeScenarioId: undefined, updatedAt: now });
    return;
  }
  if (stepResult !== "complete") return;
  const next = row.stepIndex + 1; const script = parse(row.scriptJson); const done = next >= script.length;
  await ctx.db.patch(row._id, { status: done ? "completed" : "running", stepIndex: next,
    ...(done ? { completedAt: now } : {}), updatedAt: now });
  if (done) {
    await ctx.db.patch(run._id, { activeScenarioId: undefined, updatedAt: now });
    await event(ctx, run, row.scenarioId, "completed", "perp_scenario_completed", "completed", "All operator scenario steps completed");
  }
}

async function event(ctx: any, run: any, scenarioId: string, id: string, type: string, status: string, summary: string, payload?: any) {
  if (!run) return;
  const eventId = `perp:${run.runId}:scenario:${scenarioId}:${id}`;
  const prior = await ctx.db.query("monadPerpEvents").withIndex("by_eventId", (q: any) => q.eq("eventId", eventId)).first();
  if (prior) return;
  const timestamp = Date.now(); const payloadJson = payload ? JSON.stringify({ scenarioId, ...payload }).slice(0, 20_000) : undefined;
  await ctx.db.insert("monadPerpEvents", { runId: run.runId, ownerAddress: run.ownerAddress, eventId,
    timestamp, type, status, summary, ...(payloadJson ? { payloadJson } : {}) });
  await appendMonadActivity(ctx, { userId: run.userId, ownerAddress: run.ownerAddress, activityId: eventId,
    kind: type, status, summary, dataJson: payloadJson ?? JSON.stringify({ runId: run.runId, scenarioId }) });
}
