import { operatorMutation } from "./convex.js";
import type { PerplOptimizerState } from "./perplOptimizerConfig.js";
import type { VenueAccountSnapshot } from "./venueTypes.js";

export async function saveOptimizerState(runId: string, state: PerplOptimizerState) {
  await operatorMutation("monadVenueOptimizer", "writeState", { runId, stateJson: JSON.stringify(state) });
}

export function optimizerFinalOrderUnprocessed(order: any, state: PerplOptimizerState | null) {
  if (order?.status !== "finalized" || !state?.activeCycle) return false;
  const metadata = parse(order.actionJson)?.optimizerMetadata; const active: any = state.activeCycle;
  if (metadata?.cycleId !== active.cycleId) return false;
  return metadata.role === "entry" ? active.entryOrderId !== order.orderId
    : metadata.role === "exit" && !(active.processedExitOrderIds ?? []).includes(order.orderId);
}
export function optimizerCycleHasPendingOrder(orders: any[], cycleId: string) {
  return orders.some((order) => {
    const metadata = parse(order.actionJson)?.optimizerMetadata;
    return metadata?.cycleId === cycleId && ["prepared", "submitted", "executed", "uncertain", "filled", "partially_filled"].includes(order.status);
  });
}

export function newOptimizerCycle(input: { runId: string; state: PerplOptimizerState; now: number; balanceUnits: string;
  market: any; action: any; decision: Record<string, any> }) {
  const cycleId = `${input.runId}:cycle:${input.state.cycles + 1}`;
  const details = input.decision; const observation = details.observations ?? {};
  const activeCycle = { cycleId, cycleNumber: input.state.cycles + 1, startedAt: input.now, entryAt: null,
    startingBalanceUnits: input.balanceUnits, marketId: input.market.id, symbol: input.market.symbol,
    selectedMarket: { id: input.market.id, symbol: input.market.symbol },
    rejectedAlternatives: details.rejectedMarkets ?? [], observationBlocks: [observation.first15m, observation.first5m,
      observation.prior1m, observation.latest1m].filter(Boolean).map((item: any) => ({ blockNumber: item.blockNumber, observedAt: item.observedAt })),
    ruleVersion: input.state.version, params: { ...input.state.params }, entryDecision: details,
    marginUnits: String(input.action.maxCollateralUnits ?? "0"), notionalUnits: String(input.action.maxExposureUnits ?? "0"),
    leverage: input.action.leverage, entryImpactBps: details.estimatedEntryImpactBps ?? 0,
    estimatedRoundTripCostBps: details.estimatedRoundTripCostBps ?? 0, orderReceipts: [] };
  return { cycleId, activeCycle,
    optimizerMetadata: { cycleId, role: "entry", decision: details, cycleSeed: activeCycle } };
}

