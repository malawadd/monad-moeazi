import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { appendMonadActivity, requireMonadOperator } from "./monadHelpers";

const internalApi: any = internal;

async function run(ctx: any, runId: string) {
  return await ctx.db.query("monadVenueRuns").withIndex("by_runId", (q: any) => q.eq("runId", runId)).first();
}
async function order(ctx: any, orderId: string) {
  return await ctx.db.query("monadVenueOrders").withIndex("by_orderId", (q: any) => q.eq("orderId", orderId)).first();
}

/** Reserve and persist rq before sending. A retry receives the same order row and rq. */
export const reserveRequestId = mutation({ args: { runId: v.string(), idempotencyKey: v.string(), accountId: v.number(),
  accountLastRequestId: v.number(), kind: v.string(), actionJson: v.string(), rawRequestJson: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const ownerRun = await run(ctx, args.runId);
  if (!ownerRun || !["perpl-testnet-v1", "perpl-direct-testnet-v1"].includes(ownerRun.venueId) || !Number.isSafeInteger(args.accountId) || args.accountId <= 0
    || !Number.isSafeInteger(args.accountLastRequestId) || args.accountLastRequestId < 0 || args.actionJson.length > 10_000
    || args.rawRequestJson.length > 20_000 || !/^[A-Za-z0-9._:-]{8,180}$/.test(args.idempotencyKey)) throw new Error("Perpl order request is invalid.");
  const prior = await ctx.db.query("monadVenueOrders").withIndex("by_idempotencyKey", (q: any) => q.eq("idempotencyKey", args.idempotencyKey)).first();
  if (prior) {
    if (prior.runId !== args.runId || prior.actionJson !== args.actionJson) throw new Error("Perpl order idempotency key was reused for different terms.");
    return { orderId: prior.orderId, requestId: prior.requestId, status: prior.status, rawRequestJson: prior.rawRequestJson };
  }
  const counter = await ctx.db.query("monadVenueRequestCounters").withIndex("by_account", (q: any) =>
    q.eq("venueId", ownerRun.venueId).eq("accountId", args.accountId)).first();
  const requestId = Math.max(args.accountLastRequestId, counter?.lastRequestId ?? 0) + 1;
  if (!Number.isSafeInteger(requestId)) throw new Error("Perpl account request counter is exhausted.");
  let request: any; try { request = JSON.parse(args.rawRequestJson); } catch { throw new Error("Perpl wire order is invalid."); }
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Perpl wire order is invalid.");
  request.rq = requestId;
  const persistedRequest = JSON.stringify(request);
  const now = Date.now();
  if (counter) await ctx.db.patch(counter._id, { lastRequestId: requestId, updatedAt: now });
  else await ctx.db.insert("monadVenueRequestCounters", { venueId: ownerRun.venueId, accountId: args.accountId, lastRequestId: requestId, updatedAt: now });
  const orderId = `${args.runId}:${requestId}`;
  await ctx.db.insert("monadVenueOrders", { orderId, runId: args.runId, venueId: ownerRun.venueId,
    ownerAddress: ownerRun.ownerAddress, accountId: args.accountId, requestId, idempotencyKey: args.idempotencyKey,
    kind: args.kind, status: "prepared", actionJson: args.actionJson, rawRequestJson: persistedRequest, createdAt: now, updatedAt: now });
  return { orderId, requestId, status: "prepared", rawRequestJson: persistedRequest };
} });

export const markDispatchStarted = mutation({ args: { orderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await order(ctx, args.orderId); if (!row) throw new Error("Perpl order was not found.");
  if (row.status !== "prepared" || row.dispatchStartedAt) return { dispatch: false, reason: row.dispatchStartedAt ? "already_dispatched" : row.status };
  await ctx.db.patch(row._id, { dispatchStartedAt: Date.now(), updatedAt: Date.now() });
  return { dispatch: true, requestId: row.requestId };
} });

