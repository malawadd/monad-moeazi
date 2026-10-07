import { defineTable } from "convex/server";
import { v } from "convex/values";

export const monadVenueTables = {
  monadVenueRuns: defineTable({
    runId: v.string(), venueId: v.string(), userId: v.id("users"), subject: v.string(), ownerAddress: v.string(),
    chainId: v.number(), factoryAddress: v.string(), vaultAddress: v.string(), delegatedAccountAddress: v.optional(v.string()),
    accountId: v.optional(v.number()), instanceId: v.optional(v.number()), nonce: v.string(), idempotencyKey: v.string(),
    amountUnits: v.string(), minFundingUnits: v.string(), durationSeconds: v.number(), setupDeadline: v.number(),
    preparedExpiresAt: v.optional(v.number()), expiresAt: v.optional(v.number()),
    maxPositionExposureUnits: v.string(), maxLeverage: v.number(), marketIdsJson: v.string(), marketsJson: v.string(),
    policyVersion: v.number(), mandateJson: v.string(), mandateTypedDataJson: v.string(), mandateHash: v.optional(v.string()),
    mandateSignature: v.optional(v.string()),
    operatorSignature: v.string(), operatorDeadline: v.number(), fundingTransactionJson: v.string(),
    fundingRawTransaction: v.optional(v.string()), fundingTxHash: v.optional(v.string()), fundingStatus: v.optional(v.string()),
    activationRawTransaction: v.optional(v.string()), activationTxHash: v.optional(v.string()), activationStatus: v.optional(v.string()),
    stopTransactionJson: v.optional(v.string()), stopRawTransaction: v.optional(v.string()), stopTxHash: v.optional(v.string()),
    stopIdempotencyKey: v.optional(v.string()), stopPreparedExpiresAt: v.optional(v.number()),
    recoveryAction: v.optional(v.string()), recoveryTransactionJson: v.optional(v.string()), recoveryIdempotencyKey: v.optional(v.string()),
    recoveryPreparedExpiresAt: v.optional(v.number()), recoveryRawTransaction: v.optional(v.string()), recoveryTxHash: v.optional(v.string()),
    recoveryReason: v.optional(v.string()), keyExpiresAt: v.optional(v.number()),
    settlementReadyRawTransaction: v.optional(v.string()), settlementReadyTxHash: v.optional(v.string()), settlementReadyStatus: v.optional(v.string()),
    settlementCompleteRawTransaction: v.optional(v.string()), settlementCompleteTxHash: v.optional(v.string()), settlementCompleteStatus: v.optional(v.string()),
    vaultDeploymentTxHash: v.optional(v.string()), vaultDeploymentStatus: v.optional(v.string()),
    ownerAusdBeforeUnits: v.optional(v.string()), lastTickId: v.optional(v.string()),
    status: v.string(), phase: v.optional(v.string()), scenarioId: v.optional(v.string()), scenarioStep: v.optional(v.number()),
    balanceUnits: v.optional(v.string()), equityUnits: v.optional(v.string()), realizedPnlUnits: v.optional(v.string()),
    unrealizedPnlUnits: v.optional(v.string()), feesUnits: v.optional(v.string()), fundingUnits: v.optional(v.string()),
    returnedUnits: v.optional(v.string()), settlementJson: v.optional(v.string()), lastAccountBlock: v.optional(v.number()),
    lastObservedAt: v.optional(v.number()),
    lastRequestId: v.optional(v.number()), positionsJson: v.optional(v.string()), ordersJson: v.optional(v.string()),
    tickSequence: v.number(), nextTickId: v.optional(v.string()),
    leaseHolder: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")), createdAt: v.number(), updatedAt: v.number(),
    activatedAt: v.optional(v.number()), stoppedAt: v.optional(v.number()), completedAt: v.optional(v.number()),
  }).index("by_runId", ["runId"])
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_userId_owner_createdAt", ["userId", "ownerAddress", "createdAt"])
    .index("by_userId_idempotencyKey", ["userId", "idempotencyKey"])
    .index("by_owner_venue_status", ["ownerAddress", "venueId", "status"]),

  monadVenueOrders: defineTable({
    orderId: v.string(), runId: v.string(), venueId: v.string(), ownerAddress: v.string(), accountId: v.number(),
    requestId: v.number(), idempotencyKey: v.string(), kind: v.string(), status: v.string(),
    actionJson: v.string(), rawRequestJson: v.string(), rawResponseJson: v.optional(v.string()),
    dispatchStartedAt: v.optional(v.number()),
    orderIdAtVenue: v.optional(v.string()), txHash: v.optional(v.string()), rawTransaction: v.optional(v.string()),
    operatorNonce: v.optional(v.number()), blockNumber: v.optional(v.number()),
    fillsJson: v.optional(v.string()), errorCode: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_orderId", ["orderId"])
    .index("by_runId_createdAt", ["runId", "createdAt"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_account_request", ["venueId", "accountId", "requestId"]),

  monadVenueEvents: defineTable({
    eventId: v.string(), runId: v.string(), venueId: v.string(), userId: v.id("users"), ownerAddress: v.string(),
    kind: v.string(), status: v.string(), summary: v.string(), timestamp: v.number(), orderId: v.optional(v.string()),
    txHash: v.optional(v.string()), blockNumber: v.optional(v.number()), dataJson: v.optional(v.string()),
  }).index("by_eventId", ["eventId"])
    .index("by_run_timestamp", ["runId", "timestamp"])
    .index("by_owner_timestamp", ["ownerAddress", "timestamp"]),

  monadVenueObservations: defineTable({
    runId: v.string(), venueId: v.string(), ownerAddress: v.string(), marketId: v.number(), blockNumber: v.number(),
    observedAt: v.number(), finalized: v.boolean(), snapshotJson: v.string(), createdAt: v.number(),
  }).index("by_run_market_time", ["runId", "marketId", "observedAt"])
    .index("by_run_time", ["runId", "observedAt"]),

  monadVenueRequestCounters: defineTable({ venueId: v.string(), accountId: v.number(), lastRequestId: v.number(),
    lastReconciledAt: v.optional(v.number()), updatedAt: v.number() })
    .index("by_account", ["venueId", "accountId"]),

  monadVenueScenarios: defineTable({ scenarioId: v.string(), runId: v.string(), venueId: v.string(), userId: v.id("users"),
    ownerAddress: v.string(), idempotencyKey: v.string(), actionsJson: v.string(), intervalSeconds: v.number(),
    status: v.string(), stepIndex: v.number(), total: v.number(), nextAt: v.number(),
    activeOrderId: v.optional(v.string()), activeRequestId: v.optional(v.number()), activeActionKind: v.optional(v.string()),
    lastOrderId: v.optional(v.string()), lastVenueOrderId: v.optional(v.number()), lastRequestId: v.optional(v.number()), lastActionKind: v.optional(v.string()),
    errorCode: v.optional(v.string()), canceledAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_scenarioId", ["scenarioId"])
    .index("by_run_createdAt", ["runId", "createdAt"])
    .index("by_userId_idempotencyKey", ["userId", "idempotencyKey"]),
};
