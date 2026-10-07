import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendMonadActivity, requireMeraViewer } from "./monadHelpers";

const activeStatuses = ["activation_pending", "active", "stopping", "settling", "uncertain"];
const parse = (text?: string) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

function runDto(row: any, events: any[]) {
  return { runId: row.runId, enrollmentId: row.runId, status: row.status, ownerAddress: row.ownerAddress,
    vaultAddress: row.vaultAddress, clearinghouseAddress: row.clearinghouseAddress, chainId: row.chainId,
    policyVersion: row.policyVersion, startingUsdcUnits: row.amountUnits,
    availableUsdcUnits: row.availableUsdcUnits ?? "0", realizedPnlUsdcUnits: row.realizedPnlUsdcUnits ?? "0",
    returnedUsdcUnits: row.returnedUsdcUnits ?? null,
    unrealizedPnlUsdcUnits: row.unrealizedPnlUsdcUnits ?? "0", operatorGasMonWei: row.operatorGasMonWei ?? "0",
    markPriceWad: row.markPriceWad ?? null, equityUsdcUnits: row.equityUsdcUnits ?? null,
    activatedAt: row.activatedAt ?? null, expiresAt: row.expiresAt ?? null, stoppedAt: row.stoppedAt ?? null,
    lastFinalizedBlock: row.lastObservedBlock ?? null, position: parse(row.positionJson),
    pendingOrder: parse(row.pendingOrderJson), markets: parse(row.marketsJson) ?? [],
    fundingStatus: row.fundingStatus ?? null,
    fundingTransactionHash: ["submitted", "executed", "finalized", "uncertain"].includes(row.fundingStatus) ? row.fundingTxHash ?? null : null,
    events: events.map((event) => ({ id: event.eventId, type: event.type, status: event.status,
      summary: event.summary, timestamp: new Date(event.timestamp).toISOString(), orderId: event.orderId ?? null,
      transactionHash: event.txHash ?? null, finalizedBlockNumber: event.blockNumber ?? null,
      details: parse(event.payloadJson) })),
  };
}

async function findRun(ctx: any, runId: string) {
  return await ctx.db.query("monadPerpRuns").withIndex("by_runId", (q: any) => q.eq("runId", runId)).first();
}

async function ownedRun(ctx: any, runId: string) {
  const { user, owner } = await requireMeraViewer(ctx);
  const row = await findRun(ctx, runId);
  return row && row.userId === user._id && row.ownerAddress === owner ? { row, user, owner } : null;
}

export const prepareRun = mutation({
  args: { runId: v.string(), chainId: v.number(), factoryAddress: v.string(), clearinghouseAddress: v.string(),
    vaultAddress: v.string(), nonce: v.string(), idempotencyKey: v.string(), amountUnits: v.string(),
    durationSeconds: v.number(), setupDeadline: v.number(), preparedExpiresAt: v.number(), circleNonce: v.string(),
    circleTypedDataJson: v.string(), mandateTypedDataJson: v.string(), mandateHash: v.string(),
    marketsJson: v.string(), policyVersion: v.number() },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const amount = /^\d+$/.test(args.amountUnits) ? BigInt(args.amountUnits) : 0n;
    if (args.chainId !== 10143 || args.policyVersion !== 1 || amount < 100_000n || amount > 10_000_000n
        || args.durationSeconds < 600 || args.durationSeconds > 7200 || args.setupDeadline <= Math.floor(Date.now() / 1000)
        || args.setupDeadline > Math.floor(Date.now() / 1000) + 300 || args.preparedExpiresAt <= Date.now()
        || !/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey)
        || !/^0x[a-f0-9]{40}$/i.test(args.factoryAddress) || !/^0x[a-f0-9]{40}$/i.test(args.clearinghouseAddress)
        || !/^0x[a-f0-9]{40}$/i.test(args.vaultAddress) || !/^0x[a-f0-9]{64}$/i.test(args.circleNonce)
        || !/^0x[a-f0-9]{64}$/i.test(args.mandateHash)) throw new Error("Monad perp enrollment terms are invalid or expired.");
    const prior = await ctx.db.query("monadPerpRuns").withIndex("by_userId_idempotencyKey", (q: any) =>
      q.eq("userId", user._id).eq("idempotencyKey", args.idempotencyKey)).first();
    if (prior) {
      if (prior.ownerAddress !== owner || prior.amountUnits !== args.amountUnits || prior.durationSeconds !== args.durationSeconds
          || prior.vaultAddress !== args.vaultAddress) throw new Error("Perp idempotency key was reused for different terms.");
      return { ...prior, circleTypedData: JSON.parse(prior.circleTypedDataJson), mandateTypedData: JSON.parse(prior.mandateTypedDataJson) };
    }
    for (const status of activeStatuses) {
      const existing = await ctx.db.query("monadPerpRuns").withIndex("by_owner_status", (q: any) =>
        q.eq("ownerAddress", owner).eq("status", status)).first();
      if (existing) throw new Error("A perp run is already active or settling for this Mera owner.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("monadPerpRuns", { ...args, venueId: "monad-mock-clearinghouse-v1", userId: user._id, subject: `mera:${owner}`,
      ownerAddress: owner, status: "prepared", tickSequence: 0, createdAt: now, updatedAt: now });
    await addEvent(ctx, { runId: args.runId, ownerAddress: owner, userId: user._id, eventId: "prepared",
      type: "perp_enrollment_prepared", status: "prepared", summary: "Perp test policy and exact Circle funding authorization prepared for Mera review" });
    const row = await ctx.db.get(id);
    return { ...row, circleTypedData: JSON.parse(args.circleTypedDataJson), mandateTypedData: JSON.parse(args.mandateTypedDataJson) };
  },
});

