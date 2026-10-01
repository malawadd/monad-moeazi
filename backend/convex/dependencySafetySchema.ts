import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  breakerState, dependencyFailureDomain, dependencyStatus, incidentState,
  safetyMode, safetyOperation, safetyOutcome,
} from "./dependencySafetyValidators";

export const dependencySafetyTables = {
  dependencyHealthProjections: defineTable({
    schemaVersion: v.optional(v.number()),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    dependencyId: v.string(),
    failureDomain: dependencyFailureDomain,
    scopeKind: v.string(),
    scopeKey: v.string(),
    status: dependencyStatus,
    observedAt: v.number(),
    expiresAt: v.number(),
    reasonCode: v.string(),
    evidenceReference: v.optional(v.string()),
    sourceRevision: v.string(),
    adapterVersion: v.string(),
    observationKey: v.string(),
    receiptId: v.string(),
    incidentKey: v.string(),
    receiptHash: v.string(),
    recoveryEligible: v.boolean(),
    recoveryIntervalMs: v.number(),
    requiredHealthyObservations: v.number(),
    updatedAt: v.number(),
  })
    .index("by_scope_dependency", ["scopeKey", "dependencyId"])
    .index("by_strategyAccountId", ["strategyAccountId"]),

  safetyEnvelopeProjections: defineTable({
    schemaVersion: v.optional(v.number()),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    operation: safetyOperation,
    subjectKey: v.string(),
    scopeKey: v.string(),
    mode: safetyMode,
    breakerState,
    outcome: safetyOutcome,
    reasons: v.array(v.string()),
    receiptHashes: v.array(v.string()),
    incidentKeys: v.array(v.string()),
    bindingsJson: v.string(),
    decisionId: v.string(),
    decisionHash: v.string(),
    matrixVersion: v.string(),
    evaluatedAt: v.number(),
    expiresAt: v.number(),
    idempotencyKey: v.string(),
    bindingHash: v.string(),
    requestHash: v.string(),
    projectionRevision: v.optional(v.number()),
    projectionHash: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_scope_operation", ["scopeKey", "operation"])
    .index("by_decisionHash", ["decisionHash"])
    .index("by_matrix_idempotency", ["matrixVersion", "idempotencyKey"]),

  dependencySafetyIncidents: defineTable({
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    scopeKind: v.string(),
    incidentKey: v.string(),
    dependencyId: v.string(),
    scopeKey: v.string(),
    state: incidentState,
    reasonCode: v.string(),
    runbook: v.string(),
    firstOpenedAt: v.number(),
    lastObservedAt: v.number(),
    healthyObservationCount: v.number(),
    requiredHealthyObservations: v.number(),
    recoveryStartedAt: v.optional(v.number()),
    lastReceiptHash: v.string(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_incidentKey", ["incidentKey"])
    .index("by_scopeKey", ["scopeKey"])
    .index("by_scopeKind", ["scopeKind"])
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_state", ["strategyAccountId", "state"]),
};
