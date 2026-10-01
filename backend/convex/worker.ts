import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_LEASE_TTL_MS } from "./constants";
import { canAcquireLease } from "./helpers/leases";
import {
  getActiveStrategyConfig,
  getExecutionsSince,
  getExecutionLeaseByStrategyAccountId,
  getLatestBalanceSnapshot,
  getOpenHedgePositions,
  getOpenLpPositions,
  getWithdrawalsByStrategyAccountId,
  getVenueAccountsByStrategyAccountId,
} from "./model";

export const listRunnableAccounts = internalQuery({
  args: {
    includeReady: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const activeAccounts = await ctx.db
      .query("strategyAccounts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    const readyAccounts =
      args.includeReady === true
        ? await ctx.db.query("strategyAccounts").withIndex("by_status", (q) => q.eq("status", "ready")).collect()
        : [];

    const accounts = [...activeAccounts, ...readyAccounts].filter((account) => !account.emergencyStop);

    return await Promise.all(
      accounts.map(async (account) => {
        const [
          config,
          venueAccounts,
          latestSnapshot,
          lpPositions,
          hedgePositions,
          lease,
          recentExecutions,
          pendingWithdrawals,
        ] = await Promise.all([
          getActiveStrategyConfig(ctx, account._id),
          getVenueAccountsByStrategyAccountId(ctx, account._id),
          getLatestBalanceSnapshot(ctx, account._id),
          getOpenLpPositions(ctx, account._id),
          getOpenHedgePositions(ctx, account._id),
          getExecutionLeaseByStrategyAccountId(ctx, account._id),
          getExecutionsSince(ctx, account._id, Date.now() - 86_400_000),
          getWithdrawalsByStrategyAccountId(ctx, account._id, 10),
        ]);

        return {
          strategyAccountId: account._id,
          status: account.status,
          strategyType: account.strategyType,
          lastHeartbeatAt: account.lastHeartbeatAt ?? null,
          lastError: account.lastError ?? null,
          healthStatus: account.healthStatus ?? null,
          healthReason: account.healthReason ?? null,
          lastReconciledAt: account.lastReconciledAt ?? null,
          config,
          venueAccounts,
          latestSnapshot,
          lpPositions,
          hedgePositions,
          lease,
          recentExecutions,
          pendingWithdrawals: pendingWithdrawals.filter((withdrawal: any) =>
            ["pending_checks", "queued", "signing", "submitted", "confirming", "processing"].includes(
              withdrawal.status,
            ),
          ),
        };
      }),
    );
  },
});

export const acquireExecutionLease = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    holderId: v.string(),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ttlMs = args.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    const existing = await getExecutionLeaseByStrategyAccountId(ctx, args.strategyAccountId);

    if (!existing) {
      const leaseId = await ctx.db.insert("executionLeases", {
        strategyAccountId: args.strategyAccountId,
        holderId: args.holderId,
        status: "active",
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: now + ttlMs,
      });

      return {
        acquired: true,
        leaseId,
        expiresAt: now + ttlMs,
      };
    }

    if (!canAcquireLease(existing, now, args.holderId)) {
      return {
        acquired: false,
        leaseId: existing._id,
        expiresAt: existing.expiresAt,
        holderId: existing.holderId,
      };
    }

    await ctx.db.patch(existing._id, {
      holderId: args.holderId,
      status: "active",
      acquiredAt: existing.holderId === args.holderId ? existing.acquiredAt : now,
      heartbeatAt: now,
      expiresAt: now + ttlMs,
      releasedAt: undefined,
    });

    return {
      acquired: true,
      leaseId: existing._id,
      expiresAt: now + ttlMs,
    };
  },
});

export const heartbeatExecutionLease = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    holderId: v.string(),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await getExecutionLeaseByStrategyAccountId(ctx, args.strategyAccountId);
    if (!existing || existing.holderId !== args.holderId || existing.status !== "active") {
      return { heartbeated: false };
    }

    const now = Date.now();
    const ttlMs = args.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    await ctx.db.patch(existing._id, {
      heartbeatAt: now,
      expiresAt: now + ttlMs,
    });
    await ctx.db.patch(args.strategyAccountId, {
      lastHeartbeatAt: now,
      updatedAt: now,
    });

    return { heartbeated: true, expiresAt: now + ttlMs };
  },
});