export const getEnrollmentForActivation = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId);
  if (!found || !["prepared", "activation_pending"].includes(found.row.status)) return null;
  return { ...found.row, circleTypedData: JSON.parse(found.row.circleTypedDataJson), mandateTypedData: JSON.parse(found.row.mandateTypedDataJson) };
} });

export const getOwnedRun = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId); return found?.row ?? null;
} });

export const getCurrent = query({ args: {}, handler: async (ctx) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const rows = await ctx.db.query("monadPerpRuns").withIndex("by_userId_createdAt", (q: any) => q.eq("userId", user._id)).order("desc").take(50);
  const row = rows.find((item: any) => item.ownerAddress === owner && activeStatuses.includes(item.status));
  if (!row) return { current: null };
  const events = await ctx.db.query("monadPerpEvents").withIndex("by_run_timestamp", (q: any) => q.eq("runId", row.runId)).order("desc").take(50);
  return { current: runDto(row, events.reverse()) };
} });

export const getHistory = query({ args: { limit: v.optional(v.number()), cursor: v.optional(v.string()) }, handler: async (ctx, args) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const limit = Math.max(1, Math.min(30, Math.floor(args.limit ?? 15)));
  const page = await ctx.db.query("monadPerpRuns").withIndex("by_userId_owner_createdAt", (q: any) =>
    q.eq("userId", user._id).eq("ownerAddress", owner)).order("desc")
    .paginate({ numItems: limit, cursor: args.cursor ?? null });
  return { runs: page.page.map((row: any) => runDto(row, [])), nextCursor: page.isDone ? null : page.continueCursor,
    hasMore: !page.isDone };
} });

export const getRunHistory = query({ args: { runId: v.string(), limit: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const found = await ownedRun(ctx, args.runId);
    if (!found) return null;
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const page = await ctx.db.query("monadPerpEvents").withIndex("by_run_timestamp", (q: any) => q.eq("runId", args.runId))
      .order("desc").paginate({ numItems: limit, cursor: args.cursor ?? null });
    return { run: runDto(found.row, []), events: page.page.map((event: any) => ({ ...event,
      payload: parse(event.payloadJson), timestampIso: new Date(event.timestamp).toISOString() })).reverse(),
      nextCursor: page.isDone ? null : page.continueCursor, hasMore: !page.isDone };
  } });

export const getRunObservations = query({ args: { runId: v.string(), limit: v.optional(v.number()), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const found = await ownedRun(ctx, args.runId);
    if (!found) return null;
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const page = await ctx.db.query("monadPerpObservations").withIndex("by_run_time", (q: any) => q.eq("runId", args.runId))
      .order("desc").paginate({ numItems: limit, cursor: args.cursor ?? null });
    return { observations: page.page.reverse(), nextCursor: page.isDone ? null : page.continueCursor, hasMore: !page.isDone };
  } });

async function addEvent(ctx: any, input: any) {
  const eventId = `perp:${input.runId}:${input.eventId}`;
  const prior = await ctx.db.query("monadPerpEvents").withIndex("by_eventId", (q: any) => q.eq("eventId", eventId)).first();
  if (prior) return;
  const timestamp = input.timestamp ?? Date.now();
  const payload = input.payload ? JSON.stringify(input.payload).slice(0, 20_000) : undefined;
  await ctx.db.insert("monadPerpEvents", { runId: input.runId, venueId: "monad-mock-clearinghouse-v1", ownerAddress: input.ownerAddress,
    eventId, timestamp, type: input.type, status: input.status, summary: String(input.summary).slice(0, 300),
    ...(input.orderId ? { orderId: input.orderId } : {}), ...(input.txHash ? { txHash: input.txHash } : {}),
    ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}), ...(payload ? { payloadJson: payload } : {}) });
  await appendMonadActivity(ctx, { userId: input.userId, ownerAddress: input.ownerAddress,
    activityId: eventId, kind: input.type, status: input.status, summary: input.summary,
    txHash: input.txHash, venueId: "monad-mock-clearinghouse-v1", dataJson: payload ?? JSON.stringify({ runId: input.runId }) });
}
