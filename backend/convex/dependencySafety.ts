import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  breakerState, dependencyFailureDomain, dependencyStatus, safetyMode,
  safetyOperation, safetyOutcome,
} from "./dependencySafetyValidators";
import { canonicalTaggedHash } from "./helpers/dependencySafetyVerification";

const receiptValidator = v.object({
  schemaVersion: v.number(),
  receiptId: v.string(), incidentKey: v.string(), dependencyId: v.string(),
  failureDomain: dependencyFailureDomain,
  scopeKind: v.string(), scopeKey: v.string(), strategyAccountId: v.optional(v.id("strategyAccounts")),
  status: dependencyStatus, observedAt: v.number(), expiresAt: v.number(), reasonCode: v.string(),
  evidenceReference: v.optional(v.string()), sourceRevision: v.string(), adapterVersion: v.string(),
  observationKey: v.string(), receiptHash: v.string(),
  recoveryEligible: v.boolean(), recoveryIntervalMs: v.number(),
  requiredHealthyObservations: v.number(),
});

const decisionValidator = v.object({
  schemaVersion: v.number(),
  strategyAccountId: v.optional(v.id("strategyAccounts")), operation: safetyOperation,
  subjectKey: v.string(), scopeKey: v.string(), mode: safetyMode, breakerState,
  outcome: safetyOutcome, reasons: v.array(v.string()), receiptHashes: v.array(v.string()),
  incidentKeys: v.array(v.string()), bindingsJson: v.string(), decisionId: v.string(),
  decisionHash: v.string(), matrixVersion: v.string(), evaluatedAt: v.number(),
  expiresAt: v.number(), idempotencyKey: v.string(),
  bindingHash: v.string(), requestHash: v.string(),
});

function bounded(value: string, limit: number, label: string) {
  if (!value || value.length > limit) throw new Error(`${label} is invalid.`);
}

export function projectionWouldRegress(prior: { evaluatedAt: number; decisionHash: string },
    incoming: { evaluatedAt: number; decisionHash: string }) {
  return prior.evaluatedAt > incoming.evaluatedAt
    || (prior.evaluatedAt === incoming.evaluatedAt
      && prior.decisionHash !== incoming.decisionHash);
}

function validateBundle(receipts: any[], decision: any) {
  if (receipts.length > 32 || decision.reasons.length > 32 || decision.receiptHashes.length > 32) {
    throw new Error("Dependency safety bundle exceeds fixed limits.");
  }
  bounded(decision.subjectKey, 180, "Safety subject");
  bounded(decision.scopeKey, 180, "Safety scope");
  bounded(decision.decisionHash, 64, "Safety decision hash");
  if (decision.schemaVersion !== 2 || decision.matrixVersion !== "dependency-safety-v2") {
    throw new Error("Only dependency-safety v2 projections are current-authority eligible.");
  }
  JSON.parse(decision.bindingsJson);
  for (const receipt of receipts) {
    if (receipt.schemaVersion !== 2) throw new Error("Legacy receipts cannot enter v2 projections.");
    bounded(receipt.dependencyId, 100, "Dependency ID");
    bounded(receipt.scopeKey, 180, "Dependency scope");
    bounded(receipt.reasonCode, 80, "Dependency reason");
    bounded(receipt.incidentKey, 64, "Dependency incident key");
    bounded(receipt.receiptHash, 64, "Dependency receipt hash");
  }
}

async function projectReceipt(ctx: any, receipt: any, now: number) {
  const current = await ctx.db.query("dependencyHealthProjections")
    .withIndex("by_scope_dependency", (q: any) =>
      q.eq("scopeKey", receipt.scopeKey).eq("dependencyId", receipt.dependencyId)).first();
  if (current && (current.observedAt > receipt.observedAt
    || (current.observedAt === receipt.observedAt && current.receiptHash >= receipt.receiptHash))) return false;
  const value = { ...receipt, updatedAt: now };
  if (current) await ctx.db.patch(current._id, value);
  else await ctx.db.insert("dependencyHealthProjections", value);
  return true;
}

