import { validatePerplAction } from "./perplPolicy.js";
import type { VenueAction, VenueAccountSnapshot, VenueMarket } from "./venueTypes.js";

export type PerplScenarioAction = Record<string, any> & { kind: string; marketId: number };
export type PerplScenarioProgress = { kind: "advance" | "wait" | "uncertain" | "blocked" | "canceled" | "cancel_order"; errorCode?: string };

export function buildPerplScenarioAction(input: { scenario: any; run: any; account: VenueAccountSnapshot;
  market: VenueMarket; now: number }): VenueAction {
  const { scenario, run, account, market, now } = input;
  if (!scenario || !["queued", "running"].includes(scenario.status)) throw scenarioError("perpl_scenario_not_queued");
  const steps = parseActions(scenario.actions);
  const raw = steps[scenario.stepIndex];
  if (!raw || !allowed(raw.kind)) throw scenarioError("perpl_scenario_action_invalid");
  const allowedMarketIds = parseMarketIds(run.marketIdsJson);
  if (!allowedMarketIds.includes(Number(raw.marketId)) || Number(raw.marketId) !== market.id) throw scenarioError("perpl_scenario_market_not_allowed");
  const position: any = account.positions[0];
  const previousOrderId = safePositive(scenario.lastVenueOrderId);
  const orderId = raw.orderId === undefined || raw.orderId === "previous" ? previousOrderId : safePositive(raw.orderId);
  const isClose = ["close_position", "reduce_size"].includes(raw.kind);
  const side = raw.side ?? (isClose ? Number(position?.sd) === 2 ? "short" : "long" : undefined);
  const action: VenueAction = { kind: raw.kind, marketId: market.id, accountId: account.accountId,
    side, size: raw.kind === "cancel_limit" ? 0 : Number(raw.size ?? (raw.kind === "close_position" ? position?.s : 0)),
    price: Number(raw.price ?? 0), leverage: Number(raw.leverage ?? (position ? Math.max(1, Math.round(Number(position.lv ?? 100) / 100)) : 0)),
    ...(orderId ? { orderId } : {}), ...(raw.linkedRequestId ? { linkedRequestId: safePositive(raw.linkedRequestId) } : {}),
    ...(raw.linkedPositionId ? { linkedPositionId: safePositive(raw.linkedPositionId) } : {}),
    ...(raw.triggerPrice !== undefined ? { triggerPrice: Number(raw.triggerPrice) } : {}),
    ...(raw.triggerCondition !== undefined ? { triggerCondition: Number(raw.triggerCondition) } : {}),
    ...(raw.collateralAmount !== undefined ? { collateralAmount: String(raw.collateralAmount) } : {}),
    ...(raw.flags !== undefined ? { flags: Number(raw.flags) } : {}),
    allowedMarketIds, activePositionCount: account.positions.length,
    maxCollateralUnits: (BigInt(run.amountUnits) / 4n < BigInt(account.balanceUnits)
      ? BigInt(run.amountUnits) / 4n : BigInt(account.balanceUnits)).toString(),
    maxExposureUnits: String(run.maxPositionExposureUnits), maxLeverage: Number(run.maxLeverage),
    maxSlippageBps: Math.min(100, Number(raw.maxSlippageBps ?? 100)), expiresAt: Number(run.expiresAt ?? 0) };
  if (["cancel_limit", "amend_limit"].includes(raw.kind) && !action.orderId) throw scenarioError("perpl_scenario_order_reference_missing");
  if (raw.kind === "add_margin" && BigInt(action.collateralAmount ?? "0") > BigInt(run.amountUnits)) throw scenarioError("perpl_scenario_margin_cap_exceeded");
  if (raw.kind === "linked_exit" && (!Number.isSafeInteger(action.triggerPrice) || Number(action.triggerPrice) <= 0)) throw scenarioError("perpl_scenario_trigger_invalid");
  // The venue adapter repeats this check with the real, persisted rq immediately before send.
  validatePerplAction({ ...action, requestId: account.lastRequestId + 1 }, market, account, now);
  return action;
}

export function perplScenarioOrderProgress(scenario: any, order: any, actions: PerplScenarioAction[]): PerplScenarioProgress {
  if (scenario?.status === "canceled") return { kind: "canceled" };
  if (!scenario?.activeOrderId || !order) return { kind: "blocked", errorCode: "perpl_scenario_order_missing" };
  if (scenario.status === "cancel_pending" && scenario.activeActionKind === "scenario_cancel_order") {
    if (["finalized", "canceled"].includes(order.status)) return { kind: "canceled" };
    if (order.status === "failed") return { kind: "blocked", errorCode: "perpl_scenario_cancel_failed" };
    return { kind: "uncertain" };
  }
  if (scenario.status === "cancel_pending") {
    if (["failed", "canceled"].includes(order.status)) return { kind: "canceled" };
    const mayStillBeOpen = ["limit_entry", "amend_limit"].includes(scenario.activeActionKind);
    if (order.status === "finalized" && !mayStillBeOpen) return { kind: "canceled" };
    return { kind: safePositive(order.orderIdAtVenue) ? "cancel_order" : "uncertain" };
  }
  if (order.status === "uncertain" || order.status === "prepared") {
    return { kind: "uncertain" };
  }
  if (order.status === "failed") return { kind: "blocked", errorCode: order.errorCode ?? "perpl_scenario_action_failed" };
  const current = actions[scenario.stepIndex];
  if (order.status === "canceled") return current?.kind === "cancel_limit"
    ? { kind: "advance" } : { kind: "blocked", errorCode: "perpl_scenario_order_canceled" };
  if (["partially_filled", "filled"].includes(order.status)) {
    const next = actions[scenario.stepIndex + 1];
    if (current?.kind === "limit_entry" && next && ["cancel_limit", "amend_limit"].includes(next.kind)
      && safePositive(order.orderIdAtVenue)) return { kind: "advance" };
    return { kind: "wait" };
  }
  if (order.status === "accepted_for_forwarding") {
    const next = actions[scenario.stepIndex + 1];
    if (["limit_entry", "amend_limit"].includes(actions[scenario.stepIndex]?.kind)
      && next && ["cancel_limit", "amend_limit"].includes(next.kind) && safePositive(order.orderIdAtVenue)) return { kind: "advance" };
    return { kind: "wait" };
  }
  if (order.status === "finalized") return { kind: "advance" };
  if (["submitted"].includes(order.status)) {
    const next = actions[scenario.stepIndex + 1];
    if (["limit_entry", "amend_limit"].includes(current?.kind) && next && ["cancel_limit", "amend_limit"].includes(next.kind)
      && safePositive(order.orderIdAtVenue)) return { kind: "advance" };
    return { kind: "wait" };
  }
  return { kind: "uncertain" };
}

export function parseActions(value: unknown): PerplScenarioAction[] {
  let actions: any;
  try { actions = typeof value === "string" ? JSON.parse(value) : value; } catch { return []; }
  return Array.isArray(actions) ? actions.filter((item) => item && typeof item === "object") : [];
}
function parseMarketIds(value: string) { try { return JSON.parse(value).filter(Number.isSafeInteger); } catch { return []; } }
function safePositive(value: unknown): number | undefined {
  const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
function allowed(kind: string) { return ["market_entry", "limit_entry", "close_position", "reduce_size", "cancel_limit", "amend_limit", "linked_exit", "add_margin"].includes(kind); }
function scenarioError(code: string): Error { return Object.assign(new Error(code), { code }); }
