import { defineTable } from "convex/server";
import { v } from "convex/values";

const outcome = v.union(v.literal("allow"), v.literal("transformed"), v.literal("drop"),
  v.literal("quarantine"), v.literal("block"), v.literal("unknown"));

export const evidenceLifecycleTables = {
  evidenceLifecycleProjections: defineTable({
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    artifactId: v.string(), producer: v.string(), purpose: v.string(), sink: v.string(),
    scopeKind: v.string(), scopeKey: v.string(), outcome, reasons: v.array(v.string()),
    policyHash: v.string(), inventoryHash: v.string(), decisionHash: v.string(),
    sanitizedPayloadHash: v.optional(v.string()), retentionScheduleHash: v.optional(v.string()),
    evaluatedAt: v.number(), expiresAt: v.number(), updatedAt: v.number(),
  })
    .index("by_account_decisionHash", ["strategyAccountId", "decisionHash"])
    .index("by_account_artifact_sink", ["strategyAccountId", "artifactId", "sink"])
    .index("by_strategyAccountId", ["strategyAccountId"]),

  evidenceLifecycleCopyProjections: defineTable({
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    artifactId: v.string(), copyId: v.string(), ownerId: v.string(), revision: v.number(),
    receiptHash: v.string(), status: v.string(), observedAt: v.number(), updatedAt: v.number(),
  })
    .index("by_account_artifact_copy", ["strategyAccountId", "artifactId", "copyId"])
    .index("by_strategyAccountId", ["strategyAccountId"]),

  evidenceLifecycleStatusProjections: defineTable({
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    artifactId: v.string(), scopeKey: v.string(), lifecycleState: v.union(
      v.literal("governed"), v.literal("held"), v.literal("partial"),
      v.literal("deleted"), v.literal("quarantined"), v.literal("unverifiable")),
    expectedCopyCount: v.number(), resolvedCopyCount: v.number(),
    holdRevision: v.optional(v.number()),
    holdHash: v.optional(v.string()), deletionReceiptHash: v.optional(v.string()),
    latestDecisionHash: v.string(), transitionHash: v.string(),
    transitionAt: v.number(), transitionPhase: v.string(), updatedAt: v.number(),
  })
    .index("by_account_artifactId", ["strategyAccountId", "artifactId"])
    .index("by_strategyAccountId", ["strategyAccountId"]),
};
