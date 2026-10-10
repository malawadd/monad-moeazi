import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { appendMonadActivity, requireMeraViewer, requireMonadOperator } from "./monadHelpers";
import { sumPerplOptimizerFundingUnits } from "./monadVenueAccounting";

const VERSION = "perpl-deterministic-v3-soak";
const LEGACY_VERSION = "perpl-deterministic-v2";
const MAX_CYCLES = 15;
const MIN_WIN = 10_000n;
const MAX_MOMENTUM = 70;
const MAX_CONSERVATISM = 15_000;
const ACTIVE_RUN_STATUSES = ["prepared", "activation_pending", "active", "stopping", "settling", "uncertain", "incomplete_settlement"];
async function runFor(ctx: any, runId: string) {
  return await ctx.db.query("monadVenueRuns").withIndex("by_runId", (q: any) => q.eq("runId", runId)).first();
}
function parse(raw?: string) { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }
export function reportedOptimizerState(row: any, state: any) {
  if (row.status !== "completed" || state?.version !== VERSION
    || !["running", "cycle_cap_reached_awaiting_settlement"].includes(state.status)) return state;
  return { ...state, status: "settled",
    ...(state.status === "cycle_cap_reached_awaiting_settlement" ? { completionReason: "cycle_cap_reached" } : {}) };
}
export function optimizerReportEventGroups(scannerEvents: any[], decisionEvents: any[]) {
  const toReport = (item: any) => ({ timestamp: item.timestamp, phase: item.status, details: parse(item.dataJson) });
  return {
    recentScans: scannerEvents.slice(0, 24).map(toReport),
    recentDecisions: decisionEvents.filter((item: any) => item.status !== "optimizer_market_scan_not_due")
      .slice(0, 24).map(toReport),
  };
}
export function directOptimizerRunIndexEntry(row: any) {
  const state = reportedOptimizerState(row, parse(row.optimizerStateJson));
  return { runId: row.runId, status: row.status, phase: row.phase ?? row.status, ownerAddress: row.ownerAddress,
    createdAt: row.createdAt, updatedAt: row.updatedAt, startedAt: row.activatedAt ?? null, expiresAt: row.expiresAt ?? null,
    optimizer: state ? { version: state.version, profile: state.version === VERSION ? "duration_soak" : "two_win_target",
      stopCondition: state.version === VERSION ? "run_expiry_or_cycle_cap" : "two_wins_or_cycle_cap",
      status: state.status ?? "unknown", cycles: Number(state.cycles ?? 0),
      winStreak: Number(state.winStreak ?? 0), positiveCycles: Number(state.positiveCycles ?? 0),
      ...(state.completionReason ? { completionReason: state.completionReason } : {}),
      targetWinStreak: state.version === VERSION ? null : 2, cycleLimit: MAX_CYCLES } : null };
}
function signedAUSD(raw: string) {
  const amount = BigInt(raw); const abs = amount < 0n ? -amount : amount;
  return `${amount > 0n ? "+" : amount < 0n ? "−" : ""}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0")} AUSD`;
}
function validState(state: any) { return [VERSION, LEGACY_VERSION].includes(state?.version) && Number.isSafeInteger(state.cycles) && state.cycles >= 0
  && state.cycles <= MAX_CYCLES && Number.isSafeInteger(state.winStreak) && state.params
  && (state.version !== VERSION || state.status !== "target_reached_awaiting_settlement")
  && Number.isSafeInteger(state.params.momentumThresholdBps) && state.params.momentumThresholdBps >= 40
  && state.params.momentumThresholdBps <= MAX_MOMENTUM && Number.isSafeInteger(state.params.executionConservatismBps)
  && state.params.executionConservatismBps >= 10_000 && state.params.executionConservatismBps <= MAX_CONSERVATISM; }
export function duplicateCycleResult(prior: any, state: any, row: any) {
  return { duplicate: true, cycleNumber: prior.cycleNumber, realizedPnlUnits: prior.realizedPnlUnits,
    winStreak: state?.winStreak ?? 0, optimizerStatus: state?.status ?? "running",
    params: state?.params ?? { momentumThresholdBps: 40, executionConservatismBps: 10_000 },
    cumulativePnlUnits: row.realizedPnlUnits ?? prior.realizedPnlUnits };
}
export function optimizerCycleStatus(cycleCount: number, winStreak: number, version = LEGACY_VERSION) {
  if (version === VERSION) return cycleCount >= MAX_CYCLES ? "cycle_cap_reached_awaiting_settlement" : "running";
  return winStreak >= 2 ? "target_reached_awaiting_settlement"
    : cycleCount >= MAX_CYCLES ? "cycle_cap_reached_awaiting_settlement" : "running";
}

