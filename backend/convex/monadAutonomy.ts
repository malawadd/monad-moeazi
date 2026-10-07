import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMeraViewer } from "./monadHelpers";

const activeStatuses = ["activation_pending", "active", "settling", "uncertain"] as const;

function publicRun(row: any) {
  const events = (row.events ?? []).map((event: any) => {
    let signal: unknown;
    try { signal = event.signalJson ? JSON.parse(event.signalJson) : undefined; } catch { signal = undefined; }
    return { id: event.eventId, timestamp: new Date(event.timestamp).toISOString(), type: event.type, status: event.status, summary: event.summary,
      ...(event.ruleVersion ? { ruleVersion: event.ruleVersion } : {}), ...(signal ? { signal } : {}),
      ...(event.blockNumber !== undefined ? { finalizedBlockNumber: String(event.blockNumber) } : {}),
      ...(event.txHash ? { txHash: event.txHash } : {}), ...(event.amountInUnits ? { amountInUnits: event.amountInUnits } : {}),
      ...(event.amountOutUnits ? { amountOutUnits: event.amountOutUnits } : {}),
      ...(event.tokenAddress ? { tokenAddress: event.tokenAddress } : {}),
      ...(event.tokenSymbol ? { tokenSymbol: event.tokenSymbol } : {}),
      ...(event.orderId ? { orderId: event.orderId } : {}) };
  });
  let openPosition: any = null;
  let latestDecision: any = null;
  try { openPosition = row.openPositionJson ? JSON.parse(row.openPositionJson) : null; } catch { /* omit corrupt state */ }
  try { latestDecision = row.latestDecisionJson ? JSON.parse(row.latestDecisionJson) : null; } catch { /* omit corrupt state */ }
  if (latestDecision?.evaluatedAt && typeof latestDecision.evaluatedAt === "number") {
    latestDecision.evaluatedAt = new Date(latestDecision.evaluatedAt).toISOString();
  }
  if (latestDecision?.finalizedBlockNumber !== undefined) latestDecision.finalizedBlockNumber = String(latestDecision.finalizedBlockNumber);
  return {
    enrollmentId: row.enrollmentId, runId: row.enrollmentId, status: row.status,
    ownerAddress: row.ownerAddress, vaultAddress: row.vaultAddress, chainId: row.chainId,
    startingUsdcUnits: row.amountUnits, availableUsdcUnits: row.availableUsdcUnits
      ?? (row.status === "prepared" || row.status === "activation_pending" ? "0" : row.amountUnits),
    realizedPnlUsdcUnits: row.realizedPnlUsdcUnits ?? "0", operatorGasMonWei: row.operatorGasMonWei ?? "0",
    cyclesCompleted: row.cyclesCompleted, maxCycles: row.maxCycles, expiresAt: row.expiresAt ?? null,
    openPosition, latestDecision, finalizedBlockNumber: row.lastObservedBlock === undefined ? null : String(row.lastObservedBlock), events,
  };
}

async function ownedEnrollment(ctx: any, owner: string, enrollmentId: string) {
  const { user } = await requireMeraViewer(ctx);
  const row = await ctx.db.query("monadAutonomyEnrollments")
    .withIndex("by_enrollmentId", (q: any) => q.eq("enrollmentId", enrollmentId)).first();
  if (!row || row.userId !== user._id || row.ownerAddress !== owner) return null;
  return row;
}

