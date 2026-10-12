import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireMonadOperator } from "./monadHelpers";

const VENUES = ["perpl-direct-testnet-v1", "perpl-testnet-v1"];
const ACTIVE = new Set(["prepared", "activation_pending", "active", "uncertain", "stopping", "settling", "incomplete_settlement"]);
const ACTIVE_STATUSES = ["prepared", "activation_pending", "active", "uncertain", "stopping", "settling", "incomplete_settlement"];
const parse = (raw?: string) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
const shortOwner = (value: string) => /^0x[a-f0-9]{40}$/i.test(value) ? `${value.slice(0, 8)}…${value.slice(-6)}` : "unknown";
const safeError = (value?: string) => String(value ?? "").replace(/https?:\/\/\S+/gi, "[endpoint]")
  .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").replace(/0x[a-f0-9]{64,}/gi, "[hex redacted]").slice(0, 220);

function optimizerSummary(raw?: string) {
  const state = parse(raw);
  if (!state || typeof state !== "object") return null;
  const cycle = state.activeCycle && typeof state.activeCycle === "object" ? state.activeCycle : null;
  const exitDecision = cycle?.lastExitDecision && typeof cycle.lastExitDecision === "object" ? cycle.lastExitDecision : null;
  const decisionDetails = exitDecision?.details && typeof exitDecision.details === "object" ? exitDecision.details : exitDecision;
  return { version: state.version ?? null, status: state.status ?? null, cycles: Number(state.cycles ?? 0),
    activeCycle: cycle ? { cycleNumber: Number(cycle.cycleNumber ?? 0) || null,
      startedAt: Number(cycle.startedAt ?? 0) || null, entryAt: Number(cycle.entryAt ?? 0) || null,
      marketId: Number.isSafeInteger(Number(cycle.marketId ?? cycle.selectedMarket?.id))
        ? Number(cycle.marketId ?? cycle.selectedMarket?.id) : null,
      symbol: String(cycle.symbol ?? cycle.selectedMarket?.symbol ?? "").slice(0, 40) || null,
      direction: String(cycle.entryDecision?.direction ?? cycle.direction ?? "").slice(0, 10) || null,
      bestEstimatedProfitUnits: String(cycle.bestEstimatedProfitUnits ?? "").slice(0, 40) || null,
      exitPending: Boolean(cycle.exitPending), exitReason: String(cycle.exitReason ?? exitDecision?.reasonCode ?? "").slice(0, 100) || null,
      lastExitDecision: exitDecision || cycle.exitReason ? { reasonCode: String(exitDecision?.reasonCode ?? cycle.exitReason ?? "").slice(0, 100) || null,
        estimatedNetProfitUnits: String(decisionDetails?.estimatedNetProfitUnits ?? "").slice(0, 40) || null,
        heldMs: Number(decisionDetails?.heldMs ?? 0) || null,
        closeImpactBps: Number(decisionDetails?.closeImpactBps ?? 0) || null } : null } : null,
    lastExitCheckAt: Number(state.lastExitCheckAt ?? 0) || null,
    lastObservationAt: Number(state.lastObservationAt ?? 0) || null,
    lastMarketScanAt: Number(state.lastMarketScanAt ?? 0) || null,
    scanner: state.scanner ? { totalScans: Number(state.scanner.totalScans ?? 0),
      totalProposals: Number(state.scanner.totalProposals ?? 0), consecutiveNoProposal: Number(state.scanner.consecutiveNoProposal ?? 0) } : null };
}

