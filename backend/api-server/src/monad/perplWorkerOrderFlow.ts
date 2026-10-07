import { operatorMutation, operatorQuery } from "./convex.js";
import { PerplApiError } from "./perplConfig.js";
import { toPerplOrderSpec } from "./perplVenue.js";
import { reconcilePerplVenueAction, submitPerplVenueAction } from "./perplVenueOperations.js";
import type { VenueAction, VenueAccountSnapshot, VenueMarket, VenueOrderPhase } from "./venueTypes.js";
import type { PerplCredentials } from "./perplApi.js";

export async function reconcilePendingPerplOrders(runId: string, accountId: number, credentials: PerplCredentials,
  allowedActiveOrderIds: string[] = []) {
  const orders: any[] = await operatorQuery("monadVenueOrders", "getOrders", { runId });
  for (const row of orders) {
    if (["finalized", "failed", "canceled"].includes(row.status)) continue;
    if (!row.dispatchStartedAt && row.status === "prepared") continue;
    try {
      const result = await reconcilePerplVenueAction(row.requestId, accountId, credentials);
      const order: any = result.order; const txHash = String(order?.at?.txid ?? "");
      await operatorMutation("monadVenueOrders", "updateOrder", { orderId: row.orderId, status: result.phase,
        rawResponseJson: JSON.stringify(result.rawResponse).slice(0, 39_000), orderIdAtVenue: order?.oid === undefined ? undefined : String(order.oid),
        ...(txHash ? { txHash } : {}), ...(Number.isSafeInteger(Number(order?.at?.b)) ? { blockNumber: Number(order.at.b) } : {}),
        fillsJson: JSON.stringify(result.fills).slice(0, 39_000) });
      if (!terminalVenuePhase(result.phase) && !allowedActiveOrderIds.includes(row.orderId)) {
        return { complete: false, phase: result.phase, orderId: row.orderId };
      }
    } catch {
      await operatorMutation("monadVenueOrders", "updateOrder", { orderId: row.orderId, status: "uncertain", errorCode: "perpl_reconcile_unavailable" });
      return { complete: false, phase: "uncertain", orderId: row.orderId };
    }
  }
  return { complete: true };
}

export async function submitPerplPolicyAction(input: { run: any; action: VenueAction; market: VenueMarket;
  account: VenueAccountSnapshot; credentials: PerplCredentials; idempotencyKey: string }) {
  const action = { ...input.action, accountId: input.account.accountId };
  const wireTemplate = toPerplOrderSpec({ ...action, requestId: 1 }, input.market);
  const reserved: any = await operatorMutation("monadVenueOrders", "reserveRequestId", { runId: input.run.runId,
    idempotencyKey: input.idempotencyKey, accountId: input.account.accountId, accountLastRequestId: input.account.lastRequestId,
    kind: action.kind, actionJson: JSON.stringify(action), rawRequestJson: JSON.stringify(wireTemplate) });
  const current: any = await operatorQuery("monadVenueOrders", "getOrder", { orderId: reserved.orderId });
  if (current?.dispatchStartedAt) {
    try {
      const reconciled = await reconcilePerplVenueAction(reserved.requestId, input.account.accountId, input.credentials);
      const order: any = reconciled.order;
      await operatorMutation("monadVenueOrders", "updateOrder", { orderId: reserved.orderId, status: reconciled.phase,
        rawResponseJson: JSON.stringify(reconciled.rawResponse).slice(0, 39_000), orderIdAtVenue: order?.oid === undefined ? undefined : String(order.oid),
        ...(order?.at?.txid ? { txHash: String(order.at.txid) } : {}), fillsJson: JSON.stringify(reconciled.fills).slice(0, 39_000) });
      return { phase: reconciled.phase, requestId: reserved.requestId, orderId: reserved.orderId,
        venueOrderId: order?.oid === undefined ? undefined : String(order.oid) };
    } catch {
      await operatorMutation("monadVenueOrders", "updateOrder", { orderId: reserved.orderId, status: "uncertain", errorCode: "perpl_reconcile_unavailable" });
      return { phase: "uncertain" as const, requestId: reserved.requestId, orderId: reserved.orderId };
    }
  }
  const started = await operatorMutation("monadVenueOrders", "markDispatchStarted", { orderId: reserved.orderId });
  if (!started?.dispatch) return { phase: "uncertain" as const, requestId: reserved.requestId, orderId: reserved.orderId };
  try {
    const result = await submitPerplVenueAction({ ...action, requestId: reserved.requestId }, input.credentials);
    await operatorMutation("monadVenueOrders", "updateOrder", { orderId: reserved.orderId, status: result.phase,
      rawResponseJson: JSON.stringify(result.rawResponse).slice(0, 39_000),
      ...(venueOrderId(result.rawResponse) ? { orderIdAtVenue: venueOrderId(result.rawResponse) } : {}) });
    return { phase: result.phase, requestId: reserved.requestId, orderId: reserved.orderId,
      venueOrderId: venueOrderId(result.rawResponse) };
  } catch (error) {
    const reconciliation = await safeReconcile(reserved.requestId, input.account.accountId, input.credentials);
    const phase = reconciliation?.phase ?? (error instanceof PerplApiError && !error.retryable ? "failed" : "uncertain");
    await operatorMutation("monadVenueOrders", "updateOrder", { orderId: reserved.orderId, status: phase,
      errorCode: error instanceof PerplApiError ? error.code : "perpl_submit_uncertain" });
    return { phase, requestId: reserved.requestId, orderId: reserved.orderId };
  }
}

async function safeReconcile(requestId: number, accountId: number, credentials: PerplCredentials) {
  try { return await reconcilePerplVenueAction(requestId, accountId, credentials); } catch { return null; }
}
function venueOrderId(raw: any) {
  const updates = raw?.updates; const order = Array.isArray(updates) ? updates.at(-1) : null;
  return order?.oid === undefined ? undefined : String(order.oid);
}
function terminalVenuePhase(phase: VenueOrderPhase) { return ["finalized", "failed", "canceled"].includes(phase); }
