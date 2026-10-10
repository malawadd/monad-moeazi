import { MonadApiError } from "./config.js";
import { decidePerplOptimizer } from "./perplOptimizationStrategy.js";
import { advancePerplScanner, scannerCadenceMs, scannerMarketIds } from "./perplOptimizerScanner.js";
import { parsePerplOptimizerState, PERPL_LEGACY_TARGET_WIN_STREAK, PERPL_OPTIMIZER_POLICY,
  PERPL_OPTIMIZER_PROFILE, PERPL_OPTIMIZER_STOP_CONDITION, PERPL_OPTIMIZER_VERSION,
  type PerplOptimizerState } from "./perplOptimizerConfig.js";
import { newOptimizerCycle, optimizerCycleHasPendingOrder, reconcileOptimizerOrder, saveOptimizerState } from "./perplOptimizerExecution.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { perplDirectExecutionEnabled } from "./perplConfig.js";
import { readPerplVenueMarkets } from "./perplVenueOperations.js";
import { readObservations, stateResult } from "./perplWorkerCycle.js";
import { settleFlatPerplRun } from "./perplWorkerSettlement.js";
import { submitDirectPolicyAction } from "./perplDirectOrders.js";
import type { VenueAccountSnapshot, VenueAction } from "./venueTypes.js";
import type { TickResult } from "./perplWorkerHelpers.js";

