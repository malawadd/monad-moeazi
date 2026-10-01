/* eslint-disable @typescript-eslint/no-explicit-any */
import {internalMutation, internalQuery} from "./_generated/server";
import {v} from "convex/values";
import {getUserByAuthSubject, getStrategyAccountByUserId} from "./model";
import {budgetCharge, canTransition, terminal} from "./helpers/mobileConnector";

async function rowById(ctx: any, operationId: string) {
  return ctx.db.query("mobileConnectorOperations").withIndex("by_operationId", (q: any) => q.eq("operationId", operationId)).unique();
}
export const find = internalQuery({args: {subject: v.string(), operationId: v.string()}, handler: async (ctx, args) => {
  const row = await rowById(ctx, args.operationId);
  return row?.subject === args.subject ? row : null;
}});
export const load = internalQuery({args: {operationId: v.string()}, handler: async (ctx, args) => rowById(ctx, args.operationId)});
export const byIdempotency = internalQuery({args: {subject: v.string(), idempotencyKey: v.string()}, handler: async (ctx, args) =>
  ctx.db.query("mobileConnectorOperations").withIndex("by_subject_idempotency", q => q.eq("subject", args.subject).eq("idempotencyKey", args.idempotencyKey)).unique(),
});
export const pending = internalQuery({args: {subject: v.string()}, handler: async (ctx, args) => {
  const rows = await ctx.db.query("mobileConnectorOperations").withIndex("by_subject", q => q.eq("subject", args.subject)).order("desc").take(30);
  return rows.filter(row => !terminal.has(row.status));
}});
export const reserve = internalMutation({args: {subject: v.string(), input: v.any()}, handler: async (ctx, {subject, input}) => {
  const user = await getUserByAuthSubject(ctx, subject);
  if (!user) throw new Error("Account not provisioned.");
  const existing = await ctx.db.query("mobileConnectorOperations").withIndex("by_subject_idempotency", q => q.eq("subject", subject).eq("idempotencyKey", input.idempotencyKey)).unique();
  if (existing) {
    if (existing.bindingHash !== input.bindingHash) throw new Error("Idempotency conflict.");
    return {created: false, row: existing};
  }
  const now = Date.now();
  if (input.kind !== "purchase") {
    const strategy = await getStrategyAccountByUserId(ctx, user._id);
    const profile = strategy ? await ctx.db.query("agentProfiles").withIndex("by_strategyAccountId", q => q.eq("strategyAccountId", strategy._id)).first() : null;
    if (profile && !profile.paused || strategy?.emergencyStop) throw new Error("Pause AI before reserving wallet execution.");
    const legacy = await ctx.db.query("mobileWalletWithdrawals").withIndex("by_userId_operationId", q => q.eq("userId", user._id)).collect();
    if (legacy.some(row => !["completed", "failed", "cancelled", "expired"].includes(row.status) && (row.status !== "prepared" || row.expiresAt > now))) throw new Error("A legacy withdrawal is pending.");
  }
  if (input.nonceKey) {
    const locked = await ctx.db.query("mobileConnectorOperations").withIndex("by_nonce", q => q.eq("nonceKey", input.nonceKey)).collect();
    if (locked.some(row => !terminal.has(row.status) && (!["prepared", "authorization_required"].includes(row.status) || row.expiresAt > now))) throw new Error("Nonce is reserved.");
  }
  if (input.reservedWei) {
    // A lifetime ceiling is deliberately conservative; reset/period budgets need explicit policy.
    const rows = await ctx.db.query("mobileConnectorOperations").collect();
    const global = rows.reduce((sum, row) => sum + budgetCharge(row, now), 0n);
    const owner = rows.filter(row => row.subject === subject).reduce((sum, row) => sum + budgetCharge(row, now), 0n);
    const charge = BigInt(input.reservedWei);
    if (charge <= 0n || global + charge > BigInt(input.globalLimitWei) || owner + charge > BigInt(input.ownerLimitWei)) throw new Error("Sponsorship budget exhausted.");
  }
  const stored = {...input}; delete stored.globalLimitWei; delete stored.ownerLimitWei;
  const id = await ctx.db.insert("mobileConnectorOperations", {...stored, subject, userId: user._id, createdAt: now, updatedAt: now});
  return {created: true, row: await ctx.db.get(id)};
}});
export const transition = internalMutation({args: {subject: v.string(), operationId: v.string(), expected: v.array(v.string()), patch: v.any()}, handler: async (ctx, {subject, operationId, expected, patch}) => {
  const row = await rowById(ctx, operationId);
  if (!row || row.subject !== subject) throw new Error("Operation not found.");
  if (!expected.includes(row.status)) return {...row, transitionApplied: false};
  if (!canTransition(row.status, patch.status)) throw new Error("Invalid operation transition.");
  if ((patch.eventId && patch.eventId === row.lastEventId) || (patch.observedAt !== undefined && patch.observedAt <= (row.observedAt ?? 0))) return {...row, transitionApplied: false};
  const stored: any = {status: patch.status, updatedAt: Date.now()};
  for (const key of ["payloadJson", "externalId", "transactionHash", "actualGasCost", "actualCoverageCostWei", "observedAt"]) if (patch[key] !== undefined) stored[key] = patch[key];
  if (patch.eventId) stored.lastEventId = patch.eventId;
  if (Object.keys(stored).filter(key => key !== "updatedAt").every(key => stored[key] === (row as any)[key])) return {...row, transitionApplied: false};
  await ctx.db.patch(row._id, stored);
  if (row.kind === "activation" && stored.status === "completed") {
    const wallet = await ctx.db.query("accountWallets").withIndex("by_userId", q => q.eq("userId", row.userId)).first();
    if (wallet) await ctx.db.patch(wallet._id, {eip7702Delegated: true, updatedAt: stored.updatedAt});
  }
  if (stored.status !== row.status) {
    const strategy = await getStrategyAccountByUserId(ctx, row.userId);
    const details = JSON.parse(stored.payloadJson ?? row.payloadJson);
    if (strategy) await ctx.db.insert("auditEvents", {strategyAccountId: strategy._id, userId: row.userId, actor: "system",
      kind: `wallet.${row.kind}.${stored.status}`, summary: row.kind === "purchase" ? (stored.status === "received" ? "Purchased USDC arrived" : "USDC purchase updated") : `${row.kind === "activation" ? "Covered network fees" : "USDC withdrawal"}: ${stored.status.replaceAll("_", " ")}`,
      detail: JSON.stringify({operationId, amount: details.withdrawal?.amount, fundsMoved: row.kind === "withdrawal" && stored.status === "completed" || row.kind === "purchase" && stored.status === "received"}), refTable: "mobileConnectorOperations", refId: String(row._id), createdAt: stored.updatedAt});
  }
  return {...row, ...stored, transitionApplied: true};
}});
export const byExternal = internalQuery({args: {provider: v.any(), externalId: v.optional(v.string()), operationId: v.optional(v.string())}, handler: async (ctx, args) => {
  const candidates = args.operationId ? [await rowById(ctx, args.operationId)] : await ctx.db.query("mobileConnectorOperations").filter(q => q.eq(q.field("externalId"), args.externalId)).take(5);
  return candidates.find(row => row && JSON.parse(row.providerPinsJson).some((pin: any) => pin.id === args.provider.id && pin.version === args.provider.version)) ?? null;
}});
