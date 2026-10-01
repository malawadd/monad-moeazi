import { query } from "./_generated/server";
import {
  computeWithdrawableBalance,
  getSupportedWalletAssets,
  getWalletAssetProfile,
  isLowGasReserve,
} from "./helpers/walletAssets";
import {
  getActiveStrategyConfig,
  getLatestBalanceSnapshot,
  getOpenAlerts,
  getOpenHedgePositions,
  getOpenLpPositions,
  getRecentAuditEvents,
  getRecentIncidentEvents,
  getRecentReconciliationDeltas,
  getRecentExecutions,
  getRecentVenueStates,
  getRecentWalletTransferEvents,
  getStrategyAccountByUserId,
  getUserByAuthSubject,
  getWalletAssetStatesByStrategyAccountId,
  getWithdrawalsByStrategyAccountId,
  getVenueAccountsByStrategyAccountId,
  requireViewerStrategy,
} from "./model";
import { STRATEGY_SLUG } from "./constants";

async function getViewerState(ctx: { auth: any; db: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return { identity: null, user: null, strategyAccount: null };
  }

  const { user, strategyAccount } = await requireViewerStrategy(ctx, identity.subject);
  return { identity, user, strategyAccount };
}

function numberOrZero(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function buildFundingAccountSummaries(args: {
  venueAccounts: any[];
  assetStates: any[];
  transferEvents: any[];
  deposits: any[];
}) {
  const fundingAccounts = args.venueAccounts.filter(
    (account: any) =>
      account.role === "optimism_execution_wallet" || account.role === "hyperliquid_master_wallet",
  );

  const accountSummaries = fundingAccounts.map((account: any) => {
    const supportedAssets = getSupportedWalletAssets(account.role as any);
    let stateRows = args.assetStates.filter((row: any) => row.venueAccountId === account._id);
    if (stateRows.length === 0 && account.balanceJson) {
      try {
        const parsed = JSON.parse(account.balanceJson);
        const balances = Array.isArray(parsed?.balances) ? parsed.balances : [];
        stateRows = balances.map((row: any) => {
          const profile = getWalletAssetProfile(account.role as any, row.asset);
          return {
            asset: String(row.asset ?? "").toUpperCase(),
            purpose: row.purpose ?? profile.purpose,
            includedInStrategyEquity:
              row.includedInStrategyEquity ?? profile.includedInStrategyEquity,
            balance: String(row.amount ?? "0"),
            valueUsd: numberOrZero(row.valueUsd),
            lastObservedAt: account.lastSyncedAt ?? null,
            lastTransferAt: null,
            lastTransferRef: null,
          };
        });
      } catch {
        stateRows = [];
      }
    }
    const transferRows = args.transferEvents
      .filter((row: any) => row.venueAccountId === account._id)
      .slice(0, 6);
    const depositRows = args.deposits.filter((deposit: any) => deposit.venueAccountId === account._id);
    const supportedAssetSet = new Set(supportedAssets.map((item) => item.asset));
    const assetRows = supportedAssets.map((profile) => {
      const state = stateRows.find((row: any) => row.asset.toUpperCase() === profile.asset);
      const withdrawable = computeWithdrawableBalance({
        role: account.role,
        asset: profile.asset,
        balance: state?.balance,
      });
      return {
        asset: profile.asset,
        purpose: state?.purpose ?? profile.purpose,
        label: profile.label,
        balance: state?.balance ?? "0",
        valueUsd: state?.valueUsd ?? 0,
        includedInStrategyEquity:
          state?.includedInStrategyEquity ?? profile.includedInStrategyEquity,
        lastObservedAt: state?.lastObservedAt ?? account.lastSyncedAt ?? null,
        lastTransferAt: state?.lastTransferAt ?? null,
        lastTransferRef: state?.lastTransferRef ?? null,
        availableBalance: withdrawable.amount,
        withdrawNote: withdrawable.note ?? null,
        reserveAmount: withdrawable.reserveAmount,
      };
    });

    for (const state of stateRows) {
      if (supportedAssetSet.has(state.asset.toUpperCase())) continue;
      const profile = getWalletAssetProfile(account.role as any, state.asset);
      const withdrawable = computeWithdrawableBalance({
        role: account.role,
        asset: state.asset,
        balance: state.balance,
      });
      assetRows.push({
        asset: state.asset,
        purpose: state.purpose ?? profile.purpose,
        label: profile.label,
        balance: state.balance,
        valueUsd: state.valueUsd,
        includedInStrategyEquity: state.includedInStrategyEquity ?? profile.includedInStrategyEquity,
        lastObservedAt: state.lastObservedAt ?? null,
        lastTransferAt: state.lastTransferAt ?? null,
        lastTransferRef: state.lastTransferRef ?? null,
        availableBalance: withdrawable.amount,
        withdrawNote: withdrawable.note ?? null,
        reserveAmount: withdrawable.reserveAmount,
      });
    }

    const strategyAssets = assetRows.filter((row) => row.includedInStrategyEquity);
    const operationalAssets = assetRows.filter((row) => !row.includedInStrategyEquity);
    const totalWalletHoldingsUsd = assetRows.reduce((sum, row) => sum + numberOrZero(row.valueUsd), 0);
    const strategyAssetValueUsd = strategyAssets.reduce((sum, row) => sum + numberOrZero(row.valueUsd), 0);
    const gasReserveValueUsd = operationalAssets
      .filter((row) => row.purpose === "gas")
      .reduce((sum, row) => sum + numberOrZero(row.valueUsd), 0);
    const gasAsset = assetRows.find((row) => row.asset === "ETH" && row.purpose === "gas");
    const fallbackTransfers =
      transferRows.length === 0
        ? assetRows
            .filter((row) => numberOrZero(row.balance) > 0 && row.lastObservedAt)
            .slice(0, 3)
            .map((row) => ({
              id: `fallback-${account._id}-${row.asset}`,
              asset: row.asset,
              purpose: row.purpose,
              direction: "in",
              amount: row.balance,
              balanceAfter: row.balance,
              valueUsd: row.valueUsd,
              transferRef: `snapshot:${account._id}:${row.asset}`,
              observedAt: row.lastObservedAt,
              detail: "Recovered from the last venue sync. Fresh transfer events appear after the next supervisor sync.",
            }))
        : [];

    return {
      venueAccountId: account._id,
      role: account.role,
      venue: account.venue,
      chainRef: account.chainRef,
      accountRef: account.accountRef,
      walletAddress: account.walletAddress,
      status: account.status,
      lastSyncedAt: account.lastSyncedAt ?? null,
      lastSyncStatus: account.lastSyncStatus ?? null,
      lastSyncError: account.lastSyncError ?? null,
      assets: assetRows.map((row) => row.asset),
      strategyAssets,
      operationalAssets,
      walletAssets: assetRows,
      recentTransfers:
        transferRows.length > 0
          ? transferRows.map((event: any) => ({
              id: event._id,
              asset: event.asset,
              purpose: event.purpose,
              direction: event.direction,
              amount: event.amount,
              balanceAfter: event.balanceAfter,
              valueUsd: event.valueUsd,
              transferRef: event.transferRef,
              observedAt: event.observedAt,
              detail: event.detail ?? null,
            }))
          : fallbackTransfers,
      depositRecords: depositRows.map((deposit: any) => ({
        id: deposit._id,
        asset: deposit.asset,
        status: deposit.status,
        amount: deposit.amount ?? null,
        detectedAmount: deposit.detectedAmount ?? null,
        observedBalance: deposit.observedBalance ?? null,
        lastObservedAt: deposit.lastObservedAt ?? null,
        confirmedAt: deposit.confirmedAt ?? null,
        notes: deposit.notes ?? null,
      })),
      totalWalletHoldingsUsd,
      strategyAssetValueUsd,
      gasReserveValueUsd,
      lowGasWarning:
        gasAsset && isLowGasReserve({ role: account.role, asset: gasAsset.asset, balance: gasAsset.balance })
          ? {
              asset: gasAsset.asset,
              currentBalance: gasAsset.balance,
              message: "Optimism gas reserve is running low for future onchain actions.",
            }
          : null,
      note:
        account.role === "optimism_execution_wallet"
          ? "Strategy assets and operational gas reserve live in the same Optimism execution wallet, but only strategy assets count toward Moeazi strategy equity."
          : "Fund this HyperLiquid master wallet for strategy margin. Agent approval is handled separately.",
    };
  });

  return {
    accounts: accountSummaries,
    totals: {
      totalWalletHoldingsUsd: accountSummaries.reduce(
        (sum, account) => sum + numberOrZero(account.totalWalletHoldingsUsd),
        0,
      ),
      strategyAssetValueUsd: accountSummaries.reduce(
        (sum, account) => sum + numberOrZero(account.strategyAssetValueUsd),
        0,
      ),
      gasReserveValueUsd: accountSummaries.reduce(
        (sum, account) => sum + numberOrZero(account.gasReserveValueUsd),
        0,
      ),
      lowGasWarnings: accountSummaries
        .filter((account) => account.lowGasWarning)
        .map((account) => ({
          venueAccountId: account.venueAccountId,
          role: account.role,
          ...account.lowGasWarning,
        })),
    },
  };
}

export const getStrategyDashboard = query({
  args: {},
  handler: async (ctx) => {
    const { user, strategyAccount } = await getViewerState(ctx);
    const accountWallet = user
      ? await ctx.db.query("accountWallets").withIndex("by_userId", (q) => q.eq("userId", user._id)).first()
      : null;
    if (!user || !strategyAccount) {
      return {
        hasStrategyAccount: false,
        strategyType: STRATEGY_SLUG,
        accountWallet,
        user: user
          ? {
              authSubject: user.authSubject ?? null,
              authProvider: user.authProvider ?? null,
              particleWalletAddress: user.particleWalletAddress ?? null,
              particleUuid: user.particleUuid ?? null,
              email: user.email ?? null,
              displayName: user.displayName ?? null,
            }
          : null,
      };
    }

    const [
      config,
      venueAccounts,
      latestSnapshot,
      lpPositions,
      hedgePositions,
      alerts,
      recentExecutions,
      recentAudit,
      venueStates,
      incidents,
      reconciliationDeltas,
      withdrawals,
      walletAssetStates,
      transferEvents,
    ] =
      await Promise.all([
        getActiveStrategyConfig(ctx, strategyAccount._id),
        getVenueAccountsByStrategyAccountId(ctx, strategyAccount._id),
        getLatestBalanceSnapshot(ctx, strategyAccount._id),
        getOpenLpPositions(ctx, strategyAccount._id),
        getOpenHedgePositions(ctx, strategyAccount._id),
        getOpenAlerts(ctx, strategyAccount._id, 6),
        getRecentExecutions(ctx, strategyAccount._id, 12),
        getRecentAuditEvents(ctx, strategyAccount._id, 12),
        getRecentVenueStates(ctx, strategyAccount._id, 12),
        getRecentIncidentEvents(ctx, strategyAccount._id, 8),
        getRecentReconciliationDeltas(ctx, strategyAccount._id, 8),
        getWithdrawalsByStrategyAccountId(ctx, strategyAccount._id, 10),
        getWalletAssetStatesByStrategyAccountId(ctx, strategyAccount._id),
        getRecentWalletTransferEvents(ctx, strategyAccount._id, 12),
      ]);
    const walletInventory = buildFundingAccountSummaries({
      venueAccounts,
      assetStates: walletAssetStates,
      transferEvents,
      deposits: [],
    });

    return {
      hasStrategyAccount: true,
      strategyType: strategyAccount.strategyType,
      accountWallet,
      user: {
        authSubject: user.authSubject ?? null,
        authProvider: user.authProvider ?? null,
        particleWalletAddress: user.particleWalletAddress ?? null,
        particleUuid: user.particleUuid ?? null,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
      },
      strategyAccount: {
        id: strategyAccount._id,
        label: strategyAccount.label,
        status: strategyAccount.status,
        emergencyStop: strategyAccount.emergencyStop,
        enabledAt: strategyAccount.enabledAt ?? null,
        pausedAt: strategyAccount.pausedAt ?? null,
        lastHeartbeatAt: strategyAccount.lastHeartbeatAt ?? null,
        healthStatus: strategyAccount.healthStatus ?? null,
        healthReason: strategyAccount.healthReason ?? null,
        healthUpdatedAt: strategyAccount.healthUpdatedAt ?? null,
        lastReconciledAt: strategyAccount.lastReconciledAt ?? null,
        lastError: strategyAccount.lastError ?? null,
      },
      config,
      venueAccounts: venueAccounts.map((account: any) => ({
        id: account._id,
        role: account.role,
        venue: account.venue,
        chainRef: account.chainRef,
        accountRef: account.accountRef,
        walletAddress: account.walletAddress,
        status: account.status,
        lastSyncedAt: account.lastSyncedAt ?? null,
        lastSyncStatus: account.lastSyncStatus ?? null,
        lastSyncError: account.lastSyncError ?? null,
        lastBalanceUsd: account.lastBalanceUsd ?? null,
        metadataJson: account.metadataJson ?? null,
      })),
      latestSnapshot,
      openLpPositions: lpPositions,
      openHedgePositions: hedgePositions,
      openAlerts: alerts,
      recentExecutions,
      recentAudit,
      recentVenueStates: venueStates,
      recentIncidents: incidents,
      recentReconciliationDeltas: reconciliationDeltas,
      recentWithdrawals: withdrawals,
      fundingAccounts: walletInventory.accounts,
      walletSummary: walletInventory.totals,
    };
  },
});

export const getDepositInstructions = query({
  args: {},
  handler: async (ctx) => {
    const { strategyAccount } = await getViewerState(ctx);
    if (!strategyAccount) {
      return [];
    }

    const [venueAccounts, deposits, assetStates, transferEvents] = await Promise.all([
      getVenueAccountsByStrategyAccountId(ctx, strategyAccount._id),
      ctx.db
        .query("deposits")
        .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategyAccount._id))
        .collect(),
      getWalletAssetStatesByStrategyAccountId(ctx, strategyAccount._id),
      getRecentWalletTransferEvents(ctx, strategyAccount._id, 20),
    ]);

    return buildFundingAccountSummaries({
      venueAccounts,
      assetStates,
      transferEvents,
      deposits,
    }).accounts;
  },
});

