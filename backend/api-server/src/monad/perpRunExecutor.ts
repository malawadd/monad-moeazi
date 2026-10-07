import type { JsonRpcProvider } from "ethers";
import { operatorMutation, operatorQuery } from "./convex.js";
import { finalizedBlockNumber } from "./provider.js";
import { isPerpPreparedOrderExpired, perpOrderRecoveryAction, PerpBlockedError } from "./perpOrderExecutor.js";
import { defaultPerpDecisionProvider, scriptedPerpDecision, type PerpDecisionProvider, type PerpPriceSample } from "./perpDecisionProvider.js";
import { mockClearinghouseVenue, type PerpVenueAdapter } from "./perpVenue.js";
import { executePerpScenarioPriceMove } from "./perpScenarioPriceMove.js";
import { canBroadcastPerpKind, isPerpRecoveryAction } from "./perpGates.js";
import { operatorWallet } from "./vaultTrades.js";
import { PERP_TICK_MS } from "./perpTypedData.js";

const pendingStates = ["prepared", "broadcasting", "submitted", "executed", "uncertain"];

export async function executePerpTick(runId: string, tickId: string, holderId: string, provider: JsonRpcProvider, scenario?: any,
  adapters: { venue?: PerpVenueAdapter; decisionProvider?: PerpDecisionProvider } = {}) {
  const venue = adapters.venue ?? mockClearinghouseVenue;
  const decisionProvider = adapters.decisionProvider ?? defaultPerpDecisionProvider;
  const row: any = await operatorQuery("monadPerpOrders", "getWorkerRun", { runId });
  if (!row) return null;
  const deployment = await venue.readDeployment(provider); const wallet = await operatorWallet();
  if (wallet.address.toLowerCase() !== deployment.executor.toLowerCase() || wallet.address.toLowerCase() !== row.executorAddress?.toLowerCase()) {
    throw new Error("Local operator key differs from the signed perp executor.");
  }
  const checkpoint = await finalizedBlockNumber(provider); const block = await provider.getBlock(checkpoint);
  if (!block) throw new Error("Finalized Monad block data is unavailable.");
  const orders: any[] = await operatorQuery("monadPerpOrders", "getOrders", { runId });
  const observations: any[] = [];
  const events: any[] = [];
  let status = row.status === "activation_pending" ? "activation_pending" : row.status;
  let realizedPnl = BigInt(row.realizedPnlUsdcUnits ?? "0");
  let operatorGas = orders.reduce((total, order) =>
    ["finalized", "failed"].includes(order.status) && order.receiptStatus !== undefined
      ? total + BigInt(order.gasUsed ?? "0") * BigInt(order.effectiveGasPrice ?? "0") : total, 0n);
  if (row.status === "activation_pending") {
    const funding = orders.find((item) => item.kind === "funding");
    if (!funding) throw new Error("Perp enrollment is missing its persisted atomic funding transaction.");
    const beforeStatus = funding.status;
    if (pendingStates.includes(funding.status)) {
      if (funding.status === "prepared" && row.setupDeadline <= Math.floor(Date.now() / 1000)) {
        await operatorMutation("monadPerpOrders", "updateOrder", { orderId: funding.orderId,
          status: "failed", errorCode: "funding_authorization_expired" });
        return completion(row, tickId, holderId, emptyState(row), checkpoint, "failed", [],
          [event(row, "funding_expired", "perp_funding_blocked", "blocked",
            "Signed Circle funding authorization expired before broadcast", funding)],
          false, PERP_TICK_MS, realizedPnl, operatorGas);
      }
      if (funding.status === "prepared" && !canBroadcastPerpKind("funding")) return completion(row, tickId, holderId,
        emptyState(row), checkpoint, "activation_pending", [], [], true, PERP_TICK_MS, realizedPnl, operatorGas);
      if (funding.status === "prepared") await venue.broadcastOrder(provider, wallet, row, funding);
      const fresh: any = await operatorQuery("monadPerpOrders", "getOrder", { orderId: funding.orderId });
      const result = await venue.reconcileOrder(provider, fresh, checkpoint);
      events.push(...result.events);
      if (result.finalized && beforeStatus !== "finalized") ({ realizedPnl, operatorGas } = accumulateReceipt(result, realizedPnl, operatorGas));
      if (!result.finalized) return completion(row, tickId, holderId, emptyState(row), checkpoint,
        "activation_pending", [], events, true, PERP_TICK_MS, realizedPnl, operatorGas);
      if (result.order.receiptStatus !== 1) return completion(row, tickId, holderId, emptyState(row), checkpoint, "failed", [],
        [...events, event(row, "funding_failed", "perp_funding_failed", "failed", "Atomic USDC funding and mandate transaction failed", result.order)],
        false, PERP_TICK_MS, realizedPnl, operatorGas);
      status = "active";
      events.push(event(row, "funding_finalized", "perp_funded", "finalized", "Circle USDC funding and perp mandate finalized on Monad", result.order));
    } else if (funding.status === "finalized" && funding.receiptStatus === 1) {
      status = "active";
    } else if (funding.status === "failed" || funding.status === "finalized") {
      return completion(row, tickId, holderId, emptyState(row), checkpoint, "failed", [],
        [event(row, "funding_failed", "perp_funding_failed", "failed", "Atomic USDC funding and perp mandate transaction failed", funding)],
        false, PERP_TICK_MS, realizedPnl, operatorGas);
    } else {
      return completion(row, tickId, holderId, emptyState(row), checkpoint, "activation_pending", [], events,
        true, PERP_TICK_MS, realizedPnl, operatorGas);
    }
  }
  let state = await venue.readFinalizedRunState(provider, deployment, row, checkpoint);
  let position = state.position; let pendingOrder = state.pendingOrder;
  const unresolved = orders.find((item) => item.kind !== "funding" && perpOrderRecoveryAction(item.status) !== "ignore");
  if (unresolved) {
    const expiredPrepared = isPerpPreparedOrderExpired(unresolved);
    const gateClosed = unresolved.status === "prepared" && !canBroadcastPerpKind(unresolved.kind);
    if (expiredPrepared) {
      await operatorMutation("monadPerpOrders", "updateOrder", { orderId: unresolved.orderId,
        status: "failed", errorCode: "prepared_action_expired" });
      events.push({ eventId: `${tickId}:blocked:prepared_action_expired`, type: "perp_action_blocked", status: "blocked",
        summary: "Prepared perp transaction expired before broadcast", timestamp: Date.now(), activity: true,
        ...(unresolved.scenarioId ? { scenarioId: unresolved.scenarioId, scenarioStep: unresolved.scenarioStep } : {}),
        payload: { reasonCode: "prepared_action_expired", kind: unresolved.kind,
          validUntil: unresolved.validUntil, quoteBlockNumber: unresolved.quoteBlockNumber,
          ...(unresolved.scenarioId ? { scenarioId: unresolved.scenarioId, scenarioStep: unresolved.scenarioStep } : {}) } });
      if (unresolved.kind === "stop") status = "active";
    } else if (gateClosed && isPerpRecoveryAction(unresolved.kind)) {
      return completion(row, tickId, holderId, state, checkpoint, status,
        [], events, true, PERP_TICK_MS, realizedPnl, operatorGas);
    } else if (gateClosed) {
      const reasonCode = "perp_routine_gate_disabled";
      await operatorMutation("monadPerpOrders", "updateOrder", { orderId: unresolved.orderId,
        status: "failed", errorCode: reasonCode });
      events.push({ eventId: `${tickId}:blocked:${reasonCode}`, type: "perp_action_blocked", status: "blocked",
        summary: "Prepared perp action was not broadcast because a routine test gate is disabled", timestamp: Date.now(), activity: true,
        ...(unresolved.scenarioId ? { scenarioId: unresolved.scenarioId, scenarioStep: unresolved.scenarioStep } : {}),
        payload: { reasonCode, kind: unresolved.kind,
          ...(unresolved.scenarioId ? { scenarioId: unresolved.scenarioId, scenarioStep: unresolved.scenarioStep } : {}) } });
    } else {
      const beforeStatus = unresolved.status;
      if (unresolved.status === "prepared") await venue.broadcastOrder(provider, wallet, row, unresolved);
      const fresh: any = await operatorQuery("monadPerpOrders", "getOrder", { orderId: unresolved.orderId });
      const result = await venue.reconcileOrder(provider, fresh, checkpoint);
      events.push(...result.events);
      if (result.finalized && beforeStatus !== "finalized") ({ realizedPnl, operatorGas } = accumulateReceipt(result, realizedPnl, operatorGas));
      if (!result.finalized) return completion(row, tickId, holderId, state, checkpoint, status,
        [], events, true, PERP_TICK_MS, realizedPnl, operatorGas);
      state = await venue.readFinalizedRunState(provider, deployment, row, checkpoint);
      position = state.position; pendingOrder = state.pendingOrder;
      if (result.order.kind === "stop" && state.vaultStatus === 2) status = "completed";
      return completion(row, tickId, holderId, state, checkpoint, status,
        [], events, !["completed", "expired", "failed"].includes(status), PERP_TICK_MS, realizedPnl, operatorGas);
    }
  }
  if (state.vaultStatus === 2) status = "completed";
  if (state.vaultStatus === 3) status = "expired";
  if (["completed", "expired"].includes(status)) return completion(row, tickId, holderId, state, checkpoint, status,
    [], events, false, PERP_TICK_MS, realizedPnl, operatorGas);
  const currentBlockTime = Number(block.timestamp) * 1000;
  const prices = await venue.readFinalizedMarkets(provider, deployment, checkpoint, currentBlockTime);
  observations.push(...prices.map((sample) => ({ ...sample, ownerAddress: row.ownerAddress, finalized: true,
    ...(position ? { positionJson: JSON.stringify(position) } : {}) })));
  const historyRows: any[] = await operatorQuery("monadPerpWorker", "getObservations", { runId, limit: 240 });
  const histories: PerpPriceSample[][] = [[], [], []];
  for (const sample of [...historyRows.reverse(), ...prices]) if (sample.marketIndex >= 0 && sample.marketIndex < 3) {
    histories[sample.marketIndex].push({ marketIndex: sample.marketIndex, priceUsdcPerTokenWad: String(sample.priceUsdcPerTokenWad),
      observedAt: sample.observedAt, blockNumber: sample.blockNumber });
  }
  const latest = latestPriceByMarket(prices);
  const fresh = Date.now() - currentBlockTime <= 60_000 && prices.every((item) => BigInt(item.priceUsdcPerTokenWad) > 0n);
  const defaultDecision = decisionProvider.decide({ now: Date.now(), prices, histories, position, pendingOrder,
    availableUsdcUnits: state.usdcBalance, fundingAmountUnits: row.amountUnits, expiresAt: state.expiresAt * 1000 });
  const scenarioDecision = scenario ? scriptedPerpDecision(scenario) : null;
  if (scenarioDecision?.action === "wait_expiry") {
    if (Date.now() >= state.expiresAt * 1000) scenarioDecision.action = "settle_expired";
    else scenarioDecision.action = "hold", scenarioDecision.reasonCode = "scenario_waiting_for_expiry";
  }
  if (scenarioDecision?.action === "wait_stop") {
    scenarioDecision.action = "hold"; scenarioDecision.reasonCode = "scenario_waiting_for_owner_stop";
  }
  const selected = scenarioDecision ?? defaultDecision;
  let blockedReason: string | undefined;
  let decision = !fresh && !["price_move", "settle_expired", "hold"].includes(selected.action)
    ? { action: "hold", reasonCode: "finalized_price_stale", ...(scenario ? { scenarioId: scenario.scenarioId, scenarioStep: scenario.stepIndex } : {}) }
    : selected;
  if (decision.action === "hold" && decision.reasonCode === "finalized_price_stale") blockedReason = "finalized_price_stale";
  if (decision.action !== "hold" && !canBroadcastPerpKind(decision.action)) {
    blockedReason = "perp_routine_gate_disabled";
    decision = { action: "hold", reasonCode: blockedReason,
      ...(scenario ? { scenarioId: scenario.scenarioId, scenarioStep: scenario.stepIndex } : {}) };
  }
  if (["market_entry", "limit_entry"].includes(decision.action)) {
    const amount = BigInt(state.usdcBalance);
    if (amount < 10_000n) {
      blockedReason = "available_margin_below_trade_floor";
      decision = { action: "hold", reasonCode: blockedReason,
        ...(scenario ? { scenarioId: scenario.scenarioId, scenarioStep: scenario.stepIndex } : {}) };
    }
  }
  events.push({ eventId: `${tickId}:decision`, type: "perp_decision", status: decision.action,
    summary: decision.reasonCode, timestamp: Date.now(), activity: false,
    ...(scenario ? { scenarioId: scenario.scenarioId, scenarioStep: scenario.stepIndex } : {}),
    payload: { venueId: venue.venueId, executionModel: venue.executionModel,
      provider: scenario ? "operator-script" : decisionProvider.id,
      version: scenario ? "1" : decisionProvider.version,
      decision, prices, finalizedBlockNumber: checkpoint } });
  if (blockedReason && scenario) events.push({ eventId: `${tickId}:blocked:${blockedReason}`, type: "perp_action_blocked",
    status: "blocked", summary: blockedReason, timestamp: Date.now(), activity: true,
    scenarioId: scenario.scenarioId, scenarioStep: scenario.stepIndex,
    payload: { reasonCode: blockedReason, scenarioId: scenario.scenarioId, scenarioStep: scenario.stepIndex } });
  try {
    if (decision.action === "price_move" && scenario) {
      const moved = await executePerpScenarioPriceMove(provider, wallet, deployment, scenario, decision);
      events.push(...moved.events);
      return completion(row, tickId, holderId, state, checkpoint, status, observations, events,
        true, scenario.intervalSeconds ? scenario.intervalSeconds * 1000 : PERP_TICK_MS, realizedPnl, operatorGas);
    }
    const prepared = await venue.prepareAction(provider, wallet, { row: { ...row, expiresAt: state.expiresAt * 1000 },
      tickId, decision, position: state.positionRaw, pending: state.pendingRaw, deployment, markPrices: latest });
  if (prepared) {
      await venue.broadcastOrder(provider, wallet, row, prepared);
      const order: any = await operatorQuery("monadPerpOrders", "getOrder", { orderId: prepared.orderId });
      const result = await venue.reconcileOrder(provider, order, checkpoint);
      events.push(...result.events);
      if (result.finalized) ({ realizedPnl, operatorGas } = accumulateReceipt(result, realizedPnl, operatorGas));
      else return completion(row, tickId, holderId, state, checkpoint, status, observations, events,
        true, PERP_TICK_MS, realizedPnl, operatorGas);
    }
  } catch (error) {
    if (decision.action === "price_move" && scenario) {
      const key = `perp:${scenario.scenarioId}:step:${scenario.stepIndex}:price`;
      const persisted = await operatorQuery("monadAutonomyScenarioOrders", "getOrderByKey", { idempotencyKey: `${key}:swap` })
        ?? await operatorQuery("monadAutonomyScenarioOrders", "getOrderByKey", { idempotencyKey: `${key}:approval` });
      if (persisted && !["failed", "rejected"].includes(persisted.status)) {
        return completion(row, tickId, holderId, state, checkpoint, status, observations, events,
          true, PERP_TICK_MS, realizedPnl, operatorGas);
      }
    }
    const reason = error instanceof PerpBlockedError ? error.reasonCode : "perp_order_rejected";
    events.push({ eventId: `${tickId}:blocked:${reason}`, type: "perp_action_blocked", status: "blocked",
      summary: reason, timestamp: Date.now(), ...(decision.scenarioId ? { scenarioId: decision.scenarioId, scenarioStep: decision.scenarioStep } : {}),
      payload: { reasonCode: reason, decision, ...(decision.scenarioId ? { scenarioId: decision.scenarioId, scenarioStep: decision.scenarioStep } : {}) }, activity: true });
  }
  const finalState = await venue.readFinalizedRunState(provider, deployment, row, checkpoint);
  const nextStatus = finalState.vaultStatus === 2 ? "completed" : finalState.vaultStatus === 3 ? "expired" : status === "stopping" ? "stopping" : "active";
  return completion(row, tickId, holderId, finalState, checkpoint, nextStatus, observations, events,
    !["completed", "expired", "failed"].includes(nextStatus), PERP_TICK_MS, realizedPnl, operatorGas);
}

