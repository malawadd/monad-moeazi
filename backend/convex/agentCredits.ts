import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireViewerStrategy } from "./model";
import { chargingPaused } from "./operatorCreditControls";

async function accountForUser(ctx: any, userId: any) {
  return await ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) => q.eq("userId", userId)).first();
}

async function ledger(ctx: any, account: any, args: {
  kind: "grant" | "reserve" | "release" | "settle";
  amount: number;
  reference: string;
  rateCardVersion?: number;
  metadataJson?: string;
  teamId?: any;
}) {
  return await ctx.db.insert("creditLedger", {
    creditAccountId: account._id,
    userId: account.userId,
    teamId: args.teamId,
    kind: args.kind,
    amount: args.amount,
    balanceAfter: account.balance,
    reservedAfter: account.reserved,
    rateCardVersion: args.rateCardVersion ?? 1,
    reference: args.reference,
    metadataJson: args.metadataJson,
    createdAt: Date.now(),
  });
}

export async function applyCreditGrant(ctx: any, args: {
  userId: any; amount: number; reference: string; rateCardVersion?: number; metadataJson?: string;
}) {
  if (!Number.isSafeInteger(args.amount) || args.amount <= 0) {
    throw new Error("Credit grant must be a positive safe integer.");
  }
  if (!args.reference || args.reference.length > 160) throw new Error("Invalid credit grant reference.");
  const existing = await ctx.db.query("creditLedger")
    .withIndex("by_reference", (q: any) => q.eq("reference", args.reference)).first();
  if (existing) {
    if (existing.kind !== "grant" || existing.userId !== args.userId || existing.amount !== args.amount) {
      throw new Error("Credit grant reference already belongs to another operation.");
    }
    const account = await accountForUser(ctx, args.userId);
    return { accountId: existing.creditAccountId, balance: account?.balance ?? existing.balanceAfter, duplicate: true };
  }
  const now = Date.now();
  let account = await accountForUser(ctx, args.userId);
  const nextBalance = (account?.balance ?? 0) + args.amount;
  if (!Number.isSafeInteger(nextBalance)) throw new Error("Resulting credit balance is too large.");
  if (!account) {
    const id = await ctx.db.insert("creditAccounts", { userId: args.userId, balance: nextBalance, reserved: 0, version: 1, createdAt: now, updatedAt: now });
    account = await ctx.db.get(id);
  } else {
    await ctx.db.patch(account._id, { balance: nextBalance, version: account.version + 1, updatedAt: now });
    account = await ctx.db.get(account._id);
  }
  if (!account) throw new Error("Credit account could not be created.");
  await ledger(ctx, account, { ...args, kind: "grant" });
  return { accountId: account._id, balance: account.balance, duplicate: false };
}

export function billableForReservation(reservation: { amount: number; billingPaused?: boolean }, requested: number) {
  return reservation.billingPaused ? 0 : Math.max(0, Math.min(reservation.amount, Math.floor(requested)));
}

export const grantCredits = internalMutation({
  args: { userId: v.id("users"), amount: v.number(), reference: v.string(), rateCardVersion: v.optional(v.number()) },
  handler: applyCreditGrant,
});

export const reserveCredits = internalMutation({
  args: { userId: v.id("users"), jobId: v.id("analysisJobs"), amount: v.number(), expiresAt: v.number(), rateCardVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.amount) || args.amount <= 0) throw new Error("Reservation must be a positive integer.");
    const existing = await ctx.db.query("creditReservations").withIndex("by_jobId", (q: any) => q.eq("jobId", args.jobId)).first();
    if (existing) return { reservationId: existing._id, reserved: existing.amount, duplicate: true };
    let account = await accountForUser(ctx, args.userId);
    if (!account || account.balance - account.reserved < args.amount) return { reservationId: null, reserved: 0, insufficient: true };
    const now = Date.now();
    const billingPaused = await chargingPaused(ctx);
    await ctx.db.patch(account._id, { reserved: account.reserved + args.amount, version: account.version + 1, updatedAt: now });
    const reservationId = await ctx.db.insert("creditReservations", {
      creditAccountId: account._id, userId: args.userId, jobId: args.jobId, amount: args.amount,
      status: "active", billingPaused, expiresAt: args.expiresAt, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(args.jobId, { reservedCredits: args.amount, updatedAt: now });
    account = await ctx.db.get(account._id);
    if (!account) throw new Error("Credit account disappeared during reservation.");
    await ledger(ctx, account, { kind: "reserve", amount: args.amount, reference: String(args.jobId), rateCardVersion: args.rateCardVersion });
    return { reservationId, reserved: args.amount, insufficient: false };
  },
});

