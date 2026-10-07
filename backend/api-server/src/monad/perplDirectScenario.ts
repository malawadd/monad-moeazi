import { operatorMutation, operatorQuery } from "./convex.js";
import { perplDirectExecutionEnabled } from "./perplConfig.js";
import { submitDirectPolicyAction } from "./perplDirectOrders.js";
import { readDirectOrder } from "./perplDirectState.js";
import { buildPerplScenarioAction, parseActions } from "./perplScenarioPolicy.js";
import { event, waitResult, type TickResult } from "./perplWorkerHelpers.js";
import type { VenueAccountSnapshot, VenueMarket } from "./venueTypes.js";

type Input = { provider: any; run: any; scenario: any; account: VenueAccountSnapshot;
  markets: VenueMarket[]; tickId: string };

function result(input: Input, phase: string, status = "active", details?: unknown): TickResult {
  return { status, phase, patch: { scenarioId: input.scenario.scenarioId, scenarioStep: input.scenario.stepIndex },
    event: event(`${input.scenario.scenarioId}:${input.scenario.stepIndex}:${phase}:${input.tickId}`,
      `perpl_direct_scenario_${phase}`, phase, `Perpl direct scenario ${phase.replaceAll("_", " ")}`, details),
    continueAfter: true, nextDelayMs: 5_000 };
}

export async function runPerplDirectScenarioTick(input: Input): Promise<TickResult> {
  const { scenario, run, account, markets } = input;
  if (scenario.status === "cancel_pending") {
    const pending: any = scenario.activeOrderId ? await operatorQuery("monadVenueOrders", "getOrder", { orderId: scenario.activeOrderId }) : null;
    if (!pending || !["finalized", "failed", "canceled"].includes(pending.status)) {
      return result(input, "cancel_waiting_for_order", "active", { orderId: scenario.activeOrderId });
    }
    if (scenario.activeActionKind === "scenario_cancel_order" && pending.status === "finalized") {
      await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
        expectedStepIndex: scenario.stepIndex, status: "finish_cancelled" });
      return result(input, "canceled");
    }
    if (account.orders.length) {
      const original: any = JSON.parse(pending.actionJson ?? "{}"); const venueOrderId = Number(pending.orderIdAtVenue);
      const market = markets.find((item) => item.id === Number(original.marketId));
      if (!market || !Number.isSafeInteger(venueOrderId) || venueOrderId <= 0 || !perplDirectExecutionEnabled()) {
        return result(input, "cancel_requires_verified_order_id", "active");
      }
      let onchain; try { onchain = await readDirectOrder(input.provider, market.id, venueOrderId, account.blockNumber); }
      catch { return result(input, "cancel_order_state_unavailable", "active"); }
      if (onchain.accountId !== account.accountId || BigInt(onchain.size) <= 0n) return result(input, "cancel_order_state_mismatch", "active");
      const action = { kind: "cancel_limit", marketId: market.id, accountId: account.accountId,
        orderId: venueOrderId, size: 0, leverage: 0, allowedMarketIds: JSON.parse(run.marketIdsJson),
        activePositionCount: account.positions.length };
      const submitted = await submitDirectPolicyAction({ provider: input.provider, run, action, market, account,
        idempotencyKey: `${scenario.scenarioId}:cancel:${pending.requestId}` });
      await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
        expectedStepIndex: scenario.stepIndex, status: "cancel_dispatch", activeOrderId: submitted.orderId,
        activeRequestId: submitted.requestId, activeActionKind: "scenario_cancel_order", venueOrderId });
      return result(input, "cancel_submitted", "active", { txHash: submitted.txHash, orderId: venueOrderId });
    }
    await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
      expectedStepIndex: scenario.stepIndex, status: "finish_cancelled" });
    return result(input, "canceled");
  }
  if (scenario.status === "running") {
    const order: any = await operatorQuery("monadVenueOrders", "getOrder", { orderId: scenario.activeOrderId });
    if (!order) return result(input, "order_missing", "active");
    if (order.status === "failed") {
      await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
        expectedStepIndex: scenario.stepIndex, status: "blocked", errorCode: order.errorCode ?? "perpl_direct_order_failed" });
      return result(input, "blocked", "active", { errorCode: order.errorCode });
    }
    if (order.status !== "finalized") return result(input, "order_reconciling", "active", { orderId: order.orderId,
      txHash: order.txHash, phase: order.status });
    const advanced: any = await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
      expectedStepIndex: scenario.stepIndex, status: "advance",
      ...(order.orderIdAtVenue ? { venueOrderId: Number(order.orderIdAtVenue) } : {}) });
    return result(input, advanced?.status === "completed" ? "completed" : "step_advanced", "active",
      { orderId: order.orderId, txHash: order.txHash });
  }
  if (Number(scenario.nextAt) > Date.now()) return waitResult("active", "direct_scenario_interval_wait", {}, 5_000);
  if (!perplDirectExecutionEnabled()) return result(input, "gate_disabled", "active");
  const raw = parseActions(scenario.actions)[scenario.stepIndex];
  const market = markets.find((item) => item.id === Number(raw?.marketId));
  if (!market) return result(input, "market_unavailable", "active");
  let action;
  try { action = buildPerplScenarioAction({ scenario, run, account, market, now: Date.now() }); }
  catch (error) {
    const code = String((error as any)?.code ?? "perpl_direct_scenario_policy_rejected");
    await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
      expectedStepIndex: scenario.stepIndex, status: "blocked", errorCode: code });
    return result(input, "blocked", "active", { errorCode: code });
  }
  let submitted;
  try { submitted = await submitDirectPolicyAction({ provider: input.provider, run, action, market, account,
    idempotencyKey: `${scenario.scenarioId}:step:${scenario.stepIndex}` }); }
  catch (error) {
    const code = String((error as any)?.code ?? "perpl_direct_order_rejected");
    await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
      expectedStepIndex: scenario.stepIndex, status: "blocked", errorCode: code });
    return result(input, "blocked", "active", { errorCode: code });
  }
  await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
    expectedStepIndex: scenario.stepIndex, status: "dispatch", activeOrderId: submitted.orderId,
    activeRequestId: submitted.requestId, activeActionKind: action.kind });
  return result(input, "order_submitted", "active", { kind: action.kind, localOrderId: submitted.orderId,
    txHash: submitted.txHash, phase: submitted.phase });
}