/** Persist the exact signed operator transaction before any direct broadcast. */
export const storeDirectTransaction = mutation({ args: { orderId: v.string(), rawTransaction: v.string(), txHash: v.string(),
  nonce: v.number(), orderDescJson: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await order(ctx, args.orderId);
  if (!row || row.venueId !== "perpl-direct-testnet-v1" || row.status !== "prepared"
    || !/^0x[0-9a-f]+$/i.test(args.rawTransaction) || args.rawTransaction.length > 300_000
    || !/^0x[0-9a-f]{64}$/i.test(args.txHash) || !Number.isSafeInteger(args.nonce) || args.nonce < 0
    || args.orderDescJson.length > 10_000) {
    throw new Error("Direct Perpl signed order is invalid.");
  }
  if (row.rawTransaction) {
    if (row.rawTransaction !== args.rawTransaction || row.txHash !== args.txHash.toLowerCase() || row.operatorNonce !== args.nonce
      || row.rawRequestJson !== args.orderDescJson) {
      throw new Error("Direct Perpl order already has different signed bytes.");
    }
    return { orderId: row.orderId, txHash: row.txHash, nonce: row.operatorNonce };
  }
  await ctx.db.patch(row._id, { rawTransaction: args.rawTransaction, txHash: args.txHash.toLowerCase(),
    rawRequestJson: args.orderDescJson, operatorNonce: args.nonce, updatedAt: Date.now() });
  return { orderId: row.orderId, txHash: args.txHash.toLowerCase(), nonce: args.nonce };
} });

export const getOrder = query({ args: { orderId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); return await order(ctx, args.orderId);
} });
export const getOrders = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); return await ctx.db.query("monadVenueOrders").withIndex("by_runId_createdAt", (q: any) => q.eq("runId", args.runId)).order("asc").collect();
} });

export const updateOrder = mutation({ args: { orderId: v.string(), status: v.string(), rawResponseJson: v.optional(v.string()),
  orderIdAtVenue: v.optional(v.string()), txHash: v.optional(v.string()), blockNumber: v.optional(v.number()),
  blockHash: v.optional(v.string()), finalizedAt: v.optional(v.number()),
  fillsJson: v.optional(v.string()), errorCode: v.optional(v.string()) }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); const row = await order(ctx, args.orderId); if (!row) throw new Error("Perpl order was not found.");
  const phases = ["prepared", "accepted_for_forwarding", "submitted", "executed", "partially_filled", "filled", "finalized", "no_fill", "canceled", "failed", "uncertain"];
  if (!phases.includes(args.status) || ["finalized", "no_fill", "failed", "canceled"].includes(row.status) && row.status !== args.status
    || (args.rawResponseJson?.length ?? 0) > 40_000 || (args.fillsJson?.length ?? 0) > 40_000
    || args.blockHash !== undefined && !/^0x[a-f0-9]{64}$/i.test(args.blockHash)
    || args.finalizedAt !== undefined && (!Number.isSafeInteger(args.finalizedAt) || args.finalizedAt <= 0 || args.finalizedAt > Date.now() + 60_000)
    || args.status === "finalized" && row.venueId === "perpl-direct-testnet-v1"
      && (!args.blockHash || !Number.isSafeInteger(args.blockNumber) || !args.txHash || args.txHash !== row.txHash
        || !args.finalizedAt)) throw new Error("Perpl order state transition is invalid.");
  await ctx.db.patch(row._id, { status: args.status, rawResponseJson: args.rawResponseJson ?? row.rawResponseJson,
    orderIdAtVenue: args.orderIdAtVenue ?? row.orderIdAtVenue, txHash: args.txHash ?? row.txHash,
    blockNumber: args.blockNumber ?? row.blockNumber, blockHash: args.blockHash ?? row.blockHash,
    finalizedAt: args.finalizedAt ?? row.finalizedAt, fillsJson: args.fillsJson ?? row.fillsJson,
    errorCode: args.errorCode ?? (args.status === "finalized" ? undefined : row.errorCode), updatedAt: Date.now() });
  if (args.status !== row.status) await persistOrderEvent(ctx, row, args);
  return { orderId: row.orderId, requestId: row.requestId, status: args.status };
} });

export const getOrderByRequestId = query({ args: { venueId: v.string(), accountId: v.number(), requestId: v.number() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx); return await ctx.db.query("monadVenueOrders").withIndex("by_account_request", (q: any) =>
    q.eq("venueId", args.venueId).eq("accountId", args.accountId).eq("requestId", args.requestId)).first();
} });

function perplOrderSummary(status: string) {
  const labels: Record<string, string> = { accepted_for_forwarding: "Perpl accepted the order for forwarding; no fill is confirmed.",
    submitted: "Perpl order transaction was broadcast; no execution is confirmed.", executed: "Perpl order transaction executed; finality is pending.", partially_filled: "Perpl reported a partial fill.",
    filled: "Perpl reported a fill; waiting for Monad finality.", finalized: "Perpl order transaction reached Monad finality.",
    no_fill: "Direct Perpl transaction finalized with a verified market order no-fill; no cycle was consumed.",
    canceled: "Perpl order was canceled.", failed: "Perpl order was rejected or failed.", uncertain: "Perpl order result is uncertain and must be reconciled." };
  return labels[status] ?? `Perpl order status: ${status}`;
}