export const getExecutionActivity = query({
  args: {},
  handler: async (ctx) => {
    const { strategyAccount } = await getViewerState(ctx);
    if (!strategyAccount) {
      return {
        executions: [],
        auditEvents: [],
      };
    }

    const [executions, auditEvents, incidents, withdrawals] = await Promise.all([
      getRecentExecutions(ctx, strategyAccount._id, 40),
      getRecentAuditEvents(ctx, strategyAccount._id, 40),
      getRecentIncidentEvents(ctx, strategyAccount._id, 20),
      getWithdrawalsByStrategyAccountId(ctx, strategyAccount._id, 20),
    ]);

    return {
      executions,
      auditEvents,
      incidents,
      withdrawals,
    };
  },
});

export const getRiskStatus = query({
  args: {},
  handler: async (ctx) => {
    const { strategyAccount } = await getViewerState(ctx);
    if (!strategyAccount) {
      return {
        hasStrategyAccount: false,
      };
    }

    const [config, latestSnapshot, alerts, lpPositions, hedgePositions, venueStates, incidents,
      reconciliationDeltas, safetyDecisions, safetyIncidents] =
      await Promise.all([
      getActiveStrategyConfig(ctx, strategyAccount._id),
      getLatestBalanceSnapshot(ctx, strategyAccount._id),
      getOpenAlerts(ctx, strategyAccount._id, 10),
      getOpenLpPositions(ctx, strategyAccount._id),
      getOpenHedgePositions(ctx, strategyAccount._id),
      getRecentVenueStates(ctx, strategyAccount._id, 12),
      getRecentIncidentEvents(ctx, strategyAccount._id, 12),
      getRecentReconciliationDeltas(ctx, strategyAccount._id, 12),
      ctx.db.query("safetyEnvelopeProjections").withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", strategyAccount._id)).collect(),
      ctx.db.query("dependencySafetyIncidents").withIndex("by_strategyAccountId", (q: any) =>
        q.eq("strategyAccountId", strategyAccount._id)).collect(),
    ]);

    return {
      hasStrategyAccount: true,
      strategyAccount: {
        id: strategyAccount._id,
        status: strategyAccount.status,
        emergencyStop: strategyAccount.emergencyStop,
        lastHeartbeatAt: strategyAccount.lastHeartbeatAt ?? null,
        healthStatus: strategyAccount.healthStatus ?? null,
        healthReason: strategyAccount.healthReason ?? null,
        lastReconciledAt: strategyAccount.lastReconciledAt ?? null,
        lastError: strategyAccount.lastError ?? null,
      },
      config,
      latestSnapshot,
      alerts,
      lpPositions,
      hedgePositions,
      venueStates,
      incidents,
      reconciliationDeltas,
      dependencySafety: {
        decisions: safetyDecisions.sort((a: any, b: any) => b.evaluatedAt - a.evaluatedAt),
        incidents: safetyIncidents.sort((a: any, b: any) => b.lastObservedAt - a.lastObservedAt),
      },
    };
  },
});