async function transitionIncident(ctx: any, receipt: any, incidentKey: string, now: number) {
  const current = await ctx.db.query("dependencySafetyIncidents")
    .withIndex("by_incidentKey", (q: any) => q.eq("incidentKey", incidentKey)).first();
  const signal = (state: string) => ({
    incidentKey, dependencyId: receipt.dependencyId, scopeKey: receipt.scopeKey,
    status: receipt.status, observedAt: receipt.observedAt, expiresAt: receipt.expiresAt,
    receiptHash: receipt.receiptHash, projectedState: state,
    recoveryIntervalMs: receipt.recoveryIntervalMs,
    requiredHealthyObservations: receipt.requiredHealthyObservations,
  });
  if (current?.lastReceiptHash === receipt.receiptHash) return signal(current.state);
  if (current && (current.lastObservedAt > receipt.observedAt
    || (current.lastObservedAt === receipt.observedAt && current.lastReceiptHash > receipt.receiptHash))) return null;
  const unhealthy = receipt.status !== "healthy" || receipt.expiresAt <= now;
  if (!unhealthy && !receipt.recoveryEligible) return null;
  if (!unhealthy && current?.state === "resolved") return null;
  let state: "open" | "half_open" | "recovering" | "resolved" = "open";
  let count = 0;
  if (!unhealthy && current) {
    const recoveryStartedAt = current.recoveryStartedAt ?? receipt.observedAt;
    const separated = receipt.observedAt - recoveryStartedAt >= receipt.recoveryIntervalMs;
    count = current.state === "open" ? 1 : current.healthyObservationCount + (separated ? 1 : 0);
    state = count >= receipt.requiredHealthyObservations ? "resolved" : count === 1 ? "half_open" : "recovering";
  } else if (!unhealthy && !current) {
    return null;
  }
  const value = {
    strategyAccountId: receipt.strategyAccountId, scopeKind: receipt.scopeKind, incidentKey,
    dependencyId: receipt.dependencyId, scopeKey: receipt.scopeKey, state,
    reasonCode: receipt.reasonCode, firstOpenedAt: current?.firstOpenedAt ?? receipt.observedAt,
    runbook: "docs/agent-runbook.md#dependency-safety-envelope",
    lastObservedAt: receipt.observedAt, healthyObservationCount: count,
    requiredHealthyObservations: receipt.requiredHealthyObservations, lastReceiptHash: receipt.receiptHash,
    recoveryStartedAt: unhealthy ? undefined : current?.recoveryStartedAt ?? receipt.observedAt,
    updatedAt: now, resolvedAt: state === "resolved" ? now : undefined,
  };
  if (current) await ctx.db.patch(current._id, value);
  else await ctx.db.insert("dependencySafetyIncidents", value);
  if (!current || current.state !== state) {
    await ctx.db.insert("incidentEvents", {
      strategyAccountId: receipt.strategyAccountId,
      severity: unhealthy ? "critical" : "info",
      code: `DEPENDENCY_${state.toUpperCase()}`,
      summary: `${receipt.dependencyId} is ${state.replaceAll("_", " ")}.`,
      detail: `${receipt.scopeKey} · ${receipt.reasonCode}`,
      runbook: "Review dependency safety on the Risk page; do not bypass blocked operations.",
      status: state === "resolved" ? "resolved" : "open",
      createdAt: now, updatedAt: now, resolvedAt: state === "resolved" ? now : undefined,
    });
  }
  return signal(state);
}