function completion(row: any, tickId: string, holderId: string, state: any, block: number, status: string,
  observations: any[], events: any[], continueAfter: boolean, nextDelayMs: number,
  realizedPnl = BigInt(row.realizedPnlUsdcUnits ?? "0"), operatorGas = BigInt(row.operatorGasMonWei ?? "0")) {
  return { runId: row.runId, tickId, holderId, status, availableUsdcUnits: state.usdcBalance ?? row.availableUsdcUnits ?? "0",
    realizedPnlUsdcUnits: realizedPnl.toString(), unrealizedPnlUsdcUnits: state.unrealizedPnlUsdcUnits ?? "0",
    markPriceWad: state.markPriceWad ?? "0", equityUsdcUnits: state.equityUsdcUnits ?? "0",
    operatorGasMonWei: operatorGas.toString(), positionJson: state.position ? JSON.stringify(state.position) : null,
    pendingOrderJson: state.pendingOrder ? JSON.stringify(state.pendingOrder) : null,
    expiresAt: state.expiresAt ? state.expiresAt * 1000 : null, activatedAt: state.activatedAt ? state.activatedAt * 1000 : null,
    stoppedAt: status === "completed" ? Date.now() : null, lastObservedBlock: block, observations, events,
    continueAfter, nextDelayMs };
}
function event(row: any, id: string, type: string, status: string, summary: string, order: any) {
  return { eventId: id, type, status, summary, timestamp: Date.now(), orderId: order.orderId, txHash: order.txHash,
    blockNumber: order.blockNumber, payload: { kind: order.kind, receiptStatus: order.receiptStatus } };
}
function latestPriceByMarket(prices: any[]) { return prices.map((price) => price.priceUsdcPerTokenWad); }
function emptyState(row: any) { return { position: null, pendingOrder: null, usdcBalance: "0", expiresAt: row.setupDeadline,
  activatedAt: 0, vaultStatus: 0, unrealizedPnlUsdcUnits: "0", markPriceWad: "0", equityUsdcUnits: "0" }; }
export function accumulateReceipt(result: any, pnl: bigint, gas: bigint) {
  let realized = pnl;
  for (const item of result.events ?? []) if (item.type === "perp_position_closed" && item.payload?.realizedPnlUsdc !== undefined) {
    realized += BigInt(item.payload.realizedPnlUsdc);
  }
  const gasDelta = result.order?.gasUsed && result.order?.effectiveGasPrice
    ? BigInt(result.order.gasUsed) * BigInt(result.order.effectiveGasPrice) : 0n;
  return { realizedPnl: realized, operatorGas: gas + gasDelta };
}