export const prepareEnrollment = mutation({
  args: {
    enrollmentId: v.string(), chainId: v.number(), factoryAddress: v.string(), vaultAddress: v.string(),
    nonce: v.string(), idempotencyKey: v.string(), amountUnits: v.string(), durationSeconds: v.number(),
    maxCycles: v.number(), tokensJson: v.string(), poolsJson: v.string(), startBy: v.number(),
    preparedExpiresAt: v.number(), circleNonce: v.string(), circleTypedDataJson: v.string(),
    mandateTypedDataJson: v.string(), mandateHash: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const amount = /^[0-9]+$/.test(args.amountUnits) ? BigInt(args.amountUnits) : 0n;
    if (args.chainId !== 10143 || args.maxCycles !== 3 || amount < 100_000n || amount > 10_000_000n
        || !/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey)
        || !/^0x[a-f0-9]{40}$/i.test(args.factoryAddress) || !/^0x[a-f0-9]{40}$/i.test(args.vaultAddress)
        || !/^0x[a-f0-9]{64}$/i.test(args.circleNonce) || !/^0x[a-f0-9]{64}$/i.test(args.mandateHash)
        || args.durationSeconds < 600 || args.durationSeconds > 7200
        || args.startBy <= Math.floor(Date.now() / 1000)
        || args.startBy > Math.floor(Date.now() / 1000) + 300) {
      throw new Error("Monad autonomy enrollment terms are invalid or expired.");
    }
    const prior = await ctx.db.query("monadAutonomyEnrollments")
      .withIndex("by_userId_idempotencyKey", (q: any) => q.eq("userId", user._id).eq("idempotencyKey", args.idempotencyKey)).first();
    if (prior) {
      if (prior.ownerAddress !== owner || prior.factoryAddress !== args.factoryAddress
          || prior.amountUnits !== args.amountUnits || prior.durationSeconds !== args.durationSeconds) {
        throw new Error("Autonomy idempotency key was reused for different terms.");
      }
      return { ...prior, circleTypedData: JSON.parse(prior.circleTypedDataJson),
        mandateTypedData: JSON.parse(prior.mandateTypedDataJson) };
    }
    for (const status of activeStatuses) {
      const current = await ctx.db.query("monadAutonomyEnrollments")
        .withIndex("by_owner_status", (q: any) => q.eq("ownerAddress", owner).eq("status", status)).first();
      if (current) throw new Error("An autonomy enrollment is already active or settling for this owner.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("monadAutonomyEnrollments", {
      ...args, ownerAddress: owner, subject: `mera:${owner}`, userId: user._id,
      status: "prepared", cyclesCompleted: 0, tickSequence: 0, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("monadAutonomyEvents", { enrollmentId: args.enrollmentId, ownerAddress: owner,
      eventId: `${args.enrollmentId}:prepared`, timestamp: now, type: "enrollment_prepared", status: "prepared",
      summary: "Exact Circle authorization and autonomy mandate prepared for Mera review" });
    const row = await ctx.db.get(id);
    return { ...row, circleTypedData: JSON.parse(args.circleTypedDataJson),
      mandateTypedData: JSON.parse(args.mandateTypedDataJson) };
  },
});

export const getPreparedEnrollment = query({
  args: { enrollmentId: v.string() },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const row = await ctx.db.query("monadAutonomyEnrollments")
      .withIndex("by_enrollmentId", (q: any) => q.eq("enrollmentId", args.enrollmentId)).first();
    if (!row || row.userId !== user._id || row.ownerAddress !== owner || row.status !== "prepared") return null;
    return { ...row, circleTypedData: JSON.parse(row.circleTypedDataJson),
      mandateTypedData: JSON.parse(row.mandateTypedDataJson) };
  },
});

export const getEnrollmentForActivation = query({
  args: { enrollmentId: v.string() },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const row = await ctx.db.query("monadAutonomyEnrollments")
      .withIndex("by_enrollmentId", (q: any) => q.eq("enrollmentId", args.enrollmentId)).first();
    if (!row || row.userId !== user._id || row.ownerAddress !== owner
        || !["prepared", "activation_pending"].includes(row.status)) return null;
    return { ...row, circleTypedData: JSON.parse(row.circleTypedDataJson),
      mandateTypedData: JSON.parse(row.mandateTypedDataJson) };
  },
});

export const getOwnedEnrollment = query({
  args: { enrollmentId: v.string() },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const row = await ctx.db.query("monadAutonomyEnrollments")
      .withIndex("by_enrollmentId", (q: any) => q.eq("enrollmentId", args.enrollmentId)).first();
    return row && row.userId === user._id && row.ownerAddress === owner ? row : null;
  },
});

export const getCurrent = query({ args: {}, handler: async (ctx) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const rows = await ctx.db.query("monadAutonomyEnrollments")
    .withIndex("by_userId_createdAt", (q: any) => q.eq("userId", user._id)).order("desc").take(30);
  const row = rows.find((item: any) => item.ownerAddress === owner && activeStatuses.includes(item.status));
  if (!row) return { current: null };
  const eventRows = await ctx.db.query("monadAutonomyEvents")
    .withIndex("by_enrollment_timestamp", (q: any) => q.eq("enrollmentId", row.enrollmentId)).order("desc").take(30);
  return { current: publicRun({ ...row, events: eventRows.reverse() }) };
} });

export const getHistory = query({ args: { limit: v.optional(v.number()) }, handler: async (ctx, args) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const limit = Math.max(1, Math.min(30, Math.floor(args.limit ?? 10)));
  const rows = await ctx.db.query("monadAutonomyEnrollments")
    .withIndex("by_userId_createdAt", (q: any) => q.eq("userId", user._id)).order("desc").take(limit);
  const owned = rows.filter((row: any) => row.ownerAddress === owner);
  const runs = await Promise.all(owned.map(async (row: any) => {
    const events = await ctx.db.query("monadAutonomyEvents")
      .withIndex("by_enrollment_timestamp", (q: any) => q.eq("enrollmentId", row.enrollmentId)).order("desc").take(30);
    return publicRun({ ...row, events: events.reverse() });
  }));
  return { runs };
} });