export const writeState = mutation({ args: { runId: v.string(), stateJson: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await runFor(ctx, args.runId); const state = parse(args.stateJson);
  if (!row || row.venueId !== "perpl-direct-testnet-v1" || args.stateJson.length > 30_000 || !validState(state)) throw new Error("Perpl optimizer state is invalid.");
  const prior = parse(row.optimizerStateJson);
  if (row.optimizerStateJson && (!validState(prior) || prior.version !== state.version)) throw new Error("Stored optimizer profile is invalid or cannot be changed.");
  await ctx.db.patch(row._id, { optimizerStateJson: args.stateJson, updatedAt: Date.now() });
  return { runId: row.runId, version: state.version, cycles: state.cycles };
} });

export const recordScannerScan = mutation({ args: { runId: v.string(), tickId: v.string(), recordJson: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx); const row = await runFor(ctx, args.runId);
    const record = parse(args.recordJson); const eventId = `${row?.venueId}:${args.runId}:scanner:${args.tickId}`;
    if (!row || row.venueId !== "perpl-direct-testnet-v1" || args.recordJson.length > 20_000
      || !record || !Number.isSafeInteger(record.scannedAt) || !["proposed", "deferred_position_open", "no_proposal"].includes(record.status)) {
      throw new Error("Perpl scanner record is invalid.");
    }
    if (await ctx.db.query("monadVenueEvents").withIndex("by_eventId", (q: any) => q.eq("eventId", eventId)).first()) {
      return { duplicate: true };
    }
    const proposed = Boolean(record.proposal); const audit = record.audit;
    const summary = proposed
      ? `Scanner proposed ${record.proposal.marketId} ${record.proposal.side}; ${record.status === "deferred_position_open" ? "deferred while the current position is open" : "eligible for policy-checked entry"}.`
      : audit ? `Scanner found no eligible trade in ${record.consecutiveNoProposal} consecutive scans; investigate market data, signal rejections and scanner behavior.`
        : "Scanner found no eligible trade under the reviewed filters.";
    await ctx.db.insert("monadVenueEvents", { eventId, runId: row.runId, venueId: row.venueId,
      userId: row.userId, ownerAddress: row.ownerAddress, kind: "perpl_optimizer_scanner",
      status: record.status, summary, timestamp: record.scannedAt, dataJson: args.recordJson });
    if (proposed || audit?.consecutiveNoProposal === 3) await appendMonadActivity(ctx, {
      userId: row.userId, ownerAddress: row.ownerAddress, activityId: eventId,
      kind: "perpl_optimizer_scanner", status: record.status, summary, venueId: row.venueId,
      dataJson: args.recordJson });
    return { duplicate: false };
  } });

