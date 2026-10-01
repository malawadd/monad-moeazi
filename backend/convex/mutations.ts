import { internalMutation, mutation } from "./_generated/server";
import { v } from "convex/values";
import { nextAccountControlRevision } from "../lib/accountControlAuthority";
import {
  DEFAULT_STRATEGY_CONFIG,
  STRATEGY_HEALTH_STATUS,
  STRATEGY_SLUG,
  VENUE_SYNC_STATUS,
  WITHDRAWAL_REVIEW_STATUS,
  WITHDRAWAL_STATUS,
} from "./constants";
import {
  buildWithdrawalChecks,
  canTransitionWithdrawal,
  createWithdrawalIdempotencyKey,
} from "./helpers/withdrawals";
import {
  computeWithdrawableBalance,
  estimateObservedTransferUsd,
  getSupportedWalletAssets,
  getWalletAssetProfile,
} from "./helpers/walletAssets";
import {
  getActiveStrategyConfig,
  getWalletAssetStateByVenueAccountIdAsset,
  getWalletAssetStatesByVenueAccountId,
  requireViewerStrategy,
} from "./model";

async function requireIdentity(ctx: { auth: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  return identity;
}

async function requireViewerAccount(ctx: { auth: any; db: any }) {
  const identity = await requireIdentity(ctx);
  const { user, strategyAccount } = await requireViewerStrategy(ctx, identity.subject);
  if (!user || !strategyAccount) {
    throw new Error("Strategy account not provisioned");
  }
  return { identity, user, strategyAccount };
}

function serializeJson(value: unknown) {
  return JSON.stringify(value);
}

function normalizeAmountString(value: string | number | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "0";
  }
  return numeric.toString();
}