export async function reconcileOptimizerOrder(input: { runId: string; state: PerplOptimizerState; pending: any; result: any;
  account: VenueAccountSnapshot; orders: any[] }) {
  const action = parse(input.pending.actionJson); const metadata = action?.optimizerMetadata;
  if (!metadata || metadata.cycleId !== input.state.activeCycle?.cycleId) return { handled: false, state: input.state };
  const state = input.state; const active: any = state.activeCycle; const role = metadata.role;
  if (role === "entry") {
    if (input.result.phase === "finalized" && input.result.filled) {
      if (active.entryOrderId === input.pending.orderId) return { handled: true, state };
      const position: any = input.account.positions.find((item: any) => Number(item.mkt) === Number(action.marketId));
      if (!position) return { handled: false, state };
      const response = parse(input.pending.rawResponseJson) ?? {};
      state.activeCycle = { ...active, entryAt: Date.now(), entryFeeUnits: String(response.feeUnits ?? "0"),
        entryOrderId: input.pending.orderId, entryRequestId: input.pending.requestId, entryTxHash: input.pending.txHash,
        entryBlockNumber: input.pending.blockNumber, entryFills: parse(input.pending.fillsJson) ?? [],
        entryPosition: { size: position.s, entryPrice: position.ep, depositUnits: position.depositUnits } };
    } else if (["failed", "canceled", "no_fill"].includes(input.result.phase)) state.activeCycle = null;
    else return { handled: false, state };
    await saveOptimizerState(input.runId, state); return { handled: true, state };
  }
  if (role !== "exit" || input.result.phase !== "finalized" || !input.result.filled) {
    if (role === "exit" && ["failed", "canceled", "no_fill"].includes(input.result.phase)) {
      state.activeCycle = { ...active, exitPending: false }; await saveOptimizerState(input.runId, state);
      return { handled: true, state };
    }
    return { handled: false, state };
  }
  const exitDecision = metadata.decision ?? {};
  if (input.account.positions.length) {
    state.activeCycle = { ...active, exitPending: true, exitReason: exitDecision.reasonCode ?? "partial_close",
      lastExitDecision: exitDecision, lastFundingPnlUnits: String(exitDecision.fundingPnlUnits ?? active.lastFundingPnlUnits ?? "0"),
      lastExitOrderId: input.pending.orderId, lastExitTxHash: input.pending.txHash,
      processedExitOrderIds: [...new Set([...(active.processedExitOrderIds ?? []), input.pending.orderId])] };
    await saveOptimizerState(input.runId, state); return { handled: true, state };
  }
  const receipts = input.orders.filter((order) => {
    const orderAction = parse(order.actionJson); return orderAction?.optimizerMetadata?.cycleId === metadata.cycleId
      && order.status === "finalized";
  }).map((order) => {
    const response = parse(order.rawResponseJson) ?? {}; const orderAction = parse(order.actionJson) ?? {};
    return { role: orderAction.optimizerMetadata?.role ?? "unknown", kind: order.kind, orderId: order.orderId,
      requestId: order.requestId, txHash: order.txHash, blockNumber: order.blockNumber,
      fills: parse(order.fillsJson) ?? [], feeUnits: String(response.feeUnits ?? "0"),
      operatorGasWei: String(response.operatorGasWei ?? "0") };
  });
  const entry = receipts.find((item) => item.role === "entry"); const exits = receipts.filter((item) => item.role === "exit");
  const exitFillCount = exits.reduce((sum, item) => sum + item.fills.length, 0);
  if (!entry || !exits.length || exitFillCount < 1) return { handled: false, state };
  const feesUnits = receipts.reduce((sum, item) => sum + BigInt(item.feeUnits), 0n).toString();
  const operatorGasWei = receipts.reduce((sum, item) => sum + BigInt(item.operatorGasWei), 0n).toString();
  const fundingUnits = String(exitDecision.fundingPnlUnits ?? active.lastFundingPnlUnits ?? "0");
  const cycle = { ...active, completedAt: Date.now(), exitFinalized: true, exitFillCount, endingFlat: true,
    endingBalanceUnits: input.account.balanceUnits, exitDecision, exitDecisions: [active.lastExitDecision, exitDecision].filter(Boolean),
    exitReason: exitDecision.reasonCode ?? active.exitReason, exitTxHashes: exits.map((item) => item.txHash),
    orderReceipts: receipts, orderIds: receipts.map((item) => item.orderId), txHashes: receipts.map((item) => item.txHash),
    feesUnits, fundingUnits, operatorGasWei };
  const pnl = BigInt(cycle.endingBalanceUnits) - BigInt(cycle.startingBalanceUnits);
  const impactUnits = BigInt(active.notionalUnits ?? "0") * BigInt(Math.ceil(Number(active.estimatedRoundTripCostBps ?? 0))) / 10_000n;
  const classification = pnl >= 0n ? "small_or_zero" : BigInt(feesUnits) + impactUnits >= -pnl / 2n
    ? "execution_costs" : "trend_reversal_or_stall";
  const completed: any = await operatorMutation("monadVenueOptimizer", "completeCycle", { runId: input.runId,
    cycleId: metadata.cycleId, cycleJson: JSON.stringify(cycle), classification });
  const nextState = { ...state, cycles: completed.cycleNumber, winStreak: completed.winStreak,
    status: completed.optimizerStatus, params: completed.params, activeCycle: null,
    lastCycle: { cycleId: metadata.cycleId, cycleNumber: completed.cycleNumber,
      realizedPnlUnits: completed.realizedPnlUnits, completedAt: cycle.completedAt, winStreak: completed.winStreak } } as PerplOptimizerState;
  return { handled: true, state: nextState, cycle: completed };
}

function parse(raw?: string) { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }
