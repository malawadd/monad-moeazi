import { defineTable } from "convex/server";
import { v } from "convex/values";

export const monadAutonomyTables = {
  monadAutonomyOperatorLease: defineTable({ key: v.string(), executorAddress: v.string(), orderId: v.string(),
    workflow: v.union(v.literal("autonomy"), v.literal("scenario")), status: v.string(),
    expiresAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_key", ["key"]),

  monadAutonomyEnrollments: defineTable({
    enrollmentId: v.string(), userId: v.id("users"), subject: v.string(), ownerAddress: v.string(),
    chainId: v.number(), factoryAddress: v.string(), vaultAddress: v.string(), nonce: v.string(),
    idempotencyKey: v.string(), amountUnits: v.string(), durationSeconds: v.number(), maxCycles: v.number(),
    tokensJson: v.string(), poolsJson: v.string(), startBy: v.number(), preparedExpiresAt: v.number(),
    circleNonce: v.string(), circleTypedDataJson: v.string(), mandateTypedDataJson: v.string(),
    mandateHash: v.string(), status: v.union(v.literal("prepared"), v.literal("activation_pending"),
      v.literal("active"), v.literal("settling"), v.literal("completed"), v.literal("incomplete_settlement"),
      v.literal("recovered"), v.literal("expired"), v.literal("failed"), v.literal("uncertain")),
    fundingTxHash: v.optional(v.string()), fundingRawTransaction: v.optional(v.string()),
    fundingNonce: v.optional(v.number()), fundingAttemptedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()), availableUsdcUnits: v.optional(v.string()),
    activatedAt: v.optional(v.number()),
    realizedPnlUsdcUnits: v.optional(v.string()), operatorGasMonWei: v.optional(v.string()),
    cyclesCompleted: v.number(), tickSequence: v.number(), openPositionJson: v.optional(v.string()), latestDecisionJson: v.optional(v.string()),
    lastCycleCompletedAt: v.optional(v.number()), lastTickId: v.optional(v.string()), leaseHolder: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()),
    nextTickId: v.optional(v.string()), scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    lastObservedBlock: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(), completedAt: v.optional(v.number()),
  }).index("by_enrollmentId", ["enrollmentId"])
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_userId_idempotencyKey", ["userId", "idempotencyKey"])
    .index("by_owner_status", ["ownerAddress", "status"]),

  monadAutonomyOrders: defineTable({
    enrollmentId: v.string(), ownerAddress: v.string(), orderId: v.string(), tickId: v.string(),
    kind: v.union(v.literal("funding"), v.literal("buy"), v.literal("sell"), v.literal("settle"), v.literal("recovery")),
    status: v.union(v.literal("prepared"), v.literal("broadcasting"), v.literal("submitted"),
      v.literal("finalized"), v.literal("failed"), v.literal("uncertain")),
    transactionJson: v.optional(v.string()), signedRawTransaction: v.optional(v.string()),
    txHash: v.optional(v.string()), nonce: v.optional(v.number()), executorAddress: v.optional(v.string()), quoteId: v.optional(v.string()),
    quoteExpiresAt: v.optional(v.number()), tokenIndex: v.optional(v.number()), amountInUnits: v.optional(v.string()),
    minimumOutUnits: v.optional(v.string()), expectedAmountOutUnits: v.optional(v.string()), amountOutUnits: v.optional(v.string()),
    rejectionCode: v.optional(v.string()),
    blockNumber: v.optional(v.number()), blockHash: v.optional(v.string()), receiptStatus: v.optional(v.number()),
    gasUsed: v.optional(v.string()), effectiveGasPrice: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_orderId", ["orderId"])
    .index("by_enrollmentId_createdAt", ["enrollmentId", "createdAt"])
    .index("by_owner_createdAt", ["ownerAddress", "createdAt"])
    .index("by_executor_nonce", ["executorAddress", "nonce"]),

  monadAutonomyObservations: defineTable({
    enrollmentId: v.string(), ownerAddress: v.string(), tokenIndex: v.number(), tokenAddress: v.string(),
    poolAddress: v.string(), priceUsdcPerTokenWad: v.string(), quoteInputUsdcUnits: v.string(),
    quoteOutputTokenUnits: v.string(), observedAt: v.number(), blockNumber: v.number(), finalized: v.boolean(),
    availableUsdcUnits: v.string(), positionAmountUnits: v.optional(v.string()), createdAt: v.number(),
  }).index("by_enrollment_token_time", ["enrollmentId", "tokenIndex", "observedAt"])
    .index("by_enrollment_time", ["enrollmentId", "observedAt"]),

  monadAutonomyEvents: defineTable({
    enrollmentId: v.string(), ownerAddress: v.string(), eventId: v.string(), timestamp: v.number(),
    type: v.string(), status: v.string(), summary: v.string(), ruleVersion: v.optional(v.string()),
    signalJson: v.optional(v.string()), inputsJson: v.optional(v.string()), outputJson: v.optional(v.string()),
    orderId: v.optional(v.string()), txHash: v.optional(v.string()), blockNumber: v.optional(v.number()),
    amountInUnits: v.optional(v.string()), amountOutUnits: v.optional(v.string()),
    tokenAddress: v.optional(v.string()), tokenSymbol: v.optional(v.string()),
  }).index("by_enrollment_timestamp", ["enrollmentId", "timestamp"])
    .index("by_owner_timestamp", ["ownerAddress", "timestamp"])
    .index("by_eventId", ["eventId"]),

  monadAutonomyScenarios: defineTable({
    scenarioId: v.string(), idempotencyKey: v.string(), poolAddress: v.string(), tokenAddress: v.string(), tokenIndex: v.number(),
    direction: v.union(v.literal("rising"), v.literal("flat"), v.literal("falling")),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("blocked"), v.literal("cancelled")),
    stepIndex: v.number(), stepCount: v.number(), intervalSeconds: v.number(), swapAmountUnits: v.string(),
    flatTokenAmountUnits: v.optional(v.string()),
    nextTickId: v.optional(v.string()), lastTickId: v.optional(v.string()), nextTickAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")), leaseHolder: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()),
    lastTxHash: v.optional(v.string()), lastBlockNumber: v.optional(v.number()), errorCode: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(), completedAt: v.optional(v.number()),
  }).index("by_scenarioId", ["scenarioId"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  monadAutonomyScenarioOrders: defineTable({
    orderId: v.string(), idempotencyKey: v.string(), scenarioId: v.optional(v.string()), stepIndex: v.optional(v.number()),
    tokenIndex: v.number(), direction: v.union(v.literal("up"), v.literal("down")),
    kind: v.union(v.literal("approval"), v.literal("swap")),
    status: v.union(v.literal("prepared"), v.literal("broadcasting"), v.literal("submitted"),
      v.literal("finalized"), v.literal("failed"), v.literal("uncertain")),
    executorAddress: v.string(), nonce: v.number(), transactionJson: v.string(), signedRawTransaction: v.string(),
    txHash: v.string(), quoteExpiresAt: v.number(), inputAsset: v.string(), outputAsset: v.string(),
    inputAmountUnits: v.string(), outputAmountUnits: v.optional(v.string()), expectedAmountOutUnits: v.string(),
    priceBeforeWad: v.optional(v.string()), priceAfterWad: v.optional(v.string()), rejectionCode: v.optional(v.string()),
    receiptStatus: v.optional(v.number()), blockNumber: v.optional(v.number()), blockHash: v.optional(v.string()),
    gasUsed: v.optional(v.string()), effectiveGasPrice: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_orderId", ["orderId"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_scenario_step", ["scenarioId", "stepIndex"])
    .index("by_executor_nonce", ["executorAddress", "nonce"]),

  monadAutonomyScenarioEvents: defineTable({
    scenarioId: v.string(), eventId: v.string(), type: v.string(), status: v.string(), timestamp: v.number(),
    summary: v.string(), transactionHash: v.optional(v.string()), blockNumber: v.optional(v.number()),
    inputAmountUnits: v.optional(v.string()), outputAmountUnits: v.optional(v.string()),
    priceBeforeWad: v.optional(v.string()), priceAfterWad: v.optional(v.string()),
  }).index("by_scenario_timestamp", ["scenarioId", "timestamp"])
    .index("by_eventId", ["eventId"]),
};