export const completeCycle = mutation({ args: { runId: v.string(), cycleId: v.string(), cycleJson: v.string(), classification: v.union(
  v.literal("execution_costs"), v.literal("trend_reversal_or_stall"), v.literal("small_or_zero")) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await runFor(ctx, args.runId); if (!row || row.venueId !== "perpl-direct-testnet-v1") throw new Error("Direct optimizer run was not found.");
  const prior = await ctx.db.query("monadVenueOptimizerCycles").withIndex("by_cycleId", (q: any) => q.eq("cycleId", args.cycleId)).first();
  if (prior) {
    return duplicateCycleResult(prior, parse(row.optimizerStateJson), row);
  }
  const state = parse(row.optimizerStateJson); const cycle = parse(args.cycleJson);
  if (!validState(state) || !state.activeCycle || state.activeCycle.cycleId !== args.cycleId || !cycle
    || cycle.cycleId !== args.cycleId || cycle.exitFinalized !== true || cycle.exitFillCount < 1
    || !/^\d+$/.test(String(cycle.startingBalanceUnits)) || !/^\d+$/.test(String(cycle.endingBalanceUnits))
    || cycle.endingFlat !== true || !Array.isArray(cycle.orderReceipts) || cycle.orderReceipts.length < 2 || args.cycleJson.length > 30_000) {
    throw new Error("Perpl optimizer cycle is not fully finalized and flat.");
  }
  const pnl = BigInt(cycle.endingBalanceUnits) - BigInt(cycle.startingBalanceUnits);
  const cycleNumber = state.cycles + 1; if (cycleNumber > MAX_CYCLES) throw new Error("Perpl optimizer cycle limit is reached.");
  const before = { ...state.params }; const after = { ...before }; let changed: string | null = null;
  if (pnl < 0n && args.classification === "execution_costs" && after.executionConservatismBps < MAX_CONSERVATISM) {
    after.executionConservatismBps = Math.min(MAX_CONSERVATISM, after.executionConservatismBps + 1_000); changed = "executionConservatismBps";
  } else if (pnl < 0n && args.classification === "trend_reversal_or_stall" && after.momentumThresholdBps < MAX_MOMENTUM) {
    after.momentumThresholdBps = Math.min(MAX_MOMENTUM, after.momentumThresholdBps + 10); changed = "momentumThresholdBps";
  }
  const winStreak = pnl >= MIN_WIN ? state.winStreak + 1 : 0;
  const status = optimizerCycleStatus(cycleNumber, winStreak, state.version);
  const completedAt = Number(cycle.completedAt ?? Date.now()); const realizedPnlUnits = pnl.toString();
  const priorCycles = await ctx.db.query("monadVenueOptimizerCycles").withIndex("by_run_createdAt", (q: any) => q.eq("runId", row.runId)).take(MAX_CYCLES);
  const cumulativePnlUnits = (priorCycles.reduce((sum: bigint, item: any) => sum + BigInt(item.realizedPnlUnits), 0n) + pnl).toString();
  const priorFundingUnits = sumPerplOptimizerFundingUnits(priorCycles, row.fundingUnits ?? "0");
  const cumulativeFundingUnits = (BigInt(priorFundingUnits) + BigInt(String(cycle.fundingUnits ?? "0"))).toString();
  const updatedCycle = { ...cycle, cycleNumber, realizedPnlUnits, positiveAtTarget: pnl >= MIN_WIN,
    winStreak, paramsBefore: before, paramsAfter: after, adaptation: { classification: args.classification, changed } };
  const nextState = { ...state, cycles: cycleNumber, winStreak, positiveCycles: state.positiveCycles + (pnl >= MIN_WIN ? 1 : 0),
    params: after, status, activeCycle: null, lastCycle: { cycleId: args.cycleId, cycleNumber, realizedPnlUnits,
      cumulativePnlUnits, completedAt, winStreak } };
  const journalId = `${row.runId}:cycle:${cycleNumber}`;
  const journal = { journalId, cycleId: args.cycleId, cycleNumber, timestamp: completedAt,
    hypothesis: "A five-minute move with aligned fifteen-minute trend and executable depth can cover round-trip costs.",
    classification: args.classification, paramsBefore: before, paramsAfter: after, changed,
    workedOrFailed: pnl >= MIN_WIN ? "cycle met the one-cent net AUSD positive-cycle threshold" : pnl < 0n ? "cycle closed at a net loss" : "cycle closed below the positive-cycle threshold",
    realizedPnlUnits, feesUnits: String(cycle.feesUnits ?? "0"), fundingUnits: String(cycle.fundingUnits ?? "0"),
    operatorGasWei: String(cycle.operatorGasWei ?? "0"), receipts: cycle.orderReceipts,
    nextChange: changed ? `${changed} adjusted before cycle ${cycleNumber + 1}` : "parameters remain unchanged for the next cycle" };
  const now = Date.now();
  const pnlLabel = signedAUSD(realizedPnlUnits); const totalLabel = signedAUSD(cumulativePnlUnits);
  const outcomeLabel = status === "target_reached_awaiting_settlement" ? "Target reached, awaiting settlement"
    : status === "cycle_cap_reached_awaiting_settlement" ? "Cycle cap reached, awaiting settlement"
    : state.version === VERSION ? `Soak continues; positive-cycle streak ${winStreak}` : `Win streak ${winStreak}/2`;
  await ctx.db.insert("monadVenueOptimizerCycles", { runId: row.runId, venueId: row.venueId, ownerAddress: row.ownerAddress,
    cycleId: args.cycleId, cycleNumber, realizedPnlUnits, cycleJson: JSON.stringify(updatedCycle), createdAt: now });
  await ctx.db.insert("monadVenueOptimizerJournal", { runId: row.runId, venueId: row.venueId, ownerAddress: row.ownerAddress,
    journalId, cycleNumber, entryJson: JSON.stringify(journal), createdAt: now });
  await ctx.db.patch(row._id, { optimizerStateJson: JSON.stringify(nextState), phase: status === "running" ? "optimizer_cycle_completed" : status,
    realizedPnlUnits: cumulativePnlUnits, fundingUnits: cumulativeFundingUnits, updatedAt: now });
  const eventId = `${row.venueId}:${row.runId}:${args.cycleId}:completed`;
  await ctx.db.insert("monadVenueEvents", { eventId, runId: row.runId, venueId: row.venueId, userId: row.userId,
    ownerAddress: row.ownerAddress, kind: "perpl_optimizer_cycle_completed",
    status: status === "target_reached_awaiting_settlement" ? "target_reached"
      : status === "cycle_cap_reached_awaiting_settlement" ? "cycle_cap_reached" : "completed",
    summary: `Perpl cycle ${cycleNumber}/${MAX_CYCLES} finalized: ${pnlLabel}; cumulative ${totalLabel}; ${outcomeLabel}.`, timestamp: completedAt,
    dataJson: JSON.stringify({ ...journal, optimizerStatus: status }) });
  await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: row.ownerAddress, activityId: eventId,
    kind: "perpl_optimizer_cycle_completed", status: status === "target_reached_awaiting_settlement" ? "target_reached"
      : status === "cycle_cap_reached_awaiting_settlement" ? "cycle_cap_reached" : "completed",
    summary: `Perpl cycle ${cycleNumber}/${MAX_CYCLES} finalized: ${pnlLabel}; cumulative ${totalLabel}; ${outcomeLabel}.`, venueId: row.venueId,
    dataJson: JSON.stringify({ ...journal, optimizerStatus: status }) });
  return { duplicate: false, cycleNumber, realizedPnlUnits, cumulativePnlUnits, winStreak, optimizerStatus: status, params: after };
} });

