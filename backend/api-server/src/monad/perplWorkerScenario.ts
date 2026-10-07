import { assertMonadBroadcastEnabled } from "./config.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { perplExecutionEnabled } from "./perplConfig.js";
import { readPerplVenueMarkets } from "./perplVenueOperations.js";
import { buildPerplScenarioAction, parseActions, perplScenarioOrderProgress } from "./perplScenarioPolicy.js";
import { submitPerplPolicyAction } from "./perplWorkerOrderFlow.js";
import { event, waitResult, type TickResult } from "./perplWorkerHelpers.js";
import type { VenueAccountSnapshot, VenueMarket } from "./venueTypes.js";

type ScenarioInput = { provider: any; run: any; scenario: any; account: VenueAccountSnapshot; markets: VenueMarket[];
  credentials: { apiKey: string; privateKeyHex: string; walletAddress?: string }; tickId: string; now: number };

export async function runPerplScenarioTick(input: ScenarioInput): Promise<TickResult> {
  const { scenario, run, account, markets, credentials, tickId, now } = input;
  if (scenario.status === "queued") return await dispatchScenarioStep(input);
  if (!scenario.activeOrderId) return await blockScenario(scenario, "perpl_scenario_order_missing", tickId);
  const order: any = await operatorQuery("monadVenueOrders", "getOrder", { orderId: scenario.activeOrderId });
  const actions = parseActions(scenario.actions);
  const progress = perplScenarioOrderProgress(scenario, order, actions);
  if (scenario.status === "cancel_pending") {
    if (progress.kind === "canceled") return await finishScenarioCancel(scenario, tickId);
    if (scenario.activeActionKind === "scenario_cancel_order") return await waitScenario(scenario, progress, account, tickId);
    if (progress.kind === "cancel_order") return await cancelScenarioOrder(input, order);
    return await waitScenario(scenario, progress, account, tickId);
  }
  if (progress.kind === "uncertain" || progress.kind === "wait") return await waitScenario(scenario, progress, account, tickId);
  if (progress.kind === "blocked") return await blockScenario(scenario, progress.errorCode ?? "perpl_scenario_action_blocked", tickId);
  if (progress.kind === "canceled") return await finishScenarioCancel(scenario, tickId);
  const venueOrderId = positiveNumber(order.orderIdAtVenue);
  const advanced: any = await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
    expectedStepIndex: scenario.stepIndex, status: "advance", ...(venueOrderId ? { venueOrderId } : {}) });
  const completed = advanced?.status === "completed";
  return { status: "active", phase: completed ? "scenario_completed" : "scenario_step_advanced",
    patch: { scenarioId: scenario.scenarioId, scenarioStatus: advanced?.status, scenarioStep: advanced?.stepIndex },
    event: event(`${scenario.scenarioId}:${scenario.stepIndex}:advanced:${tickId}`, completed ? "perpl_scenario_completed" : "perpl_scenario_step_advanced",
      completed ? "completed" : "observed", completed ? "Perpl scenario completed" : "Perpl scenario step finalized",
      { scenarioId: scenario.scenarioId, stepIndex: scenario.stepIndex, requestId: order.requestId, orderId: venueOrderId }),
    continueAfter: true, nextDelayMs: 5_000 };
}

async function dispatchScenarioStep(input: ScenarioInput): Promise<TickResult> {
  const { scenario, run, account, markets, credentials, now } = input;
  if (Number(scenario.nextAt ?? 0) > now) return waitResult("active", "scenario_interval_wait",
    { scenarioId: scenario.scenarioId, scenarioStep: scenario.stepIndex }, Math.min(5_000, Number(scenario.nextAt) - now));
  const raw = parseActions(scenario.actions)[scenario.stepIndex];
  const market = markets.find((item) => item.id === Number(raw?.marketId));
  if (!market) return await blockScenario(scenario, "perpl_scenario_market_unavailable", input.tickId);
  let action;
  try { action = buildPerplScenarioAction({ scenario, run, account, market, now }); }
  catch (error) { return await blockScenario(scenario, safeCode(error), input.tickId); }
  const entry = ["market_entry", "limit_entry"].includes(action.kind);
  if (entry && !perplExecutionEnabled()) return await blockScenario(scenario, "perpl_execution_gate_disabled", input.tickId);
  try { assertMonadBroadcastEnabled(true); }
  catch { return await blockScenario(scenario, "perpl_broadcast_gate_disabled", input.tickId); }
  let submitted: any;
  try {
    submitted = await submitPerplPolicyAction({ run, action, market, account, credentials,
      idempotencyKey: `${scenario.scenarioId}:step:${scenario.stepIndex}` });
  } catch (error) { return await blockScenario(scenario, safeCode(error), input.tickId); }
  await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
    expectedStepIndex: scenario.stepIndex, status: "dispatch", activeOrderId: submitted.orderId,
    activeRequestId: submitted.requestId, activeActionKind: action.kind });
  const kind = submitted.phase === "uncertain" ? "perpl_scenario_action_uncertain" : "perpl_scenario_action_submitted";
  if (submitted.phase === "failed") return await blockScenario(scenario, "perpl_scenario_action_failed", input.tickId);
  if (submitted.phase === "uncertain") await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
    expectedStepIndex: scenario.stepIndex, status: "uncertain", errorCode: "perpl_scenario_action_uncertain" });
  return { status: "active", phase: submitted.phase === "uncertain" ? "scenario_action_uncertain" : "scenario_action_submitted",
    patch: { scenarioId: scenario.scenarioId, scenarioStatus: "running", scenarioStep: scenario.stepIndex },
    event: event(`${scenario.scenarioId}:${scenario.stepIndex}:dispatch:${input.tickId}`, kind, submitted.phase,
      `Perpl scenario ${action.kind} ${submitted.phase.replaceAll("_", " ")}`,
      { scenarioId: scenario.scenarioId, stepIndex: scenario.stepIndex, action: action.kind, requestId: submitted.requestId,
        orderId: submitted.venueOrderId, localOrderId: submitted.orderId, reasonCode: submitted.phase === "uncertain" ? "perpl_scenario_action_uncertain" : undefined }),
    continueAfter: true, nextDelayMs: 5_000 };
}