export const settleCredits = internalMutation({
  args: { jobId: v.id("analysisJobs"), billableAmount: v.number(), rateCardVersion: v.number(), metadataJson: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.query("creditReservations").withIndex("by_jobId", (q: any) => q.eq("jobId", args.jobId)).first();
    if (!reservation || reservation.status !== "active") return { settled: false };
    const billable = billableForReservation(reservation, args.billableAmount);
    let account = await ctx.db.get(reservation.creditAccountId);
    if (!account) throw new Error("Credit account not found.");
    const now = Date.now();
    await ctx.db.patch(account._id, {
      balance: Math.max(0, account.balance - billable), reserved: Math.max(0, account.reserved - reservation.amount),
      version: account.version + 1, updatedAt: now,
    });
    await ctx.db.patch(reservation._id, { status: "settled", updatedAt: now });
    account = await ctx.db.get(account._id);
    if (!account) throw new Error("Credit account disappeared during settlement.");
    await ledger(ctx, account, { kind: "settle", amount: billable, reference: String(args.jobId), rateCardVersion: args.rateCardVersion, metadataJson: args.metadataJson });
    const released = reservation.amount - billable;
    if (released > 0) await ledger(ctx, account, { kind: "release", amount: released, reference: String(args.jobId), rateCardVersion: args.rateCardVersion });
    return { settled: true, billable, released, balance: account.balance };
  },
});

export const releaseCredits = internalMutation({
  args: { jobId: v.id("analysisJobs"), reason: v.string(), rateCardVersion: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.query("creditReservations").withIndex("by_jobId", (q: any) => q.eq("jobId", args.jobId)).first();
    if (!reservation || reservation.status !== "active") return { released: false };
    let account = await ctx.db.get(reservation.creditAccountId);
    if (!account) throw new Error("Credit account not found.");
    const now = Date.now();
    await ctx.db.patch(account._id, { reserved: Math.max(0, account.reserved - reservation.amount), version: account.version + 1, updatedAt: now });
    await ctx.db.patch(reservation._id, { status: "released", updatedAt: now });
    account = await ctx.db.get(account._id);
    if (!account) throw new Error("Credit account disappeared during release.");
    await ledger(ctx, account, { kind: "release", amount: reservation.amount, reference: String(args.jobId), rateCardVersion: args.rateCardVersion, metadataJson: JSON.stringify({ reason: args.reason }) });
    return { released: true, amount: reservation.amount };
  },
});

async function researchOwner(ctx: any, subject: string, teamId: any, includeArchived = false) {
  const state = await requireViewerStrategy(ctx, subject);
  if (!state.user || !state.strategyAccount) throw new Error("Strategy account is unavailable.");
  const team = await ctx.db.get(teamId);
  if (!team || (team.archivedAt && !includeArchived) || team.userId !== state.user._id || team.strategyAccountId !== state.strategyAccount._id) {
    throw new Error("Team is unavailable in this account.");
  }
  return state;
}

export const researchCreditContext = internalQuery({
  args: { subject: v.string(), teamId: v.id("agentProfiles"), includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const state = await researchOwner(ctx, args.subject, args.teamId, args.includeArchived);
    const credit = await accountForUser(ctx, state.user!._id);
    return { accountId: state.strategyAccount!._id,
      available: credit ? Math.max(0, credit.balance - credit.reserved) : 0,
      balance: credit?.balance ?? 0, reserved: credit?.reserved ?? 0 };
  },
});

