import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { agentTables } from "./agentSchema";
import { dependencySafetyTables } from "./dependencySafetySchema";
import { evidenceLifecycleTables } from "./evidenceLifecycleSchema";
import { mobileConnectorTables } from "./mobileConnectorSchema";
import { mobileNotificationTables } from "./mobileNotificationsSchema";
import { programTables } from "./programSchema";
import { financeProjectionTables } from "./financeProjectionSchema";
import { monadTables } from "./monadSchema";
import { monadAutonomyTables } from "./monadAutonomySchema";
import { monadPerpTables } from "./monadPerpSchema";
import { monadVenueTables } from "./monadVenueSchema";
import { monadManualTables } from "./monadManualSchema";
import { managedTradingVenue, managedVenueRole } from "./agentValidators";

export default defineSchema({
  ...programTables,
  ...financeProjectionTables,
  ...monadTables,
  ...monadAutonomyTables,
  ...monadPerpTables,
  ...monadVenueTables,
  ...monadManualTables,
  devCreditControls: defineTable({
    key: v.string(), chargingEnabled: v.boolean(), version: v.number(),
    updatedAt: v.number(), updatedBy: v.string(),
  }).index("by_key", ["key"]),
  users: defineTable({
    authSubject: v.optional(v.string()),
    authProvider: v.optional(v.string()),
    walletAddress: v.optional(v.string()),
    particleWalletAddress: v.optional(v.string()),
    particleUuid: v.optional(v.string()),
    clerkUserId: v.optional(v.string()),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    dashboardLayout: v.optional(v.union(v.literal("workspaces"), v.literal("workbench"))),
    dashboardTheme: v.optional(v.union(v.literal("bold"), v.literal("studio"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_authSubject", ["authSubject"])
    .index("by_email", ["email"])
    .index("by_walletAddress", ["walletAddress"])
    .index("by_clerkUserId", ["clerkUserId"]),

  strategyAccounts: defineTable({
    userId: v.id("users"),
    accountWalletId: v.optional(v.id("accountWallets")),
    strategyType: v.string(),
    label: v.string(),
    status: v.union(
      v.literal("provisioning"),
      v.literal("ready"),
      v.literal("active"),
      v.literal("paused"),
      v.literal("emergency_stopped"),
    ),
    emergencyStop: v.boolean(),
    controlRevision: v.optional(v.number()),
    enabledAt: v.optional(v.number()),
    pausedAt: v.optional(v.number()),
    lastHeartbeatAt: v.optional(v.number()),
    healthStatus: v.optional(
      v.union(
        v.literal("bootstrapping"),
        v.literal("ready"),
        v.literal("degraded"),
        v.literal("paused"),
        v.literal("unwinding"),
        v.literal("withdrawal_blocked"),
      ),
    ),
    healthReason: v.optional(v.string()),
    healthUpdatedAt: v.optional(v.number()),
    lastReconciledAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_status", ["status"]),

  venueAccounts: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    role: managedVenueRole,
    venue: managedTradingVenue,
    chainRef: v.string(),
    accountRef: v.string(),
    walletAddress: v.string(),
    ownerAddress: v.optional(v.string()),
    accountId: v.optional(v.string()),
    delegatePublicKey: v.optional(v.string()),
    collateralJson: v.optional(v.string()),
    readinessJson: v.optional(v.string()),
    legacy: v.optional(v.boolean()),
    status: v.union(
      v.literal("provisioning"),
      v.literal("ready"),
      v.literal("approval_required"),
      v.literal("paused"),
    ),
    lastSyncedAt: v.optional(v.number()),
    lastSyncStatus: v.optional(
      v.union(v.literal("never"), v.literal("fresh"), v.literal("stale"), v.literal("error")),
    ),
    lastSyncError: v.optional(v.string()),
    balanceJson: v.optional(v.string()),
    lastBalanceUsd: v.optional(v.number()),
    metadataJson: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_role", ["strategyAccountId", "role"])
    .index("by_accountRef", ["accountRef"]),

  venueIntegrations: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venue: managedTradingVenue,
    enabled: v.boolean(),
    routingEnabled: v.optional(v.boolean()),
    authorityMode: v.optional(
      v.union(v.literal("shadow"), v.literal("approval"), v.literal("autopilot")),
    ),
    status: v.union(
      v.literal("disabled"),
      v.literal("authorization_required"),
      v.literal("ready"),
      v.literal("degraded"),
    ),
    lastHealthAt: v.optional(v.number()),
    lastHealthMessage: v.optional(v.string()),
    activeSetupAttemptId: v.optional(v.id("venueSetupAttempts")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_venue", ["strategyAccountId", "venue"]),

  walletSecrets: defineTable({
    venueAccountId: v.id("venueAccounts"),
    address: v.string(),
    cipherText: v.string(),
    iv: v.string(),
    authTag: v.string(),
    algorithm: v.literal("aes-256-gcm"),
    keyVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_venueAccountId", ["venueAccountId"]),

  venueCredentials: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venue: managedTradingVenue,
    venueAccountId: v.optional(v.id("venueAccounts")),
    publicKey: v.string(),
    encryptedEnvelope: v.string(),
    kmsKeyRef: v.string(),
    keyVersion: v.number(),
    status: v.union(v.literal("active"), v.literal("authorization_required"), v.literal("revoked"), v.literal("rotating")),
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId_venue", ["strategyAccountId", "venue"])
    .index("by_publicKey", ["publicKey"]),

  venuePermissions: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venue: managedTradingVenue,
    ownerAddress: v.string(),
    delegatePublicKey: v.optional(v.string()),
    authorityMode: v.union(v.literal("shadow"), v.literal("approval"), v.literal("autopilot")),
    chainId: v.number(),
    limitsJson: v.string(),
    status: v.union(v.literal("pending"), v.literal("active"), v.literal("revoked"), v.literal("expired")),
    expiresAt: v.optional(v.number()),
    transactionId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_strategyAccountId_venue", ["strategyAccountId", "venue"]),

  venueSetupAttempts: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    accountWalletId: v.id("accountWallets"),
    venue: managedTradingVenue,
    authorityMode: v.union(v.literal("shadow"), v.literal("approval"), v.literal("autopilot")),
    fundingAmount: v.string(),
    state: v.union(
      v.literal("created"),
      v.literal("awaiting_delegation"),
      v.literal("awaiting_funding"),
      v.literal("awaiting_signature"),
      v.literal("verifying"),
      v.literal("ready"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    step: v.string(),
    transactionId: v.optional(v.string()),
    signatureHash: v.optional(v.string()),
    error: v.optional(v.string()),
    workflowId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_venue", ["strategyAccountId", "venue"])
    .index("by_workflowId", ["workflowId"]),

  optimismMigrations: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    accountWalletId: v.id("accountWallets"),
    legacyVenueAccountId: v.id("venueAccounts"),
    balancesJson: v.string(),
    allowancesJson: v.string(),
    pendingTransactionsJson: v.string(),
    retainedGasWei: v.string(),
    status: v.union(v.literal("review"), v.literal("submitted"), v.literal("reconciling"), v.literal("complete"), v.literal("failed")),
    transactionId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_strategyAccountId", ["strategyAccountId"]),

  strategyConfigs: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    version: v.number(),
    active: v.boolean(),
    allowedPairs: v.array(v.string()),
    arbThresholdBps: v.number(),
    hedgeThresholdUsd: v.number(),
    minArbTradeUsd: v.number(),
    maxArbTradeUsd: v.number(),
    pollIntervalSeconds: v.number(),
    maxDailyDrawdownPct: v.number(),
    maxSlippageBps: v.number(),
    executionMode: v.optional(v.union(v.literal("live"), v.literal("shadow"))),
    maxSingleActionUsd: v.optional(v.number()),
    maxDailyVolumeUsd: v.optional(v.number()),
    rebalanceCooldownSeconds: v.optional(v.number()),
    hedgeTwapThresholdUsd: v.optional(v.number()),
    minLiquidityUsd: v.optional(v.number()),
    maxMarketDataAgeMs: v.optional(v.number()),
    maxPositionDriftUsd: v.optional(v.number()),
    withdrawCooldownSeconds: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_active", ["strategyAccountId", "active"]),

  deposits: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.id("venueAccounts"),
    venueRole: managedVenueRole,
    asset: v.string(),
    chainRef: v.string(),
    amount: v.optional(v.string()),
    detectedAmount: v.optional(v.string()),
    observedBalance: v.optional(v.string()),
    txHash: v.optional(v.string()),
    transferRef: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    status: v.union(
      v.literal("awaiting_funds"),
      v.literal("detected"),
      v.literal("confirmed"),
      v.literal("credited"),
    ),
    notes: v.optional(v.string()),
    lastObservedAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    creditedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_venueAccountId", ["venueAccountId"])
    .index("by_status", ["status"]),

  accountWallets: defineTable({
    userId: v.id("users"),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    ownerAddress: v.string(),
    evmUaAddress: v.string(),
    evmDepositAddress: v.optional(v.string()),
    solanaUaAddress: v.optional(v.string()),
    walletProvider: v.optional(v.union(v.literal("particle"), v.literal("magic"), v.literal("wallet"))),
    accountMode: v.optional(v.union(v.literal("smart_account"), v.literal("eip7702"))),
    eip7702Delegated: v.optional(v.boolean()),
    arbitrumDelegationStatus: v.optional(
      v.union(v.literal("not_supported"), v.literal("required"), v.literal("pending"), v.literal("active"), v.literal("expired")),
    ),
    accountImplementation: v.optional(v.string()),
    capabilitiesJson: v.optional(v.string()),
    ownerVerifiedAt: v.optional(v.number()),
    delegatedChainIdsJson: v.optional(v.string()),
    unifiedBalanceUsd: v.number(),
    assetsJson: v.string(),
    arbitrumUsdcBalanceRaw: v.optional(v.string()),
    arbitrumUsdcBalance: v.optional(v.string()),
    arbitrumEthBalanceRaw: v.optional(v.string()),
    arbitrumEthBalance: v.optional(v.string()),
    arbitrumBalanceBlock: v.optional(v.number()),
    arbitrumBalanceObservedAt: v.optional(v.number()),
    arbitrumTokenRegistryVersion: v.optional(v.string()),
    lastRefreshedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_ownerAddress", ["ownerAddress"]),

  tradeSettings: defineTable({
    userId: v.id("users"),
    defaultMarketId: v.string(),
    defaultLeverage: v.number(),
    defaultMarginUsd: v.number(),
    slippageCapBps: v.number(),
    expectedHoldHours: v.optional(v.number()),
    requireConfirmation: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  tradeIntents: defineTable({
    userId: v.id("users"),
    accountWalletId: v.optional(v.id("accountWallets")),
    marketId: v.string(),
    coin: v.optional(v.string()),
    assetIndex: v.optional(v.number()),
    side: v.union(v.literal("long"), v.literal("short")),
    status: v.union(
      v.literal("queued"),
      v.literal("quoted"),
      v.literal("funding_submitted"),
      v.literal("funding_confirmed"),
      v.literal("order_submitting"),
      v.literal("open"),
      v.literal("close_submitting"),
      v.literal("closed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    marginUsd: v.number(),
    leverage: v.number(),
    notionalUsd: v.number(),
    slippageCapBps: v.number(),
    expectedHoldHours: v.optional(v.number()),
    selectedVenue: v.optional(
      v.union(
        v.literal("hyperliquid"),
        v.literal("lighter"),
        v.literal("orderly"),
        v.literal("gmx"),
        v.literal("ostium"),
      ),
    ),
    benchmarkVenue: v.optional(
      v.union(
        v.literal("hyperliquid"),
        v.literal("lighter"),
        v.literal("orderly"),
        v.literal("gmx"),
        v.literal("ostium"),
      ),
    ),
    marketMetadataJson: v.optional(v.string()),
    quoteJson: v.string(),
    quoteCreatedAt: v.number(),
    queuedAt: v.number(),
    fundingAmountUsd: v.optional(v.number()),
    fundingTransactionId: v.optional(v.string()),
    fundingJson: v.optional(v.string()),
    executionJson: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_userId_status", ["userId", "status"]),

  paymentLinks: defineTable({
    userId: v.id("users"),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    slug: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    depositPolicy: v.optional(
      v.union(
        v.literal("ua_settlement_only"),
        v.literal("ua_settlement_plus_eoa_direct"),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    disabledAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_slug", ["slug"])
    .index("by_userId_status", ["userId", "status"])
    .index("by_strategyAccountId_status", ["strategyAccountId", "status"]),

  paymentIntents: defineTable({
    paymentLinkId: v.id("paymentLinks"),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    paymentFlow: v.optional(v.union(v.literal("eoa_direct"), v.literal("payer_ua"))),
    payerAddress: v.string(),
    targetChainId: v.number(),
    targetTokenAddress: v.string(),
    targetTokenSymbol: v.string(),
    sourceChainId: v.optional(v.number()),
    sourceTokenAddress: v.optional(v.string()),
    sourceTokenSymbol: v.optional(v.string()),
    sourceTokenDecimals: v.optional(v.number()),
    sourceAmount: v.optional(v.string()),
    receiver: v.string(),
    receiverKind: v.union(v.literal("evm"), v.literal("solana")),
    settlementChainId: v.optional(v.number()),
    settlementTokenAddress: v.optional(v.string()),
    settlementTokenSymbol: v.optional(v.string()),
    settlementAmount: v.optional(v.string()),
    amount: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("previewed"),
      v.literal("submitted"),
      v.literal("failed"),
    ),
    particleTransactionId: v.optional(v.string()),
    txHash: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    detailsJson: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    previewedAt: v.optional(v.number()),
    submittedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
  })
    .index("by_paymentLinkId", ["paymentLinkId"])
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_status", ["status"]),

  walletAssetStates: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.id("venueAccounts"),
    venueRole: managedVenueRole,
    chainRef: v.string(),
    asset: v.string(),
    purpose: v.union(
      v.literal("capital"),
      v.literal("inventory"),
      v.literal("gas"),
      v.literal("unsupported"),
    ),
    includedInStrategyEquity: v.boolean(),
    balance: v.string(),
    valueUsd: v.number(),
    lastObservedAt: v.number(),
    lastTransferAt: v.optional(v.number()),
    lastTransferRef: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_venueAccountId", ["venueAccountId"])
    .index("by_venueAccountId_asset", ["venueAccountId", "asset"]),

  walletTransferEvents: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.id("venueAccounts"),
    venueRole: managedVenueRole,
    chainRef: v.string(),
    asset: v.string(),
    purpose: v.union(
      v.literal("capital"),
      v.literal("inventory"),
      v.literal("gas"),
      v.literal("unsupported"),
    ),
    includedInStrategyEquity: v.boolean(),
    direction: v.union(v.literal("in"), v.literal("out")),
    amount: v.string(),
    balanceAfter: v.string(),
    valueUsd: v.number(),
    transferRef: v.string(),
    txHash: v.optional(v.string()),
    observedAt: v.number(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_strategyAccountId_observedAt", ["strategyAccountId", "observedAt"])
    .index("by_venueAccountId_observedAt", ["venueAccountId", "observedAt"])
    .index("by_venueAccountId_transferRef", ["venueAccountId", "transferRef"]),

  withdrawals: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.optional(v.id("venueAccounts")),
    asset: v.string(),
    amount: v.string(),
    destination: v.string(),
    status: v.union(
      v.literal("draft"),
      v.literal("pending_checks"),
      v.literal("signing"),
      v.literal("submitted"),
      v.literal("confirming"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("requested"),
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("rejected"),
    ),
    txHash: v.optional(v.string()),
    note: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    feeEstimateUsd: v.optional(v.number()),
    destinationVerified: v.optional(v.boolean()),
    reviewStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("not_required"),
      ),
    ),
    cooldownEndsAt: v.optional(v.number()),
    failureCode: v.optional(v.string()),
    requestedBy: v.optional(v.id("users")),
    lastStageAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    requestedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_status", ["status"]),

  executionLeases: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    holderId: v.string(),
    status: v.union(v.literal("active"), v.literal("released"), v.literal("expired")),
    acquiredAt: v.number(),
    heartbeatAt: v.number(),
    expiresAt: v.number(),
    releasedAt: v.optional(v.number()),
  }).index("by_strategyAccountId", ["strategyAccountId"]),

  lpPositions: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.id("venueAccounts"),
    poolAddress: v.string(),
    chainRef: v.string(),
    token0: v.string(),
    token1: v.string(),
    liquidity: v.string(),
    lowerTick: v.number(),
    upperTick: v.number(),
    amount0: v.optional(v.string()),
    amount1: v.optional(v.string()),
    feesEarnedUsd: v.optional(v.number()),
    currentTick: v.optional(v.number()),
    rangeStatus: v.optional(v.union(v.literal("in_range"), v.literal("near_edge"), v.literal("out_of_range"))),
    inventoryDeltaUsd: v.optional(v.number()),
    outOfRangeSince: v.optional(v.number()),
    lastSyncedAt: v.optional(v.number()),
    status: v.union(v.literal("open"), v.literal("closing"), v.literal("closed")),
    openedAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
  }).index("by_strategyAccountId", ["strategyAccountId"]),

  hedgePositions: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.id("venueAccounts"),
    symbol: v.string(),
    side: v.union(v.literal("long"), v.literal("short"), v.literal("flat")),
    size: v.string(),
    entryPrice: v.number(),
    markPrice: v.optional(v.number()),
    unrealizedPnlUsd: v.optional(v.number()),
    basisBps: v.optional(v.number()),
    fundingRate: v.optional(v.number()),
    lastSyncedAt: v.optional(v.number()),
    orderRef: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("closing"), v.literal("closed")),
    openedAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
  }).index("by_strategyAccountId", ["strategyAccountId"]),

  balanceSnapshots: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    totalEquityUsd: v.number(),
    lpValueUsd: v.number(),
    hedgeValueUsd: v.number(),
    cashValueUsd: v.number(),
    netExposureUsd: v.number(),
    accountBalances: v.array(
      v.object({
        venueRole: v.string(),
        asset: v.string(),
        amount: v.string(),
        valueUsd: v.number(),
        purpose: v.optional(
          v.union(
            v.literal("capital"),
            v.literal("inventory"),
            v.literal("gas"),
            v.literal("unsupported"),
          ),
        ),
        includedInStrategyEquity: v.optional(v.boolean()),
      }),
    ),
    capturedBy: v.optional(v.string()),
    freshnessMs: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("live"), v.literal("shadow"), v.literal("degraded"))),
    capturedAt: v.number(),
  }).index("by_strategyAccountId", ["strategyAccountId"]),

  executions: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.optional(v.id("venueAccounts")),
    kind: v.union(
      v.literal("uniswap_pool_swap"),
      v.literal("uniswap_rebalance"),
      v.literal("hyperliquid_approve_agent"),
      v.literal("hyperliquid_order"),
      v.literal("withdrawal"),
      v.literal("system"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("submitted"),
      v.literal("filled"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    summary: v.string(),
    detail: v.optional(v.string()),
    txHash: v.optional(v.string()),
    requestId: v.optional(v.string()),
    notionalUsd: v.optional(v.number()),
    metadataJson: v.optional(v.string()),
    origin: v.optional(v.union(v.literal("viewer"), v.literal("supervisor"), v.literal("system"))),
    pipelineStage: v.optional(
      v.union(
        v.literal("intent"),
        v.literal("prechecks"),
        v.literal("simulation"),
        v.literal("signing"),
        v.literal("broadcast"),
        v.literal("confirmation"),
        v.literal("reconciliation"),
      ),
    ),
    policyJson: v.optional(v.string()),
    simulationJson: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
    intentHash: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    executedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_strategyAccountId_requestId", ["strategyAccountId", "requestId"])
    .index("by_status", ["status"]),

  alerts: defineTable({
    poolId: v.optional(v.string()),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    code: v.optional(v.string()),
    message: v.string(),
    detail: v.optional(v.string()),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("info"),
      v.literal("warning"),
      v.literal("critical"),
    ),
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"))),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
  }),

  strategyAlerts: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    code: v.string(),
    message: v.string(),
    detail: v.optional(v.string()),
    runbook: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("resolved")),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_status", ["status"]),

  auditEvents: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    userId: v.optional(v.id("users")),
    actor: v.string(),
    kind: v.string(),
    summary: v.string(),
    detail: v.optional(v.string()),
    refTable: v.optional(v.string()),
    refId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_kind", ["kind"]),

  venueStates: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.id("venueAccounts"),
    venueRole: v.string(),
    venue: v.string(),
    syncKind: v.union(
      v.literal("balance"),
      v.literal("deposit"),
      v.literal("withdrawal"),
      v.literal("lp_position"),
      v.literal("hedge_state"),
      v.literal("market"),
    ),
    status: v.union(v.literal("fresh"), v.literal("stale"), v.literal("error")),
    summary: v.string(),
    dataJson: v.optional(v.string()),
    error: v.optional(v.string()),
    syncedAt: v.number(),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_venueAccountId", ["venueAccountId"]),

  reconciliationDeltas: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.optional(v.id("venueAccounts")),
    kind: v.union(
      v.literal("balance"),
      v.literal("deposit"),
      v.literal("withdrawal"),
      v.literal("lp_position"),
      v.literal("hedge_position"),
    ),
    status: v.union(
      v.literal("matched"),
      v.literal("pending"),
      v.literal("drift"),
      v.literal("resolved"),
    ),
    asset: v.optional(v.string()),
    expectedAmount: v.optional(v.string()),
    observedAmount: v.optional(v.string()),
    deltaAmount: v.optional(v.string()),
    summary: v.string(),
    detail: v.optional(v.string()),
    refTable: v.optional(v.string()),
    refId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_status", ["status"]),

  incidentEvents: defineTable({
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    code: v.string(),
    summary: v.string(),
    detail: v.optional(v.string()),
    runbook: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("acknowledged"), v.literal("resolved")),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_strategyAccountId", ["strategyAccountId"])
    .index("by_status", ["status"]),

  canaryChecks: defineTable({
    scope: v.string(),
    venue: v.string(),
    checkType: v.string(),
    status: v.union(v.literal("pass"), v.literal("warn"), v.literal("fail")),
    summary: v.string(),
    detail: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_scope", ["scope"]),

  mobileSessions: defineTable({
    userId: v.id("users"),
    deviceId: v.string(),
    deviceName: v.string(),
    refreshJtiHash: v.string(),
    lastAuthChallengeHash: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("revoked")),
    expiresAt: v.number(),
    lastRefreshedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_deviceId", ["userId", "deviceId"])
    .index("by_userId_status", ["userId", "status"]),

  mobileAuthChallenges: defineTable({
    challengeHash: v.string(),
    userId: v.id("users"),
    deviceId: v.string(),
    expiresAt: v.number(),
    consumedAt: v.number(),
    createdAt: v.number(),
  }).index("by_challengeHash", ["challengeHash"])
    .index("by_userId", ["userId"])
    .index("by_expiresAt", ["expiresAt"]),

  mobileSigningProofs: defineTable({
    userId: v.id("users"),
    proofId: v.string(),
    ownerAddress: v.string(),
    chainId: v.number(),
    typedDataJson: v.string(),
    rootHash: v.string(),
    status: v.union(v.literal("prepared"), v.literal("verifying"), v.literal("verified"), v.literal("expired")),
    expiresAt: v.number(),
    claimedAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_proofId", ["userId", "proofId"])
    .index("by_userId_status", ["userId", "status"]),

  mobileUaOperations: defineTable({
    userId: v.id("users"),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    operationId: v.string(),
    idempotencyKey: v.string(),
    ownerAddress: v.string(),
    chainId: v.number(),
    normalizedIntentHash: v.string(),
    preparedJson: v.string(),
    signaturesJson: v.optional(v.string()),
    status: v.union(
      v.literal("prepared"),
      v.literal("submitted"),
      v.literal("broadcast"),
      v.literal("reconciling"),
      v.literal("complete"),
      v.literal("failed"),
      v.literal("expired"),
      v.literal("invalidated"),
    ),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_operationId", ["userId", "operationId"])
    .index("by_userId_idempotencyKey", ["userId", "idempotencyKey"])
    .index("by_strategyAccountId_status", ["strategyAccountId", "status"]),

  mobileWalletWithdrawals: defineTable({
    userId: v.id("users"),
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    operationId: v.string(),
    idempotencyKey: v.string(),
    ownerAddress: v.string(),
    destination: v.string(),
    destinationKind: v.union(v.literal("wallet"), v.literal("contract")),
    chainId: v.literal(42161),
    tokenAddress: v.string(),
    amount: v.string(),
    amountRaw: v.string(),
    remainingAmount: v.string(),
    transactionJson: v.string(),
    preparedHash: v.string(),
    expectedNonce: v.number(),
    observedBlock: v.number(),
    estimatedFeeWei: v.string(),
    status: v.union(
      v.literal("prepared"),
      v.literal("submitted"),
      v.literal("confirming"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("uncertain"),
      v.literal("expired"),
      v.literal("needs_attention"),
    ),
    txHash: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    failureMessage: v.optional(v.string()),
    expiresAt: v.number(),
    broadcastReportedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_operationId", ["userId", "operationId"])
    .index("by_userId_idempotencyKey", ["userId", "idempotencyKey"])
    .index("by_txHash", ["txHash"])
    .index("by_status", ["status"]),

  ...agentTables,
  ...dependencySafetyTables,
  ...evidenceLifecycleTables,
  ...mobileConnectorTables,
  ...mobileNotificationTables,
});