export const getWithdrawalStatus = query({
  args: {},
  handler: async (ctx) => {
    const { strategyAccount } = await getViewerState(ctx);
    if (!strategyAccount) {
      return {
        hasStrategyAccount: false,
        withdrawals: [],
      };
    }

    const [withdrawals, venueAccounts, incidents, assetStates, transferEvents, deposits] = await Promise.all([
      getWithdrawalsByStrategyAccountId(ctx, strategyAccount._id, 30),
      getVenueAccountsByStrategyAccountId(ctx, strategyAccount._id),
      getRecentIncidentEvents(ctx, strategyAccount._id, 10),
      getWalletAssetStatesByStrategyAccountId(ctx, strategyAccount._id),
      getRecentWalletTransferEvents(ctx, strategyAccount._id, 20),
      ctx.db
        .query("deposits")
        .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategyAccount._id))
        .collect(),
    ]);
    const walletInventory = buildFundingAccountSummaries({
      venueAccounts,
      assetStates,
      transferEvents,
      deposits,
    });

    return {
      hasStrategyAccount: true,
      withdrawals: withdrawals.map((withdrawal: any) => ({
        ...withdrawal,
        venueRole:
          venueAccounts.find((account: any) => account._id === withdrawal.venueAccountId)?.role ?? null,
      })),
      incidents,
      fundingAccounts: walletInventory.accounts,
      walletSummary: walletInventory.totals,
    };
  },
});

export const getStrategyAccount = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const user = await getUserByAuthSubject(ctx, identity.subject);
    if (!user) {
      return null;
    }

    return await getStrategyAccountByUserId(ctx, user._id);
  },
});
