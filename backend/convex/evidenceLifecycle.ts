import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { canonicalTaggedHash } from "./helpers/dependencySafetyVerification";
import { assertTransitionCoherence, compareStatusTransition } from
  "./helpers/evidenceLifecycleStatusOrder";

const hash = /^[a-f0-9]{64}$/;
const allowedOutcomes = new Set(["allow", "transformed", "drop", "quarantine", "block", "unknown"]);

function bounded(value: string, length: number, label: string) {
  if (!value || value.length > length) throw new Error(`${label} is invalid.`);
}

export function assertProjectionScope(scopeKind: string, scopeKey: string,
    strategyAccountId: unknown) {
  const account = strategyAccountId === undefined ? undefined : String(strategyAccountId);
  if (account && (scopeKind !== "account" || scopeKey !== `account:${account}`)) {
    throw new Error("Lifecycle projection account scope does not match its strategy account.");
  }
  if (!account && (scopeKind !== "public" || scopeKey !== "public")) {
    throw new Error("Unowned lifecycle projection must use canonical public scope.");
  }
}

export const projectDecision = internalMutation({
  args: {
    strategyAccountId: v.optional(v.id("strategyAccounts")), artifactId: v.string(),
    producer: v.string(), purpose: v.string(), sink: v.string(), scopeKind: v.string(),
    scopeKey: v.string(), outcome: v.string(), reasons: v.array(v.string()),
    policyHash: v.string(), inventoryHash: v.string(), decisionHash: v.string(),
    decisionBodyJson: v.string(),
    sanitizedPayloadHash: v.optional(v.string()), retentionScheduleHash: v.optional(v.string()),
    evaluatedAt: v.number(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    bounded(args.artifactId, 120, "Lifecycle artifact");
    bounded(args.scopeKey, 180, "Lifecycle scope");
    assertProjectionScope(args.scopeKind, args.scopeKey, args.strategyAccountId);
    if (!allowedOutcomes.has(args.outcome) || args.reasons.length < 1 || args.reasons.length > 12) {
      throw new Error("Lifecycle decision outcome is invalid.");
    }
    for (const value of [args.policyHash, args.inventoryHash, args.decisionHash,
      args.sanitizedPayloadHash, args.retentionScheduleHash]) {
      if (value !== undefined && !hash.test(value)) throw new Error("Lifecycle hash is invalid.");
    }
    if (args.expiresAt <= args.evaluatedAt) throw new Error("Lifecycle decision is expired.");
    if (["allow", "transformed"].includes(args.outcome) && !args.sanitizedPayloadHash) {
      throw new Error("Permitted lifecycle projection lacks its payload binding.");
    }
    let body: any;
    try { body = JSON.parse(args.decisionBodyJson); }
    catch { throw new Error("Lifecycle decision body is malformed."); }
    if (!body || body.schema_version !== 1 || body.producer !== args.producer
      || body.purpose !== args.purpose || body.sink !== args.sink
      || body.scope?.kind !== args.scopeKind || body.scope?.key !== args.scopeKey
      || body.outcome !== args.outcome || body.policy_hash !== args.policyHash
      || body.inventory_hash !== args.inventoryHash
      || body.sanitized_payload_hash !== (args.sanitizedPayloadHash ?? null)
      || body.retention_schedule_hash !== (args.retentionScheduleHash ?? null)
      || Date.parse(body.evaluated_at) !== args.evaluatedAt
      || Date.parse(body.expires_at) !== args.expiresAt
      || JSON.stringify(body.reasons) !== JSON.stringify(args.reasons)) {
      throw new Error("Lifecycle decision body does not match its projection.");
    }
    if (await canonicalTaggedHash(body) !== args.decisionHash) {
      throw new Error("Lifecycle decision canonical hash is invalid.");
    }
    const duplicate = await ctx.db.query("evidenceLifecycleProjections")
      .withIndex("by_account_decisionHash", (q) => q.eq("strategyAccountId",
        args.strategyAccountId).eq("decisionHash", args.decisionHash)).first();
    if (duplicate) return { projectionId: duplicate._id, duplicate: true };
    const current = await ctx.db.query("evidenceLifecycleProjections")
      .withIndex("by_account_artifact_sink", (q) => q.eq("strategyAccountId",
        args.strategyAccountId).eq("artifactId", args.artifactId).eq("sink", args.sink)).first();
    if (current && (current.evaluatedAt > args.evaluatedAt
      || (current.evaluatedAt === args.evaluatedAt && current.decisionHash > args.decisionHash))) {
      return { projectionId: current._id, duplicate: false, late: true };
    }
    const { decisionBodyJson: _verifiedBody, ...projection } = args;
    const value = { ...projection, outcome: args.outcome as any, updatedAt: Date.now() };
    if (current) await ctx.db.patch(current._id, value);
    else return { projectionId: await ctx.db.insert("evidenceLifecycleProjections", value), duplicate: false };
    return { projectionId: current._id, duplicate: false };
  },
});

export const getDecision = internalQuery({
  args: { strategyAccountId: v.optional(v.id("strategyAccounts")), decisionHash: v.string() },
  handler: async (ctx, args) => await ctx.db.query("evidenceLifecycleProjections")
    .withIndex("by_account_decisionHash", (q) => q.eq("strategyAccountId",
      args.strategyAccountId).eq("decisionHash", args.decisionHash)).first(),
});

export const projectStatus = internalMutation({
  args: { strategyAccountId: v.id("strategyAccounts"), artifactId: v.string(),
    scopeKey: v.string(), lifecycleState: v.union(v.literal("governed"), v.literal("held"),
      v.literal("partial"), v.literal("deleted"), v.literal("quarantined"),
      v.literal("unverifiable")),
    expectedCopyCount: v.number(), resolvedCopyCount: v.number(),
    holdRevision: v.optional(v.number()),
    holdHash: v.optional(v.string()), deletionReceiptHash: v.optional(v.string()),
    latestDecisionHash: v.string(), transitionHash: v.string(), transitionAt: v.number(),
    transitionPhase: v.union(v.literal("governed"), v.literal("hold_started"),
      v.literal("hold_expired"), v.literal("copy_disposition"), v.literal("deletion"),
      v.literal("quarantine")) },
  handler: async (ctx, args) => {
    assertProjectionScope("account", args.scopeKey, args.strategyAccountId);
    for (const value of [args.latestDecisionHash, args.transitionHash,
      args.holdHash, args.deletionReceiptHash]) {
      if (value !== undefined && !hash.test(value)) throw new Error("Lifecycle status hash is invalid.");
    }
    assertTransitionCoherence(args as any);
    const current = await ctx.db.query("evidenceLifecycleStatusProjections")
      .withIndex("by_account_artifactId", (q) => q.eq("strategyAccountId",
        args.strategyAccountId).eq("artifactId", args.artifactId)).first();
    if (current) {
      const order = compareStatusTransition(current as any, args as any);
      if (order === "duplicate") {
        const fields = ["lifecycleState", "transitionPhase", "transitionAt", "holdRevision",
          "holdHash", "deletionReceiptHash", "latestDecisionHash", "expectedCopyCount",
          "resolvedCopyCount"] as const;
        if (fields.some((field) => current[field] !== args[field])) {
          throw new Error("Lifecycle transition identity was reused with different state.");
        }
        return { projectionId: current._id, duplicate: true };
      }
      if (order === "late") return { projectionId: current._id, late: true };
    }
    const value = { ...args, updatedAt: Date.now() };
    if (current) { await ctx.db.patch(current._id, value); return { projectionId: current._id }; }
    return { projectionId: await ctx.db.insert("evidenceLifecycleStatusProjections", value) };
  },
});

export async function requireLifecycleDecision(ctx: any, input: {
  decisionHash: string | undefined; artifactId: string; sink: string; strategyAccountId?: any;
  actualPayload: unknown;
}) {
  if (!input.decisionHash || !hash.test(input.decisionHash)) throw new Error("Lifecycle decision hash is invalid.");
  const decision = await ctx.db.query("evidenceLifecycleProjections")
    .withIndex("by_account_decisionHash", (q: any) => q.eq("strategyAccountId",
      input.strategyAccountId).eq("decisionHash", input.decisionHash)).first();
  if (!decision || !["allow", "transformed"].includes(decision.outcome)
    || decision.expiresAt <= Date.now() || decision.artifactId !== input.artifactId
    || decision.sink !== input.sink
    || String(decision.strategyAccountId ?? "") !== String(input.strategyAccountId ?? "")) {
    throw new Error("Fresh bound evidence lifecycle decision is required.");
  }
  if (await canonicalTaggedHash(input.actualPayload) !== decision.sanitizedPayloadHash) {
    throw new Error("Lifecycle payload does not match the admitted sanitized payload.");
  }
  const status = await ctx.db.query("evidenceLifecycleStatusProjections")
    .withIndex("by_account_artifactId", (q: any) => q.eq("strategyAccountId",
      input.strategyAccountId).eq("artifactId", input.artifactId)).first();
  if (status && (status.latestDecisionHash !== input.decisionHash
    || status.strategyAccountId !== input.strategyAccountId
    || ["held", "partial", "deleted", "quarantined", "unverifiable"].includes(status.lifecycleState))) {
    throw new Error("Lifecycle artifact is no longer usable.");
  }
  return decision;
}