async function cancelScenarioOrder(input: ScenarioInput, originalOrder: any): Promise<TickResult> {
  const oid = positiveNumber(originalOrder.orderIdAtVenue);
  const marketId = Number(originalOrder.actionJson ? JSON.parse(originalOrder.actionJson).marketId : 0);
  if (!oid || !Number.isSafeInteger(marketId)) return await blockScenario(input.scenario, "perpl_scenario_cancel_order_identity_missing", input.tickId);
  const liveOrder = input.account.orders.some((item: any) => Number(item.oid) === oid);
  if (!liveOrder) return await finishScenarioCancel(input.scenario, input.tickId);
  const market = input.markets.find((item) => item.id === marketId) ?? (await readPerplVenueMarkets({ marketIds: [marketId] }))[0];
  if (!market) return await blockScenario(input.scenario, "perpl_scenario_cancel_market_missing", input.tickId);
  try { assertMonadBroadcastEnabled(true); }
  catch { return waitResult("active", "scenario_cancel_waiting_for_gates", { scenarioId: input.scenario.scenarioId,
    recoveryReason: "perpl_broadcast_gate_disabled" }, 5_000); }
  const action: any = { kind: "cancel_limit", marketId, accountId: input.account.accountId, orderId: oid,
    size: 0, leverage: 0, allowedMarketIds: parseMarketIds(input.run.marketIdsJson) };
  const submitted: any = await submitPerplPolicyAction({ run: input.run, action, market, account: input.account,
    credentials: input.credentials, idempotencyKey: `${input.scenario.scenarioId}:cancel:${input.scenario.activeRequestId}` });
  await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: input.scenario.scenarioId,
    expectedStepIndex: input.scenario.stepIndex, status: "cancel_dispatch", activeOrderId: submitted.orderId,
    activeRequestId: submitted.requestId, activeActionKind: "scenario_cancel_order", venueOrderId: oid });
  return waitResult("active", submitted.phase === "uncertain" ? "scenario_cancel_uncertain" : "scenario_cancel_submitted",
    { scenarioId: input.scenario.scenarioId, requestId: submitted.requestId, phase: submitted.phase }, 5_000);
}

async function waitScenario(scenario: any, progress: any, account: VenueAccountSnapshot, tickId: string): Promise<TickResult> {
  if (progress.kind === "uncertain") await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
    expectedStepIndex: scenario.stepIndex, status: "uncertain", errorCode: "perpl_scenario_action_uncertain" });
  return { status: "active", phase: progress.kind === "uncertain" ? "scenario_action_uncertain" : "scenario_action_reconciling",
    patch: { balanceUnits: account.balanceUnits, equityUnits: account.balanceUnits, scenarioId: scenario.scenarioId,
      scenarioStatus: scenario.status, scenarioStep: scenario.stepIndex },
    event: event(`${scenario.scenarioId}:${scenario.stepIndex}:${progress.kind}:${tickId}`,
      progress.kind === "uncertain" ? "perpl_scenario_action_uncertain" : "perpl_scenario_action_reconciling",
      progress.kind, "Perpl scenario request is being reconciled before another action", { scenarioId: scenario.scenarioId,
        stepIndex: scenario.stepIndex, activeOrderId: scenario.activeOrderId }), continueAfter: true, nextDelayMs: 5_000 };
}

async function blockScenario(scenario: any, errorCode: string, tickId: string): Promise<TickResult> {
  await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
    expectedStepIndex: scenario.stepIndex, status: "blocked", errorCode });
  return { status: "active", phase: "scenario_blocked", patch: { scenarioId: scenario.scenarioId, scenarioStatus: "blocked" },
    event: event(`${scenario.scenarioId}:${scenario.stepIndex}:blocked:${tickId}`, "perpl_scenario_blocked", "blocked",
      `Perpl scenario stopped: ${errorCode.replaceAll("_", " ")}`, { scenarioId: scenario.scenarioId, stepIndex: scenario.stepIndex, errorCode }),
    continueAfter: true, nextDelayMs: 5_000 };
}

async function finishScenarioCancel(scenario: any, tickId: string): Promise<TickResult> {
  await operatorMutation("monadVenueScenarios", "advanceScenario", { scenarioId: scenario.scenarioId,
    expectedStepIndex: scenario.stepIndex, status: "finish_cancelled" });
  return { status: "active", phase: "scenario_canceled", patch: { scenarioId: scenario.scenarioId, scenarioStatus: "canceled" },
    event: event(`${scenario.scenarioId}:cancelled:${tickId}`, "perpl_scenario_canceled", "canceled",
      "Perpl scenario canceled and its pending scenario order reconciled", { scenarioId: scenario.scenarioId }),
    continueAfter: true, nextDelayMs: 5_000 };
}

function safeCode(error: unknown) { return /^[a-z0-9_]{3,100}$/.test(String((error as any)?.code ?? "")) ? String((error as any).code) : "perpl_scenario_action_invalid"; }
function positiveNumber(value: unknown) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : undefined; }
function parseMarketIds(value: string) { try { return JSON.parse(value).filter(Number.isSafeInteger); } catch { return []; } }