export const releaseExecutionLease = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    holderId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await getExecutionLeaseByStrategyAccountId(ctx, args.strategyAccountId);
    if (!existing || existing.holderId !== args.holderId) {
      return { released: false };
    }

    const now = Date.now();
    await ctx.db.patch(existing._id, {
      status: "released",
      heartbeatAt: now,
      expiresAt: now,
      releasedAt: now,
    });

    return { released: true };
  },
});

export const recordExecution = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const executionId = await ctx.db.insert("executions", {
      ...args,
      createdAt: now,
      updatedAt: now,
      executedAt: args.status === "submitted" || args.status === "filled" ? now : undefined,
    });

    await ctx.db.patch(args.strategyAccountId, {
      lastHeartbeatAt: now,
      lastError: args.status === "failed" ? args.detail ?? args.summary : undefined,
      updatedAt: now,
    });

    return { executionId };
  },
});

export const recordSnapshot = internalMutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const snapshotId = await ctx.db.insert("balanceSnapshots", args);

    await ctx.db.patch(args.strategyAccountId, {
      lastHeartbeatAt: args.capturedAt,
      updatedAt: Date.now(),
    });

    return { snapshotId };
  },
});

export const recordAlert = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("critical")),
    code: v.string(),
    message: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const alertId = await ctx.db.insert("strategyAlerts", {
      ...args,
      status: "open",
      createdAt: now,
      updatedAt: now,
      resolvedAt: undefined,
    });

    if (args.severity === "critical") {
      await ctx.db.patch(args.strategyAccountId, {
        lastError: args.message,
        healthStatus: "degraded",
        healthReason: args.message,
        healthUpdatedAt: now,
        updatedAt: now,
      });
    }

    return { alertId };
  },
});

export const markDepositConfirmed = internalMutation({
  args: {
    depositId: v.id("deposits"),
    amount: v.optional(v.string()),
    txHash: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("awaiting_funds"),
        v.literal("detected"),
        v.literal("confirmed"),
        v.literal("credited"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const deposit = await ctx.db.get(args.depositId);
    if (!deposit) {
      throw new Error("Deposit not found");
    }

    const now = Date.now();
    const nextStatus = args.status ?? "confirmed";
    await ctx.db.patch(args.depositId, {
      amount: args.amount ?? deposit.amount,
      txHash: args.txHash ?? deposit.txHash,
      status: nextStatus,
      confirmedAt: nextStatus === "confirmed" || nextStatus === "credited" ? now : deposit.confirmedAt,
      updatedAt: now,
    });

    await ctx.db.patch(deposit.strategyAccountId, {
      updatedAt: now,
    });

    return { depositId: args.depositId, status: nextStatus };
  },
});

export const listPendingWithdrawals = internalQuery({
  args: {
    strategyAccountId: v.optional(v.id("strategyAccounts")),
  },
  handler: async (ctx, args) => {
    const rows = args.strategyAccountId
      ? await ctx.db
          .query("withdrawals")
          .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", args.strategyAccountId!))
          .collect()
      : await ctx.db.query("withdrawals").collect();

    return rows.filter((withdrawal) =>
      [
        "pending_checks",
        "queued",
        "signing",
        "submitted",
        "confirming",
        "processing",
      ].includes(withdrawal.status),
    );
  },
});

export const getWithdrawalRequest = internalQuery({
  args: {
    withdrawalId: v.id("withdrawals"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.withdrawalId);
  },
});

export const confirmWithdrawalState = internalMutation({
  args: {
    withdrawalId: v.id("withdrawals"),
    txHash: v.optional(v.string()),
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
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.withdrawalId);
    if (!existing) {
      throw new Error("Withdrawal request not found");
    }

    await ctx.db.patch(args.withdrawalId, {
      txHash: args.txHash ?? existing.txHash,
      status: args.status,
      note: args.note ?? existing.note,
      failureCode: args.status === "completed" ? undefined : existing.failureCode,
      lastStageAt: Date.now(),
      completedAt: args.status === "completed" ? Date.now() : existing.completedAt,
      updatedAt: Date.now(),
    });

    return { withdrawalId: args.withdrawalId, status: args.status };
  },
});