export const getOperatorReport = query({ args: { runId: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const row = args.runId ? await runFor(ctx, args.runId)
    : (await ctx.db.query("monadVenueRuns").withIndex("by_venue_createdAt", (q: any) => q.eq("venueId", "perpl-direct-testnet-v1"))
      .order("desc").take(100)).find((item: any) => item.optimizerStateJson);
  if (!row || row.venueId !== "perpl-direct-testnet-v1" || !row.optimizerStateJson) return null;
  const state = reportedOptimizerState(row, parse(row.optimizerStateJson)); const orders = await ctx.db.query("monadVenueOrders")
    .withIndex("by_runId_createdAt", (q: any) => q.eq("runId", row.runId)).order("desc").take(50);
  const cycles = await ctx.db.query("monadVenueOptimizerCycles").withIndex("by_run_createdAt", (q: any) => q.eq("runId", row.runId))
    .order("desc").take(MAX_CYCLES);
  const journal = await ctx.db.query("monadVenueOptimizerJournal").withIndex("by_run_createdAt", (q: any) => q.eq("runId", row.runId))
    .order("desc").take(MAX_CYCLES);
  const [scannerEvents, decisionEvents] = await Promise.all([
    ctx.db.query("monadVenueEvents").withIndex("by_run_kind_timestamp", (q: any) =>
      q.eq("runId", row.runId).eq("kind", "perpl_optimizer_scanner")).order("desc").take(24),
    ctx.db.query("monadVenueEvents").withIndex("by_run_kind_timestamp", (q: any) =>
      q.eq("runId", row.runId).eq("kind", "perpl_direct_optimizer")).order("desc").take(240),
  ]);
  const { recentScans, recentDecisions } = optimizerReportEventGroups(scannerEvents, decisionEvents);
  const cumulativeFundingUnits = sumPerplOptimizerFundingUnits(cycles, row.fundingUnits ?? "0");
  const positions = parse(row.positionsJson) ?? []; const open = orders.filter((item: any) =>
    ["prepared", "submitted", "executed", "uncertain", "filled", "partially_filled"].includes(item.status));
  return { runId: row.runId, runStatus: row.status, phase: row.phase, approvedAmountUnits: row.amountUnits,
    runDurationSeconds: row.durationSeconds, runStartedAt: row.activatedAt ?? null, expiresAt: row.expiresAt ?? null,
    exposureCapUnits: row.maxPositionExposureUnits, mandateMaxLeverage: row.maxLeverage,
    cumulativePnlUnits: row.realizedPnlUnits ?? "0", feesUnits: row.feesUnits ?? "0", fundingUnits: cumulativeFundingUnits,
    returnedUnits: row.returnedUnits ?? null, settlement: parse(row.settlementJson),
    optimizer: state ? {
      version: state.version, profile: state.version === VERSION ? "duration_soak" : "two_win_target",
      stopCondition: state.version === VERSION ? "run_expiry_or_cycle_cap" : "two_wins_or_cycle_cap",
      status: state.status, cycles: state.cycles, cycleLimit: MAX_CYCLES,
      winStreak: state.winStreak, targetWinStreak: state.version === VERSION ? null : 2,
      ...(state.completionReason ? { completionReason: state.completionReason } : {}),
      positiveCycles: state.positiveCycles, params: state.params,
      activeCycle: state.activeCycle ?? null, lastCycle: state.lastCycle ?? null,
      scanner: state.scanner ?? null } : null,
    activePositions: positions.map((item: any) => ({ marketId: Number(item.mkt), side: Number(item.sd) === 2 ? "short" : "long",
      size: item.s, entryPrice: item.ep, fundingPnlUnits: item.fundingPnlUnits, unrealizedPnlUnits: item.pnlUnits })),
    pendingOrders: open.map((item: any) => ({ orderId: item.orderId, requestId: item.requestId, kind: item.kind,
      status: item.status, txHash: item.txHash, blockNumber: item.blockNumber })),
    cycles: cycles.reverse().map((item: any) => parse(item.cycleJson)), journal: journal.reverse().map((item: any) => parse(item.entryJson)),
    recentScans, recentDecisions };
} });