export async function runPerplOptimizerDecisionTick(input: { provider: any; row: any; tickId: string; account: VenueAccountSnapshot;
  allOrders: any[]; accountId: number; delegatedAccountAddress: string; expiresAt: number; forced: boolean }) {
  const { provider, row, tickId, account, allOrders, accountId, delegatedAccountAddress, expiresAt, forced } = input;
  const state = parsePerplOptimizerState(row.optimizerStateJson);
  if (!state) throw new MonadApiError("Direct optimizer run has invalid persisted strategy state.", 409, "perpl_optimizer_state_invalid");
  let now = Date.now();
  if (account.positions.length && !state.activeCycle) {
    const activeOrder = [...allOrders].reverse().find((item) => item.status === "finalized" && parse(item.actionJson)?.optimizerMetadata?.role === "entry"
      && parse(item.actionJson)?.optimizerMetadata?.cycleSeed);
    const seed = activeOrder ? parse(activeOrder.actionJson).optimizerMetadata.cycleSeed : null;
    if (!seed) return respond(row, account, tickId, state, forced, "optimizer_open_position_recovery_seed_missing", { marketId: (account.positions[0] as any).mkt });
    const response = parse(activeOrder.rawResponseJson) ?? {}; const position: any = account.positions[0];
    state.activeCycle = { ...seed, entryAt: Number(seed.entryAt ?? activeOrder.updatedAt ?? now), entryFeeUnits: String(response.feeUnits ?? "0"),
      entryOrderId: activeOrder.orderId, entryRequestId: activeOrder.requestId, entryTxHash: activeOrder.txHash,
      entryBlockNumber: activeOrder.blockNumber, entryFills: parse(activeOrder.fillsJson) ?? [],
      entryPosition: { size: position.s, entryPrice: position.ep, depositUnits: position.depositUnits } };
    await saveOptimizerState(row.runId, state);
  }
  if (!account.positions.length && state.activeCycle && !optimizerCycleHasPendingOrder(allOrders, String(state.activeCycle.cycleId))) {
    state.activeCycle = null; await saveOptimizerState(row.runId, state);
  }
  let observation = { histories: {} as Record<number, number[]>, samples: {} as Record<number, any[]>, snapshots: [] as any[] };
  if (!forced) {
    observation = await readObservations(row, account, false);
    const observedAt = Math.max(state.lastObservationAt, ...observation.snapshots.map((item: any) => item.observedAt));
    if (observedAt > state.lastObservationAt) { state.lastObservationAt = observedAt; await saveOptimizerState(row.runId, state); }
  }
  const positionMarket = account.positions.length ? Number((account.positions[0] as any).mkt) : null;
  const scanDue = !forced && state.status === "running"
    && now < expiresAt && now - state.lastMarketScanAt >= scannerCadenceMs(state);
  if (!positionMarket && !forced && state.status !== "running") return respond(row, account, tickId, state, forced,
    "optimizer_target_or_cycle_cap_reached", { optimizerStatus: state.status }, observation);
  if (!positionMarket && !forced && !scanDue && now < expiresAt) return respond(row, account, tickId, state, forced,
    "optimizer_market_scan_not_due", { nextMarketScanAt: state.lastMarketScanAt + scannerCadenceMs(state) }, observation);
  const marketIds = scannerMarketIds(JSON.parse(row.marketIdsJson), positionMarket, scanDue);
  const markets = marketIds.length ? await readPerplVenueMarkets({ marketIds, withBook: true, finalized: true }) : [];
  // The public market and finalized-book reads can take longer than one observation interval.
  // Decide against the time when both inputs are available, not the time before either read.
  now = Date.now();
  let scanDecision = null;
  if (scanDue) {
    scanDecision = decidePerplOptimizer({ now, expiresAt, run: row,
      account: { ...account, positions: [], orders: [] }, markets, histories: observation.samples,
      params: state.params, optimizerStatus: state.status, policyVersion: state.version });
    const advanced = advancePerplScanner(state, scanDecision, now, Boolean(positionMarket));
    await operatorMutation("monadVenueOptimizer", "recordScannerScan", { runId: row.runId, tickId,
      recordJson: JSON.stringify(advanced.record) });
    Object.assign(state, advanced.state);
    await saveOptimizerState(row.runId, state);
  }
  state.lastExitCheckAt = now;
  const decision = !positionMarket && scanDecision ? scanDecision : decidePerplOptimizer({ now, expiresAt, run: row, account, markets,
    histories: observation.samples, params: state.params, forceExit: forced, optimizerStatus: state.status,
    activeCycle: state.activeCycle, policyVersion: state.version });
  if (decision.kind === "hold") {
    if (state.activeCycle && decision.details?.bestEstimatedProfitUnits) state.activeCycle = { ...state.activeCycle,
      bestEstimatedProfitUnits: String(decision.details.bestEstimatedProfitUnits) };
    await saveOptimizerState(row.runId, state);
    return respond(row, account, tickId, state, forced, decision.reasonCode, decision.details, observation);
  }
  if (decision.kind === "settle") {
    const result = await settleFlatPerplRun(provider, { ...row, accountId, delegatedAccountAddress });
    if (result.result) return { ...result.result, patch: { ...result.result.patch, optimizerStateJson: JSON.stringify(state),
      balanceUnits: account.balanceUnits, equityUnits: account.balanceUnits, positionsJson: JSON.stringify(account.positions),
      ordersJson: JSON.stringify(account.orders), lastAccountBlock: account.blockNumber } };
    return { status: "settling", phase: "perpl_direct_settlement_waiting", patch: { optimizerStateJson: JSON.stringify(state) },
      event: { eventId: `tick:${tickId}:settlement_wait`, kind: "perpl_direct_settlement_waiting", status: "waiting",
        summary: "Perpl direct settlement is awaiting finalized account state" }, continueAfter: true, nextDelayMs: 5_000 } as TickResult;
  }
  const entry = decision.action.kind === "market_entry";
  if (!perplDirectExecutionEnabled()) return entry ? respond(row, account, tickId, state, forced,
    "perpl_direct_execution_disabled", { policyVersion: state.version }, observation)
    : { status: "incomplete_settlement", phase: "perpl_direct_exit_gate_disabled", patch: { recoveryReason: "perpl_direct_exit_gate_disabled" },
      event: { eventId: `tick:${tickId}:exit_gate`, kind: "perpl_direct_blocked", status: "blocked",
        summary: "Perpl direct exit requires the direct execution gate" }, continueAfter: false, nextDelayMs: 5_000 } as TickResult;
  const market = markets.find((item) => item.id === decision.action.marketId);
  if (!market) return respond(row, account, tickId, state, forced, "perpl_direct_market_missing", { marketId: decision.action.marketId }, observation);
  let metadata: Record<string, unknown>;
  if (entry) {
    const seeded = newOptimizerCycle({ runId: row.runId, state, now, balanceUnits: account.balanceUnits,
      market, action: decision.action, decision: decision.details });
    state.activeCycle = seeded.activeCycle; metadata = seeded.optimizerMetadata;
    await saveOptimizerState(row.runId, state);
  } else {
    const active: any = state.activeCycle;
    if (!active) return respond(row, account, tickId, state, forced, "optimizer_active_cycle_missing", { marketId: market.id }, observation);
    state.activeCycle = { ...active, exitPending: true, exitReason: decision.reasonCode,
      lastExitDecision: decision.details, lastFundingPnlUnits: String(decision.details.fundingPnlUnits ?? active.lastFundingPnlUnits ?? "0") };
    metadata = { cycleId: active.cycleId, role: "exit", reasonCode: decision.reasonCode, decision: { ...decision.details, reasonCode: decision.reasonCode } };
    await saveOptimizerState(row.runId, state);
  }
  const action: VenueAction = { ...decision.action, accountId, optimizerMetadata: metadata,
    allowedMarketIds: JSON.parse(row.marketIdsJson), activePositionCount: account.positions.length,
    maxLeverage: row.maxLeverage, expiresAt };
  const submitted = await submitDirectPolicyAction({ provider, run: row, action, market, account,
    idempotencyKey: `${row.runId}:${tickId}:optimizer:${entry ? "entry" : "exit"}` });
  if (["finalized", "no_fill", "failed", "canceled"].includes(submitted.phase) && submitted.orderId) {
    const persisted: any = await operatorQuery("monadVenueOrders", "getOrder", { orderId: submitted.orderId });
    const orders: any[] = await operatorQuery("monadVenueOrders", "getOrders", { runId: row.runId });
    const reconciled = await reconcileOptimizerOrder({ runId: row.runId, state, pending: persisted, result: submitted,
      account: submitted.account ?? account, orders });
    if (reconciled.handled) Object.assign(state, reconciled.state);
  }
  return respond(row, account, tickId, state, forced, decision.reasonCode, { action: action.kind,
    orderId: submitted.orderId, txHash: submitted.txHash, phase: submitted.phase, decision: decision.details }, observation, 5_000);
}

