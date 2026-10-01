import { defineTable } from "convex/server";
import { v } from "convex/values";
import { managedTradingVenue } from "./agentValidators";

const programComposition = {
  sourceStrategyAccountId: v.id("strategyAccounts"),
  teamVersionId: v.id("agentTeamVersions"),
  modelConfigurationId: v.id("agentModelConfigurations"),
  policyId: v.id("automationPolicies"),
  strategyArtifactHash: v.string(),
  adapterProfileHash: v.string(),
  runtimeCompatibility: v.string(),
};

export const programTables = {
  tradingPrograms: defineTable({
    name: v.string(), createdBySubject: v.string(), idempotencyKey: v.string(), requestHash: v.string(),
    releasedVersionId: v.optional(v.id("tradingProgramVersions")),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_createdBySubject", ["createdBySubject"]),
  tradingProgramDrafts: defineTable({
    programId: v.id("tradingPrograms"), ...programComposition,
    revision: v.number(), updatedBySubject: v.string(), updatedAt: v.number(),
  }).index("by_programId", ["programId"]),
  tradingProgramVersions: defineTable({
    programId: v.id("tradingPrograms"), version: v.number(), ...programComposition,
    teamConfigJson: v.string(), modelConfigurationJson: v.string(), policyJson: v.string(),
    teamConfigHash: v.string(), modelConfigurationHash: v.string(), policyHash: v.string(),
    contentHash: v.string(), frozenBySubject: v.string(), createdAt: v.number(),
  }).index("by_programId", ["programId"])
    .index("by_programId_version", ["programId", "version"])
    .index("by_contentHash", ["contentHash"]),
  programAssignments: defineTable({
    strategyAccountId: v.id("strategyAccounts"), userId: v.id("users"),
    programVersionId: v.id("tradingProgramVersions"),
    status: v.union(v.literal("paused"), v.literal("active"), v.literal("revoked")),
    controllerMode: v.optional(v.union(v.literal("shadow"), v.literal("autopilot"))),
    shadowCadenceEnabled: v.optional(v.boolean()),
    // Only Stop/Start set the pending state. A trusted native close projection may
    // mark the assignment flat after settlement and finalized zero-exposure proof.
    positionClosureState: v.optional(v.union(v.literal("unconfirmed"), v.literal("confirmed_flat"))),
    positionClosureUpdatedAt: v.optional(v.number()),
    source: v.union(v.literal("explicit"), v.literal("migration")),
    assignedBySubject: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_strategyAccountId", ["strategyAccountId"]),
  managedSpotMandates: defineTable({
    userId: v.id("users"), strategyAccountId: v.id("strategyAccounts"),
    assignmentId: v.id("programAssignments"), programVersionId: v.id("tradingProgramVersions"),
    ownerAddress: v.string(), programHash: v.string(), policyHash: v.string(),
    capitalUnits: v.string(), maxBuyUnits: v.string(), durationDays: v.number(),
    expiresAt: v.number(), mandateHash: v.string(), idempotencyKey: v.string(),
    status: v.union(v.literal("awaiting_vault"), v.literal("expired_unfunded"), v.literal("vault_ready"),
      v.literal("funding_uncertain"), v.literal("active"), v.literal("stopped"),
      v.literal("closed")),
    provisioningState: v.optional(v.union(v.literal("claimed"),
      v.literal("submitted"), v.literal("uncertain"))),
    provisioningTransactionHash: v.optional(v.string()),
    stopState: v.optional(v.union(v.literal("claimed"), v.literal("submitted"),
      v.literal("uncertain"), v.literal("confirmed"))),
    stopTransactionHash: v.optional(v.string()),
    stopFinalizedBlockNumber: v.optional(v.string()),
    stopFinalizedBlockHash: v.optional(v.string()),
    releaseTransactionHash: v.optional(v.string()),
    releaseAmountUnits: v.optional(v.string()),
    releaseFinalizedBlockNumber: v.optional(v.string()),
    releaseFinalizedBlockHash: v.optional(v.string()),
    releaseFinanceSnapshotHash: v.optional(v.string()),
    releaseJournalTransactionId: v.optional(v.string()),
    vaultAddress: v.optional(v.string()), vaultCodeHash: v.optional(v.string()),
    executorAddress: v.optional(v.string()),
    venueAccountId: v.optional(v.id("venueAccounts")),
    fundingOperationId: v.optional(v.string()),
    fundingTransactionHash: v.optional(v.string()), finalizedBlockHash: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  }).index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_idempotencyKey", ["strategyAccountId", "idempotencyKey"])
    .index("by_vaultAddress", ["vaultAddress"]),
  managedSpotFundingOperations: defineTable({
    mandateId: v.id("managedSpotMandates"), userId: v.id("users"),
    ownerAddress: v.string(), operationId: v.string(), rootHash: v.string(),
    transactionJson: v.string(),
    status: v.union(v.literal("prepared"), v.literal("submitting"),
      v.literal("uncertain"), v.literal("submitted"), v.literal("confirmed")),
    particleTransactionId: v.optional(v.string()),
    expiresAt: v.number(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_mandateId", ["mandateId"])
    .index("by_operationId", ["operationId"]),
  // Written only by the trusted native-finance authority producer. This table has
  // no public mutation; a source label or content hash alone is not provenance.
  managedProgramActivationAuthorities: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    assignmentId: v.id("programAssignments"),
    programVersionId: v.id("tradingProgramVersions"),
    contentHash: v.string(),
    ownerAddress: v.string(),
    financeSnapshotHash: v.string(),
    accountRevision: v.string(),
    writerEpoch: v.string(),
    authorityEpoch: v.string(),
    venue: managedTradingVenue,
    venueAccountId: v.id("venueAccounts"),
    executionGrantId: v.string(),
    executionGrantHash: v.string(),
    source: v.literal("native_finance_authority"),
    state: v.union(v.literal("ready"), v.literal("blocked"), v.literal("revoked")),
    expiresAt: v.number(),
    receiptHash: v.string(),
  }).index("by_assignmentId", ["assignmentId"])
    .index("by_assignmentId_venue", ["assignmentId", "venue"])
    .index("by_strategyAccountId", ["strategyAccountId"]),
  managedUniswapCloseReceipts: defineTable({
    strategyAccountId: v.id("strategyAccounts"), assignmentId: v.id("programAssignments"),
    programVersionId: v.id("tradingProgramVersions"), ownerAddress: v.string(),
    grantId: v.string(), financeSnapshotHash: v.string(), financeRevision: v.string(),
    confirmedBlockNumber: v.string(), confirmedBlockHash: v.string(),
    wethUnits: v.string(), pendingAttemptCount: v.number(),
    exitAttemptId: v.string(), exitReservationId: v.string(), exitIntentId: v.string(),
    actualWethInputUnits: v.string(), actualUsdcOutputUnits: v.string(),
    exitTransactionHash: v.string(), journalTransactionId: v.string(),
    source: v.literal("native_finance_close"), createdAt: v.number(),
  }).index("by_assignmentId", ["assignmentId"])
    .index("by_exitTransactionHash", ["exitTransactionHash"]),
  managedUniswapFlatObservations: defineTable({
    strategyAccountId: v.id("strategyAccounts"), assignmentId: v.id("programAssignments"),
    programVersionId: v.id("tradingProgramVersions"), ownerAddress: v.string(),
    financeSnapshotHash: v.string(), financeRevision: v.string(),
    finalizedBlockNumber: v.string(), finalizedBlockHash: v.string(),
    wethUnits: v.string(), pendingAttemptCount: v.number(),
    source: v.literal("native_finance_observed_flat"), createdAt: v.number(),
  }).index("by_assignmentId", ["assignmentId"])
    .index("by_financeSnapshotHash", ["financeSnapshotHash"]),
  experimentSpecs: defineTable({
    createdBySubject: v.string(), strategyAccountId: v.id("strategyAccounts"),
    idempotencyKey: v.string(), requestHash: v.string(),
    controllerKind: v.union(v.literal("customer_team"), v.literal("managed_program")),
    controllerVersionId: v.string(), contentHash: v.string(), environment: v.literal("experiment"),
    specJson: v.string(), createdAt: v.number(),
  }).index("by_createdBySubject", ["createdBySubject"])
    .index("by_createdBySubject_strategyAccountId", ["createdBySubject", "strategyAccountId"])
    .index("by_createdBySubject_idempotencyKey", ["createdBySubject", "idempotencyKey"]),
};
