import { defineTable } from "convex/server";
import { v } from "convex/values";

export const monadPerpTables = {
  monadPerpRuns: defineTable({
    runId: v.string(), userId: v.id("users"), subject: v.string(), ownerAddress: v.string(),
    chainId: v.number(), factoryAddress: v.string(), clearinghouseAddress: v.string(), vaultAddress: v.string(),
    nonce: v.string(), idempotencyKey: v.string(), amountUnits: v.string(), durationSeconds: v.number(),
    setupDeadline: v.number(), preparedExpiresAt: v.number(), circleNonce: v.string(),
    circleTypedDataJson: v.string(), mandateTypedDataJson: v.string(), mandateHash: v.string(),
    marketsJson: v.string(), policyVersion: v.number(), status: v.string(),
    fundingTxHash: v.optional(v.string()), fundingRawTransaction: v.optional(v.string()),
    fundingNonce: v.optional(v.number()), fundingStatus: v.optional(v.string()), executorAddress: v.optional(v.string()),
    activatedAt: v.optional(v.number()), expiresAt: v.optional(v.number()), stoppedAt: v.optional(v.number()),
    availableUsdcUnits: v.optional(v.string()), realizedPnlUsdcUnits: v.optional(v.string()),
    returnedUsdcUnits: v.optional(v.string()),
    unrealizedPnlUsdcUnits: v.optional(v.string()), operatorGasMonWei: v.optional(v.string()),
    markPriceWad: v.optional(v.string()), equityUsdcUnits: v.optional(v.string()),
    positionJson: v.optional(v.string()), pendingOrderJson: v.optional(v.string()),
    activeScenarioId: v.optional(v.string()), stopOrderId: v.optional(v.string()),
    lastObservedBlock: v.optional(v.number()), lastTickId: v.optional(v.string()), nextTickId: v.optional(v.string()),
    tickSequence: v.number(), leaseHolder: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")), createdAt: v.number(), updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_runId", ["runId"])
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_userId_owner_createdAt", ["userId", "ownerAddress", "createdAt"])
    .index("by_userId_idempotencyKey", ["userId", "idempotencyKey"])
    .index("by_owner_status", ["ownerAddress", "status"]),

  monadPerpOrders: defineTable({
    runId: v.string(), ownerAddress: v.string(), orderId: v.string(), idempotencyKey: v.string(),
    kind: v.string(), status: v.string(), marketIndex: v.optional(v.number()), side: v.optional(v.string()),
    leverage: v.optional(v.number()), marginUnits: v.optional(v.string()), sizeWad: v.optional(v.string()),
    limitPriceWad: v.optional(v.string()), expectedPriceWad: v.optional(v.string()),
    validUntil: v.optional(v.number()), quoteBlockNumber: v.optional(v.number()),
    vaultAddress: v.optional(v.string()), clearinghouseAddress: v.optional(v.string()),
    scenarioId: v.optional(v.string()), scenarioStep: v.optional(v.number()),
    transactionJson: v.string(), signedRawTransaction: v.string(), txHash: v.string(),
    executorAddress: v.string(), nonce: v.number(), blockNumber: v.optional(v.number()),
    blockHash: v.optional(v.string()), receiptStatus: v.optional(v.number()), gasUsed: v.optional(v.string()),
    effectiveGasPrice: v.optional(v.string()), errorCode: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_orderId", ["orderId"]).index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_runId_createdAt", ["runId", "createdAt"])
    .index("by_executor_nonce", ["executorAddress", "nonce"]),

  monadPerpObservations: defineTable({ runId: v.string(), ownerAddress: v.string(), marketIndex: v.number(),
    symbol: v.string(), tokenAddress: v.string(), poolAddress: v.string(), priceUsdcPerTokenWad: v.string(),
    observedAt: v.number(), blockNumber: v.number(), finalized: v.boolean(), positionJson: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_run_market_time", ["runId", "marketIndex", "observedAt"])
    .index("by_run_time", ["runId", "observedAt"]),

  monadPerpEvents: defineTable({ runId: v.string(), ownerAddress: v.string(), eventId: v.string(),
    timestamp: v.number(), type: v.string(), status: v.string(), summary: v.string(),
    orderId: v.optional(v.string()), txHash: v.optional(v.string()), blockNumber: v.optional(v.number()),
    payloadJson: v.optional(v.string()),
  }).index("by_eventId", ["eventId"]).index("by_run_timestamp", ["runId", "timestamp"])
    .index("by_owner_timestamp", ["ownerAddress", "timestamp"]),

  monadPerpScenarios: defineTable({ scenarioId: v.string(), idempotencyKey: v.string(), runId: v.string(),
    ownerAddress: v.string(), scriptJson: v.string(), status: v.string(), stepIndex: v.number(),
    errorCode: v.optional(v.string()), lastAction: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_scenarioId", ["scenarioId"]).index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_runId", ["runId", "createdAt"]),
};
