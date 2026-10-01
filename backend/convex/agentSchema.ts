import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  analysisCadence,
  analysisJobStatus,
  analysisScope,
  agentLifecycleStatus,
  authorityMode,
  intelligenceTier,
  modelProvider,
  proposalStatus,
  controllerRefValidator,
} from "./agentValidators";

export const agentTables = {
  agentProfiles: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    tier: intelligenceTier,
    authorityMode,
    name: v.optional(v.string()),
    lifecycleStatus: v.optional(agentLifecycleStatus),
    cadence: analysisCadence,
    watchMarkets: v.array(v.string()),
    eventTriggers: v.array(v.string()),
    dailyCreditLimit: v.number(),
    paused: v.boolean(),
    nextRunAt: v.optional(v.number()),
    activatedAt: v.optional(v.number()),
    scheduleRevision: v.optional(v.number()),
    activeModelConfigurationId: v.optional(v.id("agentModelConfigurations")),
    activeModelConfigurationVersion: v.optional(v.number()),
    currentTeamVersionId: v.optional(v.id("agentTeamVersions")),
    allocationUsd: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_userId", ["userId"])
    .index("by_nextRunAt", ["nextRunAt"]),

  agentTeamVersions: defineTable({
    teamId: v.id("agentProfiles"),
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    version: v.number(),
    status: v.union(v.literal("saved"), v.literal("legacy")),
    configJson: v.string(),
    createdAt: v.number(),
  })
    .index("by_teamId", ["teamId"])
    .index("by_teamId_version", ["teamId", "version"]),

  agentTeamDrafts: defineTable({
    teamId: v.id("agentProfiles"), strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"), configJson: v.string(), updatedAt: v.number(),
  }).index("by_teamId", ["teamId"]),

  agentMarketDeployments: defineTable({
    teamId: v.id("agentProfiles"),
    teamVersionId: v.id("agentTeamVersions"),
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    marketId: v.string(),
    venue: v.string(),
    mode: authorityMode,
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("blocked")),
    blockedReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_teamId_marketId", ["teamId", "marketId"])
    .index("by_strategyAccountId_marketId", ["strategyAccountId", "marketId"]),

  modelProviderConnections: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    provider: modelProvider,
    label: v.string(),
    secretRef: v.string(),
    keyFingerprint: v.string(),
    keyLast4: v.string(),
    status: v.union(
      v.literal("pending"), v.literal("verified"),
      v.literal("invalid"), v.literal("revoked"),
    ),
    modelsJson: v.string(),
    capabilitiesJson: v.string(),
    failureReason: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_provider", ["strategyAccountId", "provider"])
    .index("by_secretRef", ["secretRef"]),

  agentModelConfigurations: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    version: v.number(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("superseded")),
    preset: v.union(v.literal("economy"), v.literal("balanced"), v.literal("quality"), v.literal("custom")),
    routesJson: v.string(),
    pricingVersion: v.string(),
    estimatedCredits: v.number(),
    estimatedProviderCostMicrousd: v.number(),
    maximumProviderCostMicrousd: v.number(),
    providerDailyLimitMicrousd: v.number(),
    retries: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    activatedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_status", ["strategyAccountId", "status"]),

  agentTeamModelDefaults: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    preset: v.union(v.literal("economy"), v.literal("balanced"), v.literal("quality"), v.literal("custom")),
    routesJson: v.string(),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_strategyAccountId", ["strategyAccountId"]),

  agentMarketSubscriptions: defineTable({
    profileId: v.id("agentProfiles"),
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    marketId: v.string(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_profileId", ["profileId"])
    .index("by_marketId_enabled", ["marketId", "enabled"])
    .index("by_strategyAccountId_marketId", ["strategyAccountId", "marketId"]),

  automationPolicies: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    version: v.number(),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("superseded")),
    sourceText: v.optional(v.string()),
    policyJson: v.string(),
    diffJson: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    activatedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_status", ["strategyAccountId", "status"]),

  analysisJobs: defineTable({
    controllerRef: v.optional(controllerRefValidator),
    controllerMode: v.optional(authorityMode),
    analysisId: v.optional(v.string()),
    teamId: v.optional(v.id("agentProfiles")),
    teamVersionId: v.optional(v.id("agentTeamVersions")),
    deploymentId: v.optional(v.id("agentMarketDeployments")),
    programAssignmentId: v.optional(v.id("programAssignments")),
    programVersionId: v.optional(v.id("tradingProgramVersions")),
    agentReleaseVersionId: v.optional(v.id("tradingProgramVersions")),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    userId: v.optional(v.id("users")),
    scope: analysisScope,
    marketId: v.string(),
    tier: intelligenceTier,
    trigger: v.string(),
    status: analysisJobStatus,
    dedupeKey: v.string(),
    payloadJson: v.optional(v.string()),
    reservedCredits: v.number(),
    holderId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    attempt: v.number(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_dedupeKey", ["dedupeKey"])
    .index("by_scope_marketId", ["scope", "marketId"])
    .index("by_scope_marketId_status", ["scope", "marketId", "status"])
    .index("by_strategyAccountId_marketId_status", ["strategyAccountId", "marketId", "status"])
      .index("by_deploymentId_status", ["deploymentId", "status"])
      .index("by_teamId_status", ["teamId", "status"])
      .index("by_strategyAccountId", ["strategyAccountId"]),

  analysisSnapshots: defineTable({
    controllerRef: v.optional(controllerRefValidator),
    teamId: v.optional(v.id("agentProfiles")),
    teamVersionId: v.optional(v.id("agentTeamVersions")),
    deploymentId: v.optional(v.id("agentMarketDeployments")),
    programAssignmentId: v.optional(v.id("programAssignments")),
    programVersionId: v.optional(v.id("tradingProgramVersions")),
    agentReleaseVersionId: v.optional(v.id("tradingProgramVersions")),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    scope: analysisScope,
    marketId: v.string(),
    analysisId: v.string(),
    tier: intelligenceTier,
    status: v.union(v.literal("fresh"), v.literal("degraded"), v.literal("failed")),
    payloadJson: v.string(),
    providersJson: v.string(),
    lifecycleDecisionHash: v.optional(v.string()),
    sourceFreshnessMs: v.number(),
    validUntil: v.number(),
    createdAt: v.number(),
  })
    .index("by_scope_marketId", ["scope", "marketId"])
    .index("by_strategyAccountId_marketId", ["strategyAccountId", "marketId"])
    .index("by_strategyAccountId_scope_marketId", ["strategyAccountId", "scope", "marketId"])
    .index("by_deploymentId", ["deploymentId"])
    .index("by_programAssignmentId_marketId", ["programAssignmentId", "marketId"]),


  tradeProposals: defineTable({
    jobId: v.optional(v.id("analysisJobs")),
    controllerRef: v.optional(controllerRefValidator),
    controllerMode: v.optional(authorityMode),
    agreementStrength: v.optional(v.number()),
    teamId: v.optional(v.id("agentProfiles")),
    teamVersionId: v.optional(v.id("agentTeamVersions")),
    deploymentId: v.optional(v.id("agentMarketDeployments")),
    programAssignmentId: v.optional(v.id("programAssignments")),
    programVersionId: v.optional(v.id("tradingProgramVersions")),
    agentReleaseVersionId: v.optional(v.id("tradingProgramVersions")),
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    analysisId: v.string(),
    policyVersion: v.number(),
    marketId: v.string(),
    side: v.union(v.literal("long"), v.literal("short")),
    status: proposalStatus,
    payloadJson: v.string(),
    confidence: v.number(),
    consensus: v.number(),
    idempotencyKey: v.string(),
    proposalSafetyDecisionHash: v.optional(v.string()),
    approvalSafetyDecisionHash: v.optional(v.string()),
    analysisSafetyDecisionHash: v.optional(v.string()),
    lifecycleDecisionHash: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_status", ["strategyAccountId", "status"])
      .index("by_deploymentId", ["deploymentId"])
      .index("by_teamId_status", ["teamId", "status"])
      .index("by_idempotencyKey", ["idempotencyKey"])
      .index("by_programAssignmentId", ["programAssignmentId"]),

  managedUniswapTradeReceipts: defineTable({
    proposalId: v.id("tradeProposals"), strategyAccountId: v.id("strategyAccounts"),
    assignmentId: v.id("programAssignments"), programVersionId: v.id("tradingProgramVersions"),
    intentId: v.string(), attemptId: v.string(), reservationId: v.string(), grantId: v.string(),
    userOperationHash: v.optional(v.string()), transactionHash: v.string(),
    vaultAddress: v.optional(v.string()), orderId: v.optional(v.string()),
    confirmedBlockNumber: v.string(), confirmedBlockHash: v.string(),
    postFillSnapshotHash: v.string(), financeRevision: v.string(),
    journalTransactionId: v.string(), actualInputUnits: v.string(), actualOutputUnits: v.string(),
    createdAt: v.number(),
  }).index("by_proposalId", ["proposalId"])
    .index("by_transactionHash", ["transactionHash"]),

  shadowExecutions: defineTable({
    teamId: v.optional(v.id("agentProfiles")),
    teamVersionId: v.optional(v.id("agentTeamVersions")),
    deploymentId: v.optional(v.id("agentMarketDeployments")),
    programAssignmentId: v.optional(v.id("programAssignments")),
    programVersionId: v.optional(v.id("tradingProgramVersions")),
    proposalId: v.id("tradeProposals"),
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    marketId: v.string(),
    side: v.union(v.literal("long"), v.literal("short")),
    status: v.union(v.literal("open"), v.literal("closed"), v.literal("expired")),
    entryPrice: v.number(),
    markPrice: v.number(),
    sizeUsd: v.number(),
    unrealizedPnlUsd: v.number(),
    realizedPnlUsd: v.number(),
    quoteReference: v.string(),
    safetyDecisionHash: v.optional(v.string()),
    openedAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_status", ["strategyAccountId", "status"])
      .index("by_deploymentId", ["deploymentId"])
      .index("by_teamId_status", ["teamId", "status"])
      .index("by_proposalId", ["proposalId"])
      .index("by_programAssignmentId", ["programAssignmentId"]),

  approvalRequests: defineTable({
    teamId: v.optional(v.id("agentProfiles")),
    teamVersionId: v.optional(v.id("agentTeamVersions")),
    deploymentId: v.optional(v.id("agentMarketDeployments")),
    proposalId: v.id("tradeProposals"),
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.id("users"),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index("by_proposalId", ["proposalId"])
      .index("by_deploymentId_status", ["deploymentId", "status"])
      .index("by_teamId_status", ["teamId", "status"])
      .index("by_userId_status", ["userId", "status"]),

  creditAccounts: defineTable({
    userId: v.id("users"),
    balance: v.number(),
    reserved: v.number(),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  creditReservations: defineTable({
    teamId: v.optional(v.id("agentProfiles")),
    creditAccountId: v.id("creditAccounts"),
    userId: v.id("users"),
    jobId: v.optional(v.id("analysisJobs")),
    experimentId: v.optional(v.string()),
    amount: v.number(),
    status: v.union(v.literal("active"), v.literal("settled"), v.literal("released")),
    billingPaused: v.optional(v.boolean()),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_jobId", ["jobId"])
      .index("by_experimentId", ["experimentId"])
      .index("by_teamId_status", ["teamId", "status"])
      .index("by_userId_status", ["userId", "status"]),

  creditLedger: defineTable({
    teamId: v.optional(v.id("agentProfiles")),
    creditAccountId: v.id("creditAccounts"),
    userId: v.id("users"),
    kind: v.union(
      v.literal("grant"),
      v.literal("reserve"),
      v.literal("release"),
      v.literal("settle"),
    ),
    amount: v.number(),
    balanceAfter: v.number(),
    reservedAfter: v.number(),
    rateCardVersion: v.number(),
    reference: v.string(),
    metadataJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_reference", ["reference"]),

  creditClaims: defineTable({
    userId: v.id("users"),
    kind: v.literal("development_starter"),
    amount: v.number(),
    reference: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId_kind", ["userId", "kind"])
    .index("by_reference", ["reference"]),

  publicMarketDemand: defineTable({
    marketId: v.string(),
    sessionHash: v.string(),
    lastSeenAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_marketId", ["marketId"])
    .index("by_marketId_sessionHash", ["marketId", "sessionHash"]),
};