export const listOperatorRuns = query({ args: { limit: v.optional(v.number()), cursor: v.optional(v.string()), since: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const since = Number.isSafeInteger(args.since) ? Math.max(0, Math.min(Date.now(), args.since!)) : Date.now() - 24 * 60 * 60_000;
    const page = await ctx.db.query("monadVenueRuns")
      .withIndex("by_venue_createdAt", (q: any) => q.eq("venueId", "perpl-direct-testnet-v1").gte("createdAt", since))
      .order("desc").paginate({ numItems: limit, cursor: args.cursor ?? null });
    const activeRows = (await Promise.all(ACTIVE_RUN_STATUSES.map((status) => ctx.db.query("monadVenueRuns")
      .withIndex("by_venue_status_createdAt", (q: any) => q.eq("venueId", "perpl-direct-testnet-v1").eq("status", status))
      .order("desc").take(100)))).flat();
    const seen = new Set<string>();
    const runs = [...activeRows, ...page.page].filter((row: any) => row.optimizerStateJson || ACTIVE_RUN_STATUSES.includes(row.status))
      .filter((row: any) => { if (seen.has(row.runId)) return false; seen.add(row.runId); return true; })
      .map(directOptimizerRunIndexEntry).sort((a: any, b: any) => b.createdAt - a.createdAt);
    return { runs, hasMore: !page.isDone, nextCursor: page.isDone ? null : page.continueCursor };
  } });

export const getRecordsForRun = query({ args: { runId: v.string(), limit: v.optional(v.number()) }, handler: async (ctx, args) => {
  const { user, owner } = await requireMeraViewer(ctx); const row = await runFor(ctx, args.runId);
  if (!row || row.userId !== user._id || row.ownerAddress !== owner) return null;
  const limit = Math.max(1, Math.min(30, Math.floor(args.limit ?? 15)));
  const cycles = await ctx.db.query("monadVenueOptimizerCycles").withIndex("by_run_createdAt", (q: any) => q.eq("runId", row.runId)).order("desc").take(limit);
  const journal = await ctx.db.query("monadVenueOptimizerJournal").withIndex("by_run_createdAt", (q: any) => q.eq("runId", row.runId)).order("desc").take(limit);
  return { cycles: cycles.reverse().map((item: any) => parse(item.cycleJson)), journal: journal.reverse().map((item: any) => parse(item.entryJson)) };
} });
