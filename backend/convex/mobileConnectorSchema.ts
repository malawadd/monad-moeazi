import {defineTable} from "convex/server";
import {v} from "convex/values";

export const mobileConnectorTables = {
  mobileConnectorOperations: defineTable({
    userId: v.id("users"), subject: v.string(), operationId: v.string(),
    kind: v.union(v.literal("purchase"), v.literal("activation"), v.literal("withdrawal")),
    idempotencyKey: v.string(), bindingHash: v.string(), status: v.string(),
    providerPinsJson: v.string(), payloadJson: v.string(),
    externalId: v.optional(v.string()), transactionHash: v.optional(v.string()),
    nonceKey: v.optional(v.string()), reservedWei: v.optional(v.string()), actualGasCost: v.optional(v.string()),
    actualCoverageCostWei: v.optional(v.string()),
    lastEventId: v.optional(v.string()), observedAt: v.optional(v.number()),
    expiresAt: v.number(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_operationId", ["operationId"])
    .index("by_subject_idempotency", ["subject", "idempotencyKey"])
    .index("by_subject", ["subject"])
    .index("by_nonce", ["nonceKey"]),
};