async function runSnapshot(ctx: any, row: any) {
  const positionRows = Array.isArray(parse(row.positionsJson)) ? parse(row.positionsJson) : [];
  const openOrderRows = Array.isArray(parse(row.ordersJson)) ? parse(row.ordersJson) : [];
  const marketRows = Array.isArray(parse(row.marketsJson)) ? parse(row.marketsJson) : [];
  const configuredMarketIds = parse(row.marketIdsJson);
  const marketIds = (Array.isArray(configuredMarketIds) ? configuredMarketIds
    : marketRows.map((market: any) => Number(market.id))).filter(Number.isSafeInteger).slice(0, 32);
  const [orders, events, observations] = await Promise.all([
    ctx.db.query("monadVenueOrders").withIndex("by_runId_createdAt", (q: any) => q.eq("runId", row.runId)).order("desc").take(30),
    ctx.db.query("monadVenueEvents").withIndex("by_run_timestamp", (q: any) => q.eq("runId", row.runId)).order("desc").take(12),
    Promise.all(marketIds.map((marketId: number) => ctx.db.query("monadVenueObservations")
      .withIndex("by_run_market_time", (q: any) => q.eq("runId", row.runId).eq("marketId", marketId))
      .order("desc").first())),
  ]);
  const markets = marketRows.map((market: any) => ({ id: Number(market.id), symbol: String(market.symbol ?? `Market ${market.id}`) }))
    .filter((market: any) => Number.isSafeInteger(market.id));
  return {
    runId: row.runId, venueId: row.venueId, status: row.status, phase: row.phase ?? row.status, chainId: row.chainId,
    owner: shortOwner(row.ownerAddress), createdAt: row.createdAt, updatedAt: row.updatedAt,
    activatedAt: row.activatedAt ?? null, expiresAt: row.expiresAt ?? null, completedAt: row.completedAt ?? null,
    lastTickId: row.lastTickId ?? null, nextTickId: row.nextTickId ?? null,
    lastSuccessfulTickAt: row.lastSuccessfulTickAt ?? null, lastWorkerError: safeError(row.lastWorkerError),
    lastWorkerErrorAt: row.lastWorkerErrorAt ?? null, watchdogLastRetryAt: row.watchdogLastRetryAt ?? null,
    watchdogRetryCount: row.watchdogRetryCount ?? 0, consecutiveWorkerFailures: row.consecutiveWorkerFailures ?? 0,
    nextTickDueAt: row.nextTickDueAt ?? null,
    leaseExpiresAt: row.leaseExpiresAt ?? null, leaseActive: Boolean(row.leaseHolder),
    entryPausedAt: row.entryPausedAt ?? null, entryPauseReason: row.entryPauseReason ?? null,
    lastObservedAt: row.lastObservedAt ?? null, positionCount: positionRows.length,
    positionMarketIds: positionRows.map((position: any) => Number(position.mkt ?? position.marketId)).filter(Number.isSafeInteger),
    openOrderCount: openOrderRows.length, optimizer: optimizerSummary(row.optimizerStateJson),
    marketIds, markets,
    orders: orders.map((order: any) => ({ orderId: order.orderId, requestId: order.requestId, kind: order.kind,
      status: order.status, txHash: order.txHash ?? null, errorCode: order.errorCode ?? null,
      createdAt: order.createdAt, updatedAt: order.updatedAt })),
    observations: observations.filter((item: any) => item !== null).map((item: any) => ({ marketId: item.marketId, observedAt: item.observedAt,
      blockNumber: item.blockNumber, finalized: item.finalized })),
    recentEvents: events.map((item: any) => ({ kind: item.kind, status: item.status, timestamp: item.timestamp, summary: item.summary })),
    recoveryReason: row.recoveryReason ?? null,
  };
}

export const snapshot = query({ args: { recentHours: v.optional(v.number()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const now = Date.now(); const hours = Math.max(1, Math.min(72, Math.floor(args.recentHours ?? 24)));
  const [activePages, recentPages] = await Promise.all([
    Promise.all(VENUES.flatMap((venueId) => ACTIVE_STATUSES.map((status) => ctx.db.query("monadVenueRuns")
      .withIndex("by_venue_status_createdAt", (q: any) => q.eq("venueId", venueId).eq("status", status))
      .order("desc").take(50)))),
    Promise.all(VENUES.map((venueId) => ctx.db.query("monadVenueRuns")
      .withIndex("by_venue_createdAt", (q: any) => q.eq("venueId", venueId)).order("desc").take(50))),
  ]);
  const candidates = new Map<string, any>();
  for (const row of [...activePages.flat(), ...recentPages.flat()]) {
    if (ACTIVE.has(row.status) || row.updatedAt >= now - hours * 60 * 60_000) candidates.set(row.runId, row);
  }
  const sorted = [...candidates.values()].sort((a: any, b: any) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status))
    || Number(b.updatedAt) - Number(a.updatedAt));
  const limit = 32; const rows = sorted.slice(0, limit);
  return { generatedAt: now, truncatedRuns: sorted.length > limit, totalCandidateCount: sorted.length,
    runs: await Promise.all(rows.map((row: any) => runSnapshot(ctx, row))) };
} });