export const setStrategyConfig = mutation({
  args: {
    allowedPairs: v.optional(v.array(v.string())),
    arbThresholdBps: v.optional(v.number()),
    hedgeThresholdUsd: v.optional(v.number()),
    minArbTradeUsd: v.optional(v.number()),
    maxArbTradeUsd: v.optional(v.number()),
    pollIntervalSeconds: v.optional(v.number()),
    maxDailyDrawdownPct: v.optional(v.number()),
    maxSlippageBps: v.optional(v.number()),
    executionMode: v.optional(v.union(v.literal("live"), v.literal("shadow"))),
    maxSingleActionUsd: v.optional(v.number()),
    maxDailyVolumeUsd: v.optional(v.number()),
    rebalanceCooldownSeconds: v.optional(v.number()),
    hedgeTwapThresholdUsd: v.optional(v.number()),
    minLiquidityUsd: v.optional(v.number()),
    maxMarketDataAgeMs: v.optional(v.number()),
    maxPositionDriftUsd: v.optional(v.number()),
    withdrawCooldownSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user, strategyAccount } = await requireViewerAccount(ctx);
    const now = Date.now();
    const current = await getActiveStrategyConfig(ctx, strategyAccount._id);

    const nextConfig = {
      ...DEFAULT_STRATEGY_CONFIG,
      ...(current
        ? {
            allowedPairs: current.allowedPairs,
            arbThresholdBps: current.arbThresholdBps,
            hedgeThresholdUsd: current.hedgeThresholdUsd,
            minArbTradeUsd: current.minArbTradeUsd,
            maxArbTradeUsd: current.maxArbTradeUsd,
            pollIntervalSeconds: current.pollIntervalSeconds,
            maxDailyDrawdownPct: current.maxDailyDrawdownPct,
            maxSlippageBps: current.maxSlippageBps,
            executionMode: current.executionMode,
            maxSingleActionUsd: current.maxSingleActionUsd,
            maxDailyVolumeUsd: current.maxDailyVolumeUsd,
            rebalanceCooldownSeconds: current.rebalanceCooldownSeconds,
            hedgeTwapThresholdUsd: current.hedgeTwapThresholdUsd,
            minLiquidityUsd: current.minLiquidityUsd,
            maxMarketDataAgeMs: current.maxMarketDataAgeMs,
            maxPositionDriftUsd: current.maxPositionDriftUsd,
            withdrawCooldownSeconds: current.withdrawCooldownSeconds,
          }
        : {}),
      ...(args.allowedPairs ? { allowedPairs: args.allowedPairs } : {}),
      ...(args.arbThresholdBps !== undefined ? { arbThresholdBps: args.arbThresholdBps } : {}),
      ...(args.hedgeThresholdUsd !== undefined ? { hedgeThresholdUsd: args.hedgeThresholdUsd } : {}),
      ...(args.minArbTradeUsd !== undefined ? { minArbTradeUsd: args.minArbTradeUsd } : {}),
      ...(args.maxArbTradeUsd !== undefined ? { maxArbTradeUsd: args.maxArbTradeUsd } : {}),
      ...(args.pollIntervalSeconds !== undefined ? { pollIntervalSeconds: args.pollIntervalSeconds } : {}),
      ...(args.maxDailyDrawdownPct !== undefined
        ? { maxDailyDrawdownPct: args.maxDailyDrawdownPct }
        : {}),
      ...(args.maxSlippageBps !== undefined ? { maxSlippageBps: args.maxSlippageBps } : {}),
      ...(args.executionMode !== undefined ? { executionMode: args.executionMode } : {}),
      ...(args.maxSingleActionUsd !== undefined ? { maxSingleActionUsd: args.maxSingleActionUsd } : {}),
      ...(args.maxDailyVolumeUsd !== undefined ? { maxDailyVolumeUsd: args.maxDailyVolumeUsd } : {}),
      ...(args.rebalanceCooldownSeconds !== undefined
        ? { rebalanceCooldownSeconds: args.rebalanceCooldownSeconds }
        : {}),
      ...(args.hedgeTwapThresholdUsd !== undefined
        ? { hedgeTwapThresholdUsd: args.hedgeTwapThresholdUsd }
        : {}),
      ...(args.minLiquidityUsd !== undefined ? { minLiquidityUsd: args.minLiquidityUsd } : {}),
      ...(args.maxMarketDataAgeMs !== undefined ? { maxMarketDataAgeMs: args.maxMarketDataAgeMs } : {}),
      ...(args.maxPositionDriftUsd !== undefined ? { maxPositionDriftUsd: args.maxPositionDriftUsd } : {}),
      ...(args.withdrawCooldownSeconds !== undefined
        ? { withdrawCooldownSeconds: args.withdrawCooldownSeconds }
        : {}),
    };

    const existingConfigs = await ctx.db
      .query("strategyConfigs")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategyAccount._id))
      .collect();

    for (const config of existingConfigs) {
      if (config.active) {
        await ctx.db.patch(config._id, { active: false, updatedAt: now });
      }
    }

    const version = existingConfigs.reduce((max, item) => Math.max(max, item.version), 0) + 1;
    const configId = await ctx.db.insert("strategyConfigs", {
      strategyAccountId: strategyAccount._id,
      version,
      active: true,
      ...nextConfig,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      strategyAccountId: strategyAccount._id,
      userId: user._id,
      actor: "viewer",
      kind: "strategy_config.updated",
      summary: `Strategy configuration v${version} saved`,
      detail: serializeJson({
        arbThresholdBps: nextConfig.arbThresholdBps,
        hedgeThresholdUsd: nextConfig.hedgeThresholdUsd,
        executionMode: nextConfig.executionMode,
        maxSingleActionUsd: nextConfig.maxSingleActionUsd,
        maxDailyVolumeUsd: nextConfig.maxDailyVolumeUsd,
      }),
      refTable: "strategyConfigs",
      refId: configId,
      createdAt: now,
    });

    return { configId, version };
  },
});

export const enableStrategy = mutation({
  args: {},
  handler: async (ctx) => {
    const { user, strategyAccount } = await requireViewerAccount(ctx);
    const now = Date.now();

    await ctx.db.patch(strategyAccount._id, {
      status: "active",
      emergencyStop: false,
      controlRevision: nextAccountControlRevision(strategyAccount, { status: "active", emergencyStop: false }),
      enabledAt: now,
      pausedAt: undefined,
      healthStatus: STRATEGY_HEALTH_STATUS.ready,
      healthReason: "Worker heartbeat and venue sync determine whether the strategy remains fully healthy.",
      healthUpdatedAt: now,
      lastError: undefined,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      strategyAccountId: strategyAccount._id,
      userId: user._id,
      actor: "viewer",
      kind: "strategy.enabled",
      summary: "Managed strategy enabled",
      detail: STRATEGY_SLUG,
      createdAt: now,
    });

    return { strategyAccountId: strategyAccount._id, status: "active" as const };
  },
});