export const reserveResearchCredits = internalMutation({
  args: { subject: v.string(), teamId: v.id("agentProfiles"), experimentId: v.string(),
    amount: v.number(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    if (!/^[0-9a-f-]{36}$/.test(args.experimentId) || !Number.isInteger(args.amount)
        || args.amount < 1 || args.amount > 100_000) throw new Error("Research credit request is invalid.");
    const state = await researchOwner(ctx, args.subject, args.teamId);
    const existing = await ctx.db.query("creditReservations")
      .withIndex("by_experimentId", (q: any) => q.eq("experimentId", args.experimentId)).first();
    if (existing) return { reserved: existing.amount, duplicate: true, status: existing.status };
    const credit = await accountForUser(ctx, state.user!._id);
    if (!credit || credit.balance - credit.reserved < args.amount) {
      return { reserved: 0, insufficient: true };
    }
    const now = Date.now();
    const billingPaused = await chargingPaused(ctx);
    await ctx.db.patch(credit._id, { reserved: credit.reserved + args.amount,
      version: credit.version + 1, updatedAt: now });
    const reservationId = await ctx.db.insert("creditReservations", {
      creditAccountId: credit._id, userId: state.user!._id, teamId: args.teamId,
      experimentId: args.experimentId, amount: args.amount, status: "active", billingPaused,
      expiresAt: args.expiresAt, createdAt: now, updatedAt: now,
    });
    await ledger(ctx, { ...credit, reserved: credit.reserved + args.amount }, {
      kind: "reserve", amount: args.amount, reference: args.experimentId,
      teamId: args.teamId, metadataJson: JSON.stringify({ research: true }) });
    return { reservationId, reserved: args.amount, insufficient: false };
  },
});

export const settleResearchCredits = internalMutation({
  args: { experimentId: v.string(), billableAmount: v.number(), releaseOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const reservation = await ctx.db.query("creditReservations")
      .withIndex("by_experimentId", (q: any) => q.eq("experimentId", args.experimentId)).first();
    if (!reservation || reservation.status !== "active") return { settled: false };
    const credit = await ctx.db.get(reservation.creditAccountId);
    if (!credit) throw new Error("Credit account is unavailable.");
    const billable = args.releaseOnly ? 0 : billableForReservation(reservation, args.billableAmount);
    const now = Date.now();
    const balance = Math.max(0, credit.balance - billable);
    const reserved = Math.max(0, credit.reserved - reservation.amount);
    await ctx.db.patch(credit._id, { balance, reserved,
      version: credit.version + 1, updatedAt: now });
    await ctx.db.patch(reservation._id, { status: args.releaseOnly ? "released" : "settled", updatedAt: now });
    const current = { ...credit, balance, reserved };
    if (billable) await ledger(ctx, current, { kind: "settle", amount: billable,
      reference: args.experimentId, teamId: reservation.teamId,
      metadataJson: JSON.stringify({ research: true }) });
    const released = reservation.amount - billable;
    if (released) await ledger(ctx, current, { kind: "release", amount: released,
      reference: args.experimentId, teamId: reservation.teamId,
      metadataJson: JSON.stringify({ research: true }) });
    return { settled: true, billable, released };
  },
});

export const claimStarterCredits = mutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.AGENT_DEV_CONTROLS_ENABLED !== "true") {
      throw new Error("Development starter credits are disabled.");
    }
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    const state = await requireViewerStrategy(ctx, identity.subject);
    if (!state.user) throw new Error("User account not found.");
    const existing = await ctx.db.query("creditClaims")
      .withIndex("by_userId_kind", (q: any) =>
        q.eq("userId", state.user._id).eq("kind", "development_starter")).first();
    if (existing) return { claimed: false, amount: existing.amount };
    const configured = Number(process.env.DEV_STARTER_CREDITS ?? 100);
    const amount = Number.isInteger(configured) && configured > 0 ? Math.min(configured, 100_000) : 100;
    const now = Date.now();
    let account = await accountForUser(ctx, state.user._id);
    if (!account) {
      const id = await ctx.db.insert("creditAccounts", {
        userId: state.user._id, balance: amount, reserved: 0, version: 1,
        createdAt: now, updatedAt: now,
      });
      account = await ctx.db.get(id);
    } else {
      await ctx.db.patch(account._id, {
        balance: account.balance + amount,
        version: account.version + 1,
        updatedAt: now,
      });
      account = await ctx.db.get(account._id);
    }
    if (!account) throw new Error("Credit account could not be created.");
    const reference = `development-starter:${state.user._id}`;
    await ctx.db.insert("creditClaims", {
      userId: state.user._id, kind: "development_starter", amount, reference, createdAt: now,
    });
    await ledger(ctx, account, { kind: "grant", amount, reference, rateCardVersion: 1 });
    return { claimed: true, amount, balance: account.balance };
  },
});
