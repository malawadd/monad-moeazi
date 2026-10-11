import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMonadOperator } from "./monadHelpers";

export const DETERMINISTIC_STRATEGY_ID = "perpl-deterministic";
export const DETERMINISTIC_STRATEGY_VERSION = "perpl-deterministic-v3-soak";
export const DETERMINISTIC_STRATEGY_VERSIONS = [DETERMINISTIC_STRATEGY_VERSION, "perpl-deterministic-v2"];
const DIRECT_PERPL_VENUE = "perpl-direct-testnet-v1";
const BACKFILL_KEY = "perpl-deterministic-strategy-identity-v1";
const ACTIVATED_STATUSES = new Set(["active", "stopping", "settling", "uncertain", "incomplete_settlement", "completed"]);
const ADDRESS = /^0x[a-f0-9]{40}$/i;
const HASH = /^0x[a-f0-9]{64}$/i;
const SIGNED_UNITS = /^-?\d+$/;
const UNSIGNED_UNITS = /^\d+$/;

function parseJson(raw?: string) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export function optimizerStrategyIdentity(venueId: string, optimizerState: any) {
  if (venueId !== DIRECT_PERPL_VENUE || !DETERMINISTIC_STRATEGY_VERSIONS.includes(optimizerState?.version)) return null;
  return { strategyId: DETERMINISTIC_STRATEGY_ID, strategyVersion: optimizerState.version as string };
}

function verifiedOptimizerRun(row: any) {
  const state = parseJson(row.optimizerStateJson);
  const identity = optimizerStrategyIdentity(row.venueId, state);
  if (!identity || row.strategyId && row.strategyId !== identity.strategyId
      || row.strategyVersion && row.strategyVersion !== identity.strategyVersion
      || !ACTIVATED_STATUSES.has(row.status) || !Number.isFinite(row.activatedAt) || row.activatedAt <= 0
      || row.fundingStatus !== "finalized" || row.activationStatus !== "finalized"
      || !HASH.test(String(row.fundingTxHash ?? "")) || !HASH.test(String(row.activationTxHash ?? ""))
      || !ADDRESS.test(String(row.delegatedAccountAddress ?? ""))
      || !Number.isSafeInteger(row.accountId) || row.accountId <= 0
      || !ADDRESS.test(String(row.ownerAddress ?? ""))) return false;
  return true;
}

function verifiedCycle(row: any) {
  const cycle = parseJson(row.cycleJson);
  if (!cycle || cycle.cycleId !== row.cycleId || cycle.exitFinalized !== true || cycle.endingFlat !== true
      || !Number.isSafeInteger(cycle.exitFillCount) || cycle.exitFillCount < 1
      || !Array.isArray(cycle.orderReceipts) || cycle.orderReceipts.length < 2
      || !cycle.orderReceipts.some((item: any) => item?.role === "entry")
      || !cycle.orderReceipts.some((item: any) => item?.role === "exit" && Array.isArray(item.fills) && item.fills.length > 0)
      || !UNSIGNED_UNITS.test(String(cycle.startingBalanceUnits ?? ""))
      || !UNSIGNED_UNITS.test(String(cycle.endingBalanceUnits ?? ""))
      || !SIGNED_UNITS.test(String(row.realizedPnlUnits ?? ""))) return null;
  const pnl = BigInt(cycle.endingBalanceUnits) - BigInt(cycle.startingBalanceUnits);
  if (pnl !== BigInt(row.realizedPnlUnits)) return null;
  return pnl;
}

export function publicStrategyMetricsFromRecords(runs: any[], cycles: any[], observedAt = Date.now()) {
  const eligibleRuns = new Map<string, any>();
  const wallets = new Set<string>();
  for (const run of runs) {
    if (!verifiedOptimizerRun(run)) continue;
    eligibleRuns.set(run.runId, run);
    wallets.add(String(run.ownerAddress).toLowerCase());
  }
  const seenCycles = new Set<string>();
  let netRealizedPnlUnits = 0n;
  for (const cycle of cycles) {
    if (cycle.venueId !== DIRECT_PERPL_VENUE || !eligibleRuns.has(cycle.runId) || !cycle.cycleId
        || seenCycles.has(cycle.cycleId)) continue;
    const pnl = verifiedCycle(cycle);
    if (pnl === null) continue;
    seenCycles.add(cycle.cycleId);
    netRealizedPnlUnits += pnl;
  }
  return { strategyId: DETERMINISTIC_STRATEGY_ID, currency: "AUSD", decimals: 6,
    netRealizedPnlUnits: netRealizedPnlUnits.toString(), verifiedCycleCount: seenCycles.size,
    uniqueActivatedWalletCount: wallets.size, observedAt };
}

export const getPublicMetrics = query({ args: {}, handler: async (ctx) => {
  await requireMonadOperator(ctx);
  const [runs, cycles] = await Promise.all([
    ctx.db.query("monadVenueRuns").withIndex("by_venue_createdAt", (q: any) => q.eq("venueId", DIRECT_PERPL_VENUE)).collect(),
    ctx.db.query("monadVenueOptimizerCycles").withIndex("by_venue_createdAt", (q: any) => q.eq("venueId", DIRECT_PERPL_VENUE)).collect(),
  ]);
  return publicStrategyMetricsFromRecords(runs, cycles);
} });

export const backfillOptimizerIdentities = mutation({
  args: { limit: v.optional(v.number()) }, handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const state = await ctx.db.query("monadStrategyBackfillState")
      .withIndex("by_key", (q: any) => q.eq("key", BACKFILL_KEY)).first();
    if (state?.completed) return { processed: 0, updated: 0, hasMore: false, complete: true };
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 100)));
    const page = await ctx.db.query("monadVenueRuns")
      .withIndex("by_venue_createdAt", (q: any) => q.eq("venueId", DIRECT_PERPL_VENUE))
      .order("asc").paginate({ numItems: limit, cursor: state?.cursor ?? null });
    let updated = 0;
    for (const row of page.page) {
      const identity = optimizerStrategyIdentity(row.venueId, parseJson(row.optimizerStateJson));
      if (!identity || row.strategyId && row.strategyId !== identity.strategyId
          || row.strategyId === identity.strategyId && row.strategyVersion === identity.strategyVersion) continue;
      await ctx.db.patch(row._id, identity);
      updated += 1;
    }
    const progress = { cursor: page.isDone ? undefined : page.continueCursor,
      completed: page.isDone, updatedAt: Date.now() };
    if (state) await ctx.db.patch(state._id, progress);
    else await ctx.db.insert("monadStrategyBackfillState", { key: BACKFILL_KEY, ...progress });
    return { processed: page.page.length, updated, hasMore: !page.isDone, complete: page.isDone };
  },
});