export const recordBundle = internalMutation({
  args: { receipts: v.array(receiptValidator), decision: decisionValidator },
  handler: async (ctx, args) => {
    validateBundle(args.receipts, args.decision);
    const now = Date.now();
    const existing = await ctx.db.query("safetyEnvelopeProjections")
      .withIndex("by_decisionHash", (q: any) => q.eq("decisionHash", args.decision.decisionHash)).first();
    const idempotent = await ctx.db.query("safetyEnvelopeProjections")
      .withIndex("by_matrix_idempotency", (q: any) => q.eq("matrixVersion", args.decision.matrixVersion)
        .eq("idempotencyKey", args.decision.idempotencyKey)).first();
    if (idempotent && idempotent.decisionHash !== args.decision.decisionHash) {
      throw new Error("Dependency safety idempotency conflict.");
    }
    const incidentSignals = [];
    for (const receipt of args.receipts) {
      const ownerCurrent = await projectReceipt(ctx, receipt, now);
      if (!ownerCurrent) continue;
      const signal = await transitionIncident(ctx, receipt, receipt.incidentKey, now);
      if (signal) incidentSignals.push(signal);
    }
    if (existing) {
      const projectionRevision = existing.projectionRevision ?? 1;
      const projectedAt = existing.updatedAt;
      const projectionHash = existing.projectionHash ?? await canonicalTaggedHash({
        schemaVersion: 1, strategyAccountId: String(args.decision.strategyAccountId),
        scopeKey: args.decision.scopeKey, operation: args.decision.operation,
        decisionId: args.decision.decisionId, decisionHash: args.decision.decisionHash,
        projectionRevision, projectedAt,
      });
      if (!existing.projectionHash || !existing.projectionRevision) {
        await ctx.db.patch(existing._id, { projectionHash, projectionRevision });
      }
      return { projectionId: String(existing._id), projectionHash,
        projectionRevision, projectedAt, duplicate: true, incidentSignals };
    }
    const prior = await ctx.db.query("safetyEnvelopeProjections")
      .withIndex("by_scope_operation", (q: any) =>
        q.eq("scopeKey", args.decision.scopeKey).eq("operation", args.decision.operation)).first();
    if (prior && projectionWouldRegress(prior, args.decision)) {
      const projectionRevision = prior.projectionRevision ?? 1;
      const projectedAt = prior.updatedAt;
      const projectionHash = prior.projectionHash ?? await canonicalTaggedHash({
        schemaVersion: 1, strategyAccountId: String(prior.strategyAccountId),
        scopeKey: prior.scopeKey, operation: prior.operation,
        decisionId: prior.decisionId, decisionHash: prior.decisionHash,
        projectionRevision, projectedAt,
      });
      if (!prior.projectionHash || !prior.projectionRevision) {
        await ctx.db.patch(prior._id, { projectionHash, projectionRevision });
      }
      return { projectionId: String(prior._id), projectionHash,
        projectionRevision, projectedAt, duplicate: false, superseded: true,
        incidentSignals };
    }
    const projectionRevision = (prior?.projectionRevision ?? 0) + 1;
    const projectionHash = await canonicalTaggedHash({
      schemaVersion: 1, strategyAccountId: String(args.decision.strategyAccountId),
      scopeKey: args.decision.scopeKey, operation: args.decision.operation,
      decisionId: args.decision.decisionId, decisionHash: args.decision.decisionHash,
      projectionRevision, projectedAt: now,
    });
    const value = { ...args.decision, projectionRevision, projectionHash, updatedAt: now };
    const decisionId = prior
      ? (await ctx.db.patch(prior._id, value), prior._id)
      : await ctx.db.insert("safetyEnvelopeProjections", value);
    return { projectionId: String(decisionId), projectionHash,
      projectionRevision, projectedAt: now, duplicate: false, incidentSignals };
  },
});

export const getAccountProjection = internalQuery({
  args: { strategyAccountId: v.id("strategyAccounts") },
  handler: async (ctx, args) => {
    const [decisions, health, accountIncidents, broadIncidents] = await Promise.all([
      ctx.db.query("safetyEnvelopeProjections").withIndex("by_strategyAccountId",
        (q: any) => q.eq("strategyAccountId", args.strategyAccountId)).collect(),
      ctx.db.query("dependencyHealthProjections").withIndex("by_strategyAccountId",
        (q: any) => q.eq("strategyAccountId", args.strategyAccountId)).collect(),
      ctx.db.query("dependencySafetyIncidents").withIndex("by_strategyAccountId",
        (q: any) => q.eq("strategyAccountId", args.strategyAccountId)).collect(),
      ctx.db.query("dependencySafetyIncidents").withIndex("by_scopeKind",
        (q: any) => q.eq("scopeKind", "global")).collect(),
    ]);
    const incidents = [...accountIncidents, ...broadIncidents.filter((item: any) =>
      !accountIncidents.some((account: any) => account.incidentKey === item.incidentKey))];
    return { decisions, health, incidents };
  },
});

export const getScopeProjection = internalQuery({
  args: { scopeKey: v.string() },
  handler: async (ctx, args) => {
    const [decisions, health, incidents] = await Promise.all([
      ctx.db.query("safetyEnvelopeProjections").withIndex("by_scope_operation",
        (q: any) => q.eq("scopeKey", args.scopeKey)).collect(),
      ctx.db.query("dependencyHealthProjections").withIndex("by_scope_dependency",
        (q: any) => q.eq("scopeKey", args.scopeKey)).collect(),
      ctx.db.query("dependencySafetyIncidents").withIndex("by_scopeKey",
        (q: any) => q.eq("scopeKey", args.scopeKey)).collect(),
    ]);
    return { decisions, health, incidents };
  },
});
