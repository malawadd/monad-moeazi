import { defineTable } from "convex/server";
import { v } from "convex/values";

export const monadManualTables = {
  monadManualAccounts: defineTable({
    userId: v.id("users"), ownerAddress: v.string(), chainId: v.number(), venueId: v.string(),
    accountAddress: v.string(), accountId: v.optional(v.number()), status: v.string(),
    balanceUnits: v.optional(v.string()), lockedUnits: v.optional(v.string()),
    lastObservedBlock: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_user_owner", ["userId", "ownerAddress"])
    .index("by_owner_venue", ["ownerAddress", "venueId"])
    .index("by_account_address", ["accountAddress"]),

  monadManualOperations: defineTable({
    userId: v.id("users"), ownerAddress: v.string(), chainId: v.number(), venueId: v.string(),
    operationId: v.string(), idempotencyKey: v.string(), intentHash: v.string(), action: v.string(),
    actionJson: v.string(), transactionJson: v.string(), nonce: v.number(), expiresAt: v.number(),
    accountAddress: v.optional(v.string()), accountId: v.optional(v.number()),
    marketId: v.optional(v.number()), requestId: v.optional(v.number()),
    status: v.string(), signedTransaction: v.optional(v.string()), txHash: v.optional(v.string()),
    receiptStatus: v.optional(v.number()), blockNumber: v.optional(v.number()), blockHash: v.optional(v.string()),
    resultJson: v.optional(v.string()), errorCode: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_user_operation", ["userId", "operationId"])
    .index("by_operationId", ["operationId"])
    .index("by_user_idempotency", ["userId", "idempotencyKey"])
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_nonce", ["userId", "nonce"])
    .index("by_owner_status", ["ownerAddress", "status"]),

  monadTradeSummaries: defineTable({
    userId: v.id("users"), ownerAddress: v.string(), summaryId: v.string(), venueId: v.string(),
    marketId: v.string(), symbol: v.string(), direction: v.string(), sizeUnits: v.string(),
    entrySizeUnits: v.optional(v.string()), remainingSizeUnits: v.optional(v.string()), runId: v.optional(v.string()),
    accountAddress: v.optional(v.string()), priceDecimals: v.optional(v.number()), sizeDecimals: v.optional(v.number()),
    weightedEntryPrice: v.optional(v.string()), weightedExitPrice: v.optional(v.string()),
    exitSizeUnits: v.optional(v.string()), exitValueNumerator: v.optional(v.string()),
    realizedPricePnlUnits: v.optional(v.string()), entryAt: v.optional(v.number()), exitAt: v.optional(v.number()),
    feesUnits: v.string(), fundingUnits: v.optional(v.string()), netRealizedPnlUnits: v.optional(v.string()), status: v.string(), source: v.string(),
    orderIdsJson: v.string(), transactionHashesJson: v.string(), activityIdsJson: v.string(),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_user_owner_created", ["userId", "ownerAddress", "createdAt"])
    .index("by_owner_venue_market", ["ownerAddress", "venueId", "marketId"])
    .index("by_summary", ["summaryId"]),
};