async function persistOrderEvent(ctx: any, orderRow: any, args: any) {
  const runRow = await run(ctx, orderRow.runId); if (!runRow) throw new Error("Perpl run was not found for order activity.");
  const eventId = `${orderRow.venueId}:${orderRow.runId}:order:${orderRow.requestId}:${args.status}`;
  const prior = await ctx.db.query("monadVenueEvents").withIndex("by_eventId", (q: any) => q.eq("eventId", eventId)).first();
  if (prior) return;
  const details = { requestId: orderRow.requestId, kind: orderRow.kind, orderId: args.orderIdAtVenue ?? orderRow.orderIdAtVenue,
    fills: args.fillsJson ? JSON.parse(args.fillsJson) : undefined, errorCode: args.errorCode };
  const dataJson = JSON.stringify({ ...details, response: args.rawResponseJson ? JSON.parse(args.rawResponseJson) : undefined }).slice(0, 20_000);
  const timestamp = Date.now(); const summary = orderRow.venueId === "perpl-direct-testnet-v1" && args.status === "finalized"
    ? "Direct Perpl order and resulting account state were verified at Monad finality." : perplOrderSummary(args.status);
  await ctx.db.insert("monadVenueEvents", { eventId, runId: runRow.runId, venueId: orderRow.venueId,
    userId: runRow.userId, ownerAddress: runRow.ownerAddress, kind: `perpl_order_${args.status}`, status: args.status,
    summary, timestamp, orderId: String(details.orderId ?? orderRow.orderId), ...(args.txHash ? { txHash: args.txHash } : {}),
    ...(args.blockNumber !== undefined ? { blockNumber: args.blockNumber } : {}),
    ...(args.blockHash ? { blockHash: args.blockHash } : {}), ...(args.finalizedAt ? { finalizedAt: args.finalizedAt } : {}), dataJson });
  await appendMonadActivity(ctx, { userId: runRow.userId, ownerAddress: runRow.ownerAddress, activityId: eventId,
    kind: `perpl_order_${args.status}`, status: args.status, summary, venueId: orderRow.venueId,
    txHash: args.txHash, dataJson });
  if (args.status === "finalized" && orderRow.venueId === "perpl-direct-testnet-v1"
      && args.blockHash && args.finalizedAt && args.txHash && args.blockNumber !== undefined) {
    const action = JSON.parse(orderRow.actionJson);
    const response = args.rawResponseJson ? JSON.parse(args.rawResponseJson) : {};
    const fills = args.fillsJson ? JSON.parse(args.fillsJson) : [];
    const before = BigInt(response.beforePositionSize ?? "0");
    const after = BigInt(response.afterPositionSize ?? "0");
      const entry = ["market_entry", "limit_entry"].includes(String(action.kind));
      const closing = ["close_position", "reduce_size"].includes(String(action.kind));
      const verified = response.transport === "direct" && response.receiptStatus === 1
        && Number(response.finalizedAccountBlock) >= args.blockNumber && fills.length > 0
        && Number(response.exchangeRequest?.perpId) === Number(action.marketId)
        && (entry && after > before || closing && after < before);
    if (verified) {
      const kind = entry ? "autonomous_entry" : "autonomous_close";
      const symbol = String(action.symbol ?? `Perpl ${action.marketId}`).slice(0, 48);
      const detail = entry ? `${symbol} ${action.side ?? "position"} opened with ${fills.length} finalized fill(s).`
        : `${symbol} ${action.side ?? "position"} closed; finalized exchange position state verified.`;
      await ctx.scheduler.runAfter(0, internalApi.mobileNotifications.enqueueFinalizedEvent, {
        ownerAddress: runRow.ownerAddress, eventId, eventKind: kind,
        title: entry ? `Autonomous ${symbol} entry finalized` : `Autonomous ${symbol} close finalized`,
        summary: detail, redactedSummary: entry ? "A Perpl position opened." : "A Perpl position closed.",
        finalityRef: `${args.txHash}:${args.blockHash}:${args.blockNumber}`, finalizedAt: args.finalizedAt,
      });
    }
  }
}