export const pauseStrategy = mutation({
  args: {
    reason: v.optional(v.string()),
    emergencyStop: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { user, strategyAccount } = await requireViewerAccount(ctx);
    const now = Date.now();
    const emergencyStop = args.emergencyStop ?? false;
    const status = emergencyStop ? "emergency_stopped" : "paused";

    await ctx.db.patch(strategyAccount._id, {
      status,
      emergencyStop,
      controlRevision: nextAccountControlRevision(strategyAccount, { status, emergencyStop }),
      pausedAt: now,
      healthStatus: emergencyStop ? STRATEGY_HEALTH_STATUS.paused : STRATEGY_HEALTH_STATUS.degraded,
      healthReason: args.reason ?? (emergencyStop ? "Emergency stop active." : "Strategy paused."),
      healthUpdatedAt: now,
      lastError: args.reason,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      strategyAccountId: strategyAccount._id,
      userId: user._id,
      actor: "viewer",
      kind: emergencyStop ? "strategy.emergency_stop" : "strategy.paused",
      summary: emergencyStop ? "Emergency stop engaged" : "Strategy paused",
      detail: args.reason,
      createdAt: now,
    });

    if (emergencyStop) {
      await ctx.db.insert("strategyAlerts", {
        strategyAccountId: strategyAccount._id,
        severity: "critical",
        code: "EMERGENCY_STOP",
        message: "Emergency stop engaged by operator.",
        detail: args.reason,
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
    }

    return { strategyAccountId: strategyAccount._id, status };
  },
});

export const requestWithdrawal = mutation({
  args: {
    venueAccountId: v.optional(v.id("venueAccounts")),
    asset: v.string(),
    amount: v.string(),
    destination: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, strategyAccount } = await requireViewerAccount(ctx);
    const now = Date.now();
    const config = await getActiveStrategyConfig(ctx, strategyAccount._id);
    const venueAccount = args.venueAccountId ? await ctx.db.get(args.venueAccountId) : null;
    if (args.venueAccountId && (!venueAccount || venueAccount.strategyAccountId !== strategyAccount._id)) {
      throw new Error("Funding venue not found for this strategy account.");
    }
    const assetState =
      args.venueAccountId && venueAccount
        ? await getWalletAssetStateByVenueAccountIdAsset(ctx, args.venueAccountId, args.asset)
        : null;
    let observedBalance = assetState?.balance;
    if (!observedBalance && venueAccount?.balanceJson) {
      try {
        const parsed = JSON.parse(venueAccount.balanceJson);
        const matchingBalance = Array.isArray(parsed?.balances)
          ? parsed.balances.find(
              (balance: any) => String(balance.asset ?? "").toUpperCase() === args.asset.toUpperCase(),
            )
          : null;
        observedBalance = matchingBalance?.amount ? String(matchingBalance.amount) : observedBalance;
      } catch {
        observedBalance = assetState?.balance;
      }
    }
    const withdrawableBalance =
      args.venueAccountId && venueAccount
        ? computeWithdrawableBalance({
            role: venueAccount.role,
            asset: args.asset,
            balance: observedBalance,
          })
        : null;
    const latestWithdrawal = await ctx.db
      .query("withdrawals")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategyAccount._id))
      .order("desc")
      .first();
    const cooldownEndsAt =
      latestWithdrawal?.lastStageAt && config?.withdrawCooldownSeconds
        ? latestWithdrawal.lastStageAt + config.withdrawCooldownSeconds * 1000
        : null;
    const checks = buildWithdrawalChecks({
      amount: args.amount,
      destination: args.destination,
      venue: venueAccount?.venue ?? "hyperliquid",
      asset: args.asset,
      availableBalance: withdrawableBalance?.amount,
      sourceAddress: venueAccount?.walletAddress,
      cooldownEndsAt,
      now,
    });
    const idempotencyKey = createWithdrawalIdempotencyKey({
      strategyAccountId: strategyAccount._id,
      venueAccountId: args.venueAccountId ?? null,
      asset: args.asset,
      amount: checks.normalizedAmount,
      destination: checks.normalizedDestination,
    });

    const existing = await ctx.db
      .query("withdrawals")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategyAccount._id))
      .collect();
    const duplicate = existing.find(
      (item) =>
        item.idempotencyKey === idempotencyKey &&
        ![WITHDRAWAL_STATUS.completed, WITHDRAWAL_STATUS.failed, WITHDRAWAL_STATUS.cancelled].includes(item.status as any),
    );
    if (duplicate) {
      return { withdrawalId: duplicate._id, duplicated: true };
    }

    const withdrawalId = await ctx.db.insert("withdrawals", {
      strategyAccountId: strategyAccount._id,
      venueAccountId: args.venueAccountId,
      asset: args.asset.toUpperCase(),
      amount: checks.normalizedAmount,
      destination: checks.normalizedDestination,
      status: WITHDRAWAL_STATUS.draft,
      txHash: undefined,
      note: args.note,
      idempotencyKey,
      feeEstimateUsd: checks.feeEstimateUsd,
      destinationVerified: checks.destinationVerified,
      reviewStatus: checks.reviewStatus,
      cooldownEndsAt: cooldownEndsAt ?? undefined,
      failureCode: checks.passed ? undefined : "WITHDRAWAL_CHECKS_PENDING",
      requestedBy: user._id,
      lastStageAt: now,
      completedAt: undefined,
      requestedAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(withdrawalId, {
      status: WITHDRAWAL_STATUS.pendingChecks,
      lastStageAt: now,
      updatedAt: now,
    });

    if (checks.passed) {
      await ctx.db.patch(withdrawalId, {
        status: WITHDRAWAL_STATUS.queued,
        reviewStatus: WITHDRAWAL_REVIEW_STATUS.notRequired,
        failureCode: undefined,
        lastStageAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(strategyAccount._id, {
        healthStatus: STRATEGY_HEALTH_STATUS.withdrawalBlocked,
        healthReason: checks.reasons.join(" "),
        healthUpdatedAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("auditEvents", {
      strategyAccountId: strategyAccount._id,
      userId: user._id,
      actor: "viewer",
      kind: "withdrawal.requested",
      summary: `Withdrawal requested for ${checks.normalizedAmount} ${args.asset.toUpperCase()}`,
      detail: serializeJson({
        destination: checks.normalizedDestination,
        feeEstimateUsd: checks.feeEstimateUsd,
        checks: checks.reasons,
        withdrawableBalance: withdrawableBalance?.amount ?? null,
        status: checks.passed ? WITHDRAWAL_STATUS.queued : WITHDRAWAL_STATUS.pendingChecks,
      }),
      refTable: "withdrawals",
      refId: withdrawalId,
      createdAt: now,
    });

    if (!checks.passed) {
      await ctx.db.insert("incidentEvents", {
        strategyAccountId: strategyAccount._id,
        severity: "warning",
        code: "WITHDRAWAL_REQUIRES_REVIEW",
        summary: "Withdrawal is waiting on preflight checks.",
        detail: checks.reasons.join(" "),
        runbook: "Review destination, cooldown, and venue funding state before retrying.",
        status: "open",
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      withdrawalId,
      duplicated: false,
      status: checks.passed ? WITHDRAWAL_STATUS.queued : WITHDRAWAL_STATUS.pendingChecks,
    };
  },
});

export const cancelWithdrawal = mutation({
  args: {
    withdrawalId: v.id("withdrawals"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, strategyAccount } = await requireViewerAccount(ctx);
    const withdrawal = await ctx.db.get(args.withdrawalId);
    if (!withdrawal || withdrawal.strategyAccountId !== strategyAccount._id) {
      throw new Error("Withdrawal request not found");
    }
    if (!canTransitionWithdrawal(withdrawal.status as any, WITHDRAWAL_STATUS.cancelled)) {
      throw new Error(`Cannot cancel withdrawal from status ${withdrawal.status}`);
    }

    const now = Date.now();
    await ctx.db.patch(args.withdrawalId, {
      status: WITHDRAWAL_STATUS.cancelled,
      note: args.reason ?? withdrawal.note,
      lastStageAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      strategyAccountId: strategyAccount._id,
      userId: user._id,
      actor: "viewer",
      kind: "withdrawal.cancelled",
      summary: "Withdrawal cancelled",
      detail: args.reason,
      refTable: "withdrawals",
      refId: args.withdrawalId,
      createdAt: now,
    });

    return { withdrawalId: args.withdrawalId, status: WITHDRAWAL_STATUS.cancelled };
  },
});

export const upsertViewerUser = internalMutation({
  args: {
    authSubject: v.string(),
    authProvider: v.optional(v.string()),
    walletAddress: v.optional(v.string()),
    particleWalletAddress: v.optional(v.string()),
    particleUuid: v.optional(v.string()),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", args.authSubject))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        authProvider: args.authProvider,
        walletAddress: args.walletAddress,
        particleWalletAddress: args.particleWalletAddress,
        particleUuid: args.particleUuid,
        email: args.email,
        displayName: args.displayName,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      authSubject: args.authSubject,
      authProvider: args.authProvider,
      walletAddress: args.walletAddress,
      particleWalletAddress: args.particleWalletAddress,
      particleUuid: args.particleUuid,
      email: args.email,
      displayName: args.displayName,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const provisionStrategyAccountRecords = internalMutation({
  args: {
    userId: v.id("users"),
    label: v.string(),
    strategyType: v.string(),
    venueWallets: v.array(
      v.object({
        role: v.union(
          v.literal("optimism_execution_wallet"),
          v.literal("hyperliquid_master_wallet"),
          v.literal("hyperliquid_agent_wallet"),
        ),
        venue: v.union(v.literal("uniswap"), v.literal("hyperliquid")),
        chainRef: v.string(),
        accountRef: v.string(),
        walletAddress: v.string(),
        status: v.union(
          v.literal("provisioning"),
          v.literal("ready"),
          v.literal("approval_required"),
          v.literal("paused"),
        ),
        metadataJson: v.optional(v.string()),
        cipherText: v.string(),
        iv: v.string(),
        authTag: v.string(),
        algorithm: v.literal("aes-256-gcm"),
        keyVersion: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("strategyAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      if (!existing.accountWalletId) {
        const wallet = await ctx.db.query("accountWallets")
          .withIndex("by_userId", (q) => q.eq("userId", args.userId)).first();
        if (wallet) {
          await ctx.db.patch(existing._id, { accountWalletId: wallet._id, updatedAt: now });
          await ctx.db.patch(wallet._id, { strategyAccountId: existing._id, updatedAt: now });
        }
      }
      return { strategyAccountId: existing._id, created: false };
    }

    const accountWallet = await ctx.db
      .query("accountWallets")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (!accountWallet) {
      throw new Error("Sync your Particle or Magic Universal Account before creating a strategy.");
    }

    const strategyAccountId = await ctx.db.insert("strategyAccounts", {
      userId: args.userId,
      accountWalletId: accountWallet._id,
      strategyType: args.strategyType,
      label: args.label,
      status: "ready",
      emergencyStop: false,
      healthStatus: STRATEGY_HEALTH_STATUS.bootstrapping,
      healthReason: "Arbitrum strategy owner linked; connect at least one venue before activation.",
      healthUpdatedAt: now,
      lastReconciledAt: undefined,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(accountWallet._id, { strategyAccountId, updatedAt: now });

    const createdVenueAccounts: Record<string, string> = {};

    for (const wallet of args.venueWallets) {
      const venueAccountId = await ctx.db.insert("venueAccounts", {
        strategyAccountId,
        role: wallet.role,
        venue: wallet.venue,
        chainRef: wallet.chainRef,
        accountRef: wallet.accountRef,
        walletAddress: wallet.walletAddress,
        status: wallet.status,
        lastSyncedAt: undefined,
        lastSyncStatus: VENUE_SYNC_STATUS.never,
        lastSyncError: undefined,
        balanceJson: undefined,
        lastBalanceUsd: undefined,
        metadataJson: wallet.metadataJson,
        createdAt: now,
        updatedAt: now,
      });

      createdVenueAccounts[wallet.role] = venueAccountId;

      await ctx.db.insert("walletSecrets", {
        venueAccountId,
        address: wallet.walletAddress,
        cipherText: wallet.cipherText,
        iv: wallet.iv,
        authTag: wallet.authTag,
        algorithm: wallet.algorithm,
        keyVersion: wallet.keyVersion,
        createdAt: now,
        updatedAt: now,
      });

      const supportedAssets = getSupportedWalletAssets(wallet.role);
      for (const asset of supportedAssets) {
        await ctx.db.insert("walletAssetStates", {
          strategyAccountId,
          venueAccountId,
          venueRole: wallet.role,
          chainRef: wallet.chainRef,
          asset: asset.asset,
          purpose: asset.purpose,
          includedInStrategyEquity: asset.includedInStrategyEquity,
          balance: "0",
          valueUsd: 0,
          lastObservedAt: now,
          lastTransferAt: undefined,
          lastTransferRef: undefined,
          createdAt: now,
          updatedAt: now,
        });
      }

      if (wallet.role !== "hyperliquid_agent_wallet") {
        for (const asset of supportedAssets.filter((item) => item.supported)) {
          await ctx.db.insert("deposits", {
            strategyAccountId,
            venueAccountId,
            venueRole: wallet.role,
            asset: asset.asset,
            chainRef: wallet.chainRef,
            amount: undefined,
            detectedAmount: undefined,
            observedBalance: undefined,
            txHash: undefined,
            transferRef: undefined,
            idempotencyKey: undefined,
            status: "awaiting_funds",
            notes:
              wallet.role === "optimism_execution_wallet"
                ? asset.asset === "ETH"
                  ? "Operational gas reserve for the Optimism execution wallet."
                  : `Strategy funding rail for ${asset.asset} on the Optimism execution wallet.`
                : "Fund this HyperLiquid master wallet for strategy margin before enabling the strategy.",
            lastObservedAt: undefined,
            confirmedAt: undefined,
            creditedAt: undefined,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    await ctx.db.insert("strategyConfigs", {
      strategyAccountId,
      version: 1,
      active: true,
      ...DEFAULT_STRATEGY_CONFIG,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      strategyAccountId,
      userId: args.userId,
      actor: "system",
      kind: "strategy.provisioned",
      summary: "User-owned Arbitrum strategy account provisioned",
      detail: JSON.stringify({
        owner: accountWallet.evmUaAddress,
        chainId: 42161,
        generatedWallets: 0,
        strategyType: args.strategyType,
      }),
      createdAt: now,
    });

    return { strategyAccountId, created: true };
  },
});

export const updateManagedVenueStatus = internalMutation({
  args: {
    venueAccountId: v.id("venueAccounts"),
    status: v.union(
      v.literal("provisioning"),
      v.literal("ready"),
      v.literal("approval_required"),
      v.literal("paused"),
    ),
    metadataJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.venueAccountId, {
      status: args.status,
      metadataJson: args.metadataJson,
      updatedAt: Date.now(),
    });
  },
});

export const updateStrategyExecutionState = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    status: v.optional(
      v.union(
        v.literal("provisioning"),
        v.literal("ready"),
        v.literal("active"),
        v.literal("paused"),
        v.literal("emergency_stopped"),
      ),
    ),
    emergencyStop: v.optional(v.boolean()),
    lastHeartbeatAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
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
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (args.status !== undefined) patch.status = args.status;
    if (args.emergencyStop !== undefined) patch.emergencyStop = args.emergencyStop;
    if (args.lastHeartbeatAt !== undefined) patch.lastHeartbeatAt = args.lastHeartbeatAt;
    if (args.lastError !== undefined) patch.lastError = args.lastError;
    if (args.healthStatus !== undefined) patch.healthStatus = args.healthStatus;
    if (args.healthReason !== undefined) patch.healthReason = args.healthReason;
    if (args.healthUpdatedAt !== undefined) patch.healthUpdatedAt = args.healthUpdatedAt;
    if (args.lastReconciledAt !== undefined) patch.lastReconciledAt = args.lastReconciledAt;

    if (args.status !== undefined || args.emergencyStop !== undefined) {
      const account = await ctx.db.get(args.strategyAccountId);
      if (!account) throw new Error("Strategy account not found");
      patch.controlRevision = nextAccountControlRevision(account, args);
    }

    await ctx.db.patch(args.strategyAccountId, patch);
  },
});

export const syncVenueAccountState = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.id("venueAccounts"),
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
    totalValueUsd: v.optional(v.number()),
    balances: v.optional(
      v.array(
        v.object({
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
    ),
    transferRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const venueAccount = await ctx.db.get(args.venueAccountId);
    if (!venueAccount) {
      throw new Error("Venue account not found");
    }
    const existingAssetStates = await getWalletAssetStatesByVenueAccountId(ctx, args.venueAccountId);

    await ctx.db.patch(args.venueAccountId, {
      lastSyncedAt: now,
      lastSyncStatus: args.status,
      lastSyncError: args.error,
      balanceJson: args.dataJson,
      lastBalanceUsd: args.totalValueUsd,
      updatedAt: now,
    });

    await ctx.db.insert("venueStates", {
      strategyAccountId: args.strategyAccountId,
      venueAccountId: args.venueAccountId,
      venueRole: venueAccount.role,
      venue: venueAccount.venue,
      syncKind: args.syncKind,
      status: args.status,
      summary: args.summary,
      dataJson: args.dataJson,
      error: args.error,
      syncedAt: now,
    });

    const pendingDeposits = await ctx.db
      .query("deposits")
      .withIndex("by_venueAccountId", (q) => q.eq("venueAccountId", args.venueAccountId))
      .collect();

    const observedBalances = args.balances ?? [];
    for (const observedBalance of observedBalances) {
      const profile = getWalletAssetProfile(venueAccount.role, observedBalance.asset);
      const existingState = existingAssetStates.find(
        (row: any) => row.asset.toUpperCase() === observedBalance.asset.toUpperCase(),
      );
      const previousAmount = Number(existingState?.balance ?? 0);
      const nextAmount = Number(observedBalance.amount);
      const amountChanged = Number.isFinite(nextAmount) && Math.abs(nextAmount - previousAmount) > 0.00000001;
      const transferRef =
        args.transferRef ??
        `${args.syncKind}:${args.venueAccountId}:${observedBalance.asset.toUpperCase()}:${now}`;

      const nextState = {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: args.venueAccountId,
        venueRole: venueAccount.role,
        chainRef: venueAccount.chainRef,
        asset: observedBalance.asset.toUpperCase(),
        purpose: observedBalance.purpose ?? profile.purpose,
        includedInStrategyEquity:
          observedBalance.includedInStrategyEquity ?? profile.includedInStrategyEquity,
        balance: normalizeAmountString(observedBalance.amount),
        valueUsd: observedBalance.valueUsd,
        lastObservedAt: now,
        lastTransferAt: amountChanged ? now : existingState?.lastTransferAt,
        lastTransferRef: amountChanged ? transferRef : existingState?.lastTransferRef,
        updatedAt: now,
      };

      if (existingState) {
        await ctx.db.patch(existingState._id, nextState);
      } else {
        await ctx.db.insert("walletAssetStates", {
          ...nextState,
          createdAt: now,
        });
      }

      if (amountChanged) {
        const delta = nextAmount - previousAmount;
        await ctx.db.insert("walletTransferEvents", {
          strategyAccountId: args.strategyAccountId,
          venueAccountId: args.venueAccountId,
          venueRole: venueAccount.role,
          chainRef: venueAccount.chainRef,
          asset: observedBalance.asset.toUpperCase(),
          purpose: observedBalance.purpose ?? profile.purpose,
          includedInStrategyEquity:
            observedBalance.includedInStrategyEquity ?? profile.includedInStrategyEquity,
          direction: delta >= 0 ? "in" : "out",
          amount: normalizeAmountString(Math.abs(delta)),
          balanceAfter: normalizeAmountString(observedBalance.amount),
          valueUsd: estimateObservedTransferUsd({
            previousAmount: existingState?.balance,
            nextAmount: observedBalance.amount,
            previousValueUsd: existingState?.valueUsd,
            nextValueUsd: observedBalance.valueUsd,
          }),
          transferRef,
          txHash: undefined,
          observedAt: now,
          detail:
            delta >= 0
              ? `${observedBalance.asset.toUpperCase()} balance increased during venue sync.`
              : `${observedBalance.asset.toUpperCase()} balance decreased during venue sync.`,
          createdAt: now,
        });
      }
    }

    for (const deposit of pendingDeposits) {
      if (!["awaiting_funds", "detected"].includes(deposit.status)) continue;
      const matchingBalance = observedBalances.find(
        (balance) => balance.asset.toUpperCase() === deposit.asset.toUpperCase(),
      );
      if (!matchingBalance) continue;
      const observedAmount = Number(matchingBalance.amount);
      if (!Number.isFinite(observedAmount) || observedAmount <= 0) continue;

      const nextStatus = deposit.status === "awaiting_funds" ? "detected" : "confirmed";
      await ctx.db.patch(deposit._id, {
        detectedAmount: matchingBalance.amount,
        observedBalance: matchingBalance.amount,
        transferRef: args.transferRef ?? deposit.transferRef,
        status: nextStatus,
        lastObservedAt: now,
        confirmedAt: nextStatus === "confirmed" ? now : deposit.confirmedAt,
        updatedAt: now,
      });

      await ctx.db.insert("reconciliationDeltas", {
        strategyAccountId: args.strategyAccountId,
        venueAccountId: args.venueAccountId,
        kind: "deposit",
        status: nextStatus === "confirmed" ? "matched" : "pending",
        asset: deposit.asset,
        expectedAmount: deposit.amount,
        observedAmount: matchingBalance.amount,
        deltaAmount: deposit.amount ? String(Number(matchingBalance.amount) - Number(deposit.amount)) : undefined,
        summary:
          nextStatus === "confirmed"
            ? `${deposit.asset} deposit confirmed from venue sync.`
            : `${deposit.asset} deposit detected from venue sync.`,
        detail: args.summary,
        refTable: "deposits",
        refId: deposit._id,
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.patch(args.strategyAccountId, {
      lastReconciledAt: now,
      healthStatus: args.status === "error" ? STRATEGY_HEALTH_STATUS.degraded : undefined,
      healthReason: args.status === "error" ? args.summary : undefined,
      healthUpdatedAt: args.status === "error" ? now : undefined,
      updatedAt: now,
    });
  },
});

export const recordReconciliationDelta = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.optional(v.id("venueAccounts")),
    kind: v.union(
      v.literal("balance"),
      v.literal("deposit"),
      v.literal("withdrawal"),
      v.literal("lp_position"),
      v.literal("hedge_position"),
    ),
    status: v.union(v.literal("matched"), v.literal("pending"), v.literal("drift"), v.literal("resolved")),
    asset: v.optional(v.string()),
    expectedAmount: v.optional(v.string()),
    observedAmount: v.optional(v.string()),
    deltaAmount: v.optional(v.string()),
    summary: v.string(),
    detail: v.optional(v.string()),
    refTable: v.optional(v.string()),
    refId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("reconciliationDeltas", {
      ...args,
      createdAt: now,
      updatedAt: now,
      resolvedAt: args.status === "resolved" ? now : undefined,
    });
  },
});

export const recordIncidentEvent = internalMutation({
  args: {
    strategyAccountId: v.optional(v.id("strategyAccounts")),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    code: v.string(),
    summary: v.string(),
    detail: v.optional(v.string()),
    runbook: v.optional(v.string()),
    status: v.optional(v.union(v.literal("open"), v.literal("acknowledged"), v.literal("resolved"))),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("incidentEvents", {
      ...args,
      status: args.status ?? "open",
      createdAt: now,
      updatedAt: now,
      resolvedAt: args.status === "resolved" ? now : undefined,
    });
  },
});

export const transitionWithdrawalState = internalMutation({
  args: {
    withdrawalId: v.id("withdrawals"),
    nextStatus: v.union(
      v.literal("draft"),
      v.literal("pending_checks"),
      v.literal("queued"),
      v.literal("signing"),
      v.literal("submitted"),
      v.literal("confirming"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("requested"),
      v.literal("processing"),
      v.literal("rejected"),
    ),
    txHash: v.optional(v.string()),
    note: v.optional(v.string()),
    failureCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const withdrawal = await ctx.db.get(args.withdrawalId);
    if (!withdrawal) {
      throw new Error("Withdrawal request not found");
    }
    if (!canTransitionWithdrawal(withdrawal.status as any, args.nextStatus as any)) {
      throw new Error(`Cannot transition withdrawal from ${withdrawal.status} to ${args.nextStatus}`);
    }

    const now = Date.now();
    await ctx.db.patch(args.withdrawalId, {
      status: args.nextStatus,
      txHash: args.txHash ?? withdrawal.txHash,
      note: args.note ?? withdrawal.note,
      failureCode: args.failureCode ?? withdrawal.failureCode,
      lastStageAt: now,
      completedAt: args.nextStatus === WITHDRAWAL_STATUS.completed ? now : withdrawal.completedAt,
      updatedAt: now,
    });

    await ctx.db.insert("reconciliationDeltas", {
      strategyAccountId: withdrawal.strategyAccountId,
      venueAccountId: withdrawal.venueAccountId,
      kind: "withdrawal",
      status:
        args.nextStatus === WITHDRAWAL_STATUS.completed
          ? "matched"
          : args.nextStatus === WITHDRAWAL_STATUS.failed
            ? "drift"
            : "pending",
      asset: withdrawal.asset,
      expectedAmount: withdrawal.amount,
      observedAmount: undefined,
      deltaAmount: undefined,
      summary: `Withdrawal moved to ${args.nextStatus}.`,
      detail: args.note,
      refTable: "withdrawals",
      refId: args.withdrawalId,
      createdAt: now,
      updatedAt: now,
    });

    return { withdrawalId: args.withdrawalId, status: args.nextStatus };
  },
});

export const updateWithdrawalMetadata = internalMutation({
  args: {
    withdrawalId: v.id("withdrawals"),
    feeEstimateUsd: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const withdrawal = await ctx.db.get(args.withdrawalId);
    if (!withdrawal) {
      throw new Error("Withdrawal request not found");
    }

    await ctx.db.patch(args.withdrawalId, {
      feeEstimateUsd: args.feeEstimateUsd ?? withdrawal.feeEstimateUsd,
      note: args.note ?? withdrawal.note,
      updatedAt: Date.now(),
    });

    return { withdrawalId: args.withdrawalId };
  },
});

export const replaceManagedVenueWallet = internalMutation({
  args: {
    venueAccountId: v.id("venueAccounts"),
    walletAddress: v.string(),
    accountRef: v.string(),
    metadataJson: v.optional(v.string()),
    cipherText: v.string(),
    iv: v.string(),
    authTag: v.string(),
    keyVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const venueAccount = await ctx.db.get(args.venueAccountId);
    if (!venueAccount) {
      throw new Error("Venue account not found");
    }
    const walletSecret = await ctx.db
      .query("walletSecrets")
      .withIndex("by_venueAccountId", (q) => q.eq("venueAccountId", args.venueAccountId))
      .first();
    if (!walletSecret) {
      throw new Error("Wallet secret not found");
    }

    const now = Date.now();
    await ctx.db.patch(args.venueAccountId, {
      walletAddress: args.walletAddress,
      accountRef: args.accountRef,
      metadataJson: args.metadataJson,
      status: "approval_required",
      updatedAt: now,
    });
    await ctx.db.patch(walletSecret._id, {
      address: args.walletAddress,
      cipherText: args.cipherText,
      iv: args.iv,
      authTag: args.authTag,
      keyVersion: args.keyVersion,
      updatedAt: now,
    });

    return { venueAccountId: args.venueAccountId };
  },
});

export const recordCanaryCheck = internalMutation({
  args: {
    scope: v.string(),
    venue: v.string(),
    checkType: v.string(),
    status: v.union(v.literal("pass"), v.literal("warn"), v.literal("fail")),
    summary: v.string(),
    detail: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("canaryChecks", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