function respond(row: any, account: VenueAccountSnapshot, tickId: string, state: PerplOptimizerState, forced: boolean,
  phase: string, details?: any, observation?: any, delay = forced ? 5_000 : 60_000) {
  const result = stateResult(row, account, tickId, forced ? "settling" : "active", phase,
    "perpl_direct_optimizer", { ...details, optimizer: { version: state.version, cycleCount: state.cycles,
      profile: state.version === PERPL_OPTIMIZER_VERSION ? PERPL_OPTIMIZER_PROFILE : "two_win_target",
      stopCondition: state.version === PERPL_OPTIMIZER_VERSION ? PERPL_OPTIMIZER_STOP_CONDITION : "two_wins_or_cycle_cap",
      cycleLimit: PERPL_OPTIMIZER_POLICY.maxCycles, targetWinStreak: state.version === PERPL_OPTIMIZER_VERSION
        ? null : PERPL_LEGACY_TARGET_WIN_STREAK,
      winStreak: state.winStreak, status: state.status, params: state.params } }, observation);
  result.nextDelayMs = delay; result.patch = { ...(result.patch ?? {}), optimizerStateJson: JSON.stringify(state) };
  return result;
}
function parse(raw?: string) { try { return raw ? JSON.parse(raw) : null; } catch { return null; } }
