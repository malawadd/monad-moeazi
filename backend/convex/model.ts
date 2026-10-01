import { Id } from "./_generated/dataModel";

export async function getUserByAuthSubject(ctx: { db: any }, authSubject: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_authSubject", (q: any) => q.eq("authSubject", authSubject))
    .first();
}

export async function getStrategyAccountByUserId(ctx: { db: any }, userId: Id<"users">) {
  return await ctx.db
    .query("strategyAccounts")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
}

export async function getActiveStrategyConfig(ctx: { db: any }, strategyAccountId: Id<"strategyAccounts">) {
  return await ctx.db
    .query("strategyConfigs")
    .withIndex("by_strategyAccountId_active", (q: any) =>
      q.eq("strategyAccountId", strategyAccountId).eq("active", true),
    )
    .first();
}

export async function getStrategyConfigs(ctx: { db: any }, strategyAccountId: Id<"strategyAccounts">) {
  return await ctx.db
    .query("strategyConfigs")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .first();
}

export async function getVenueAccountsByStrategyAccountId(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
) {
  return await ctx.db
    .query("venueAccounts")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .collect();
}

export async function getWalletAssetStatesByStrategyAccountId(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
) {
  return await ctx.db
    .query("walletAssetStates")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .collect();
}

export async function getWalletAssetStatesByVenueAccountId(
  ctx: { db: any },
  venueAccountId: Id<"venueAccounts">,
) {
  return await ctx.db
    .query("walletAssetStates")
    .withIndex("by_venueAccountId", (q: any) => q.eq("venueAccountId", venueAccountId))
    .collect();
}

export async function getWalletAssetStateByVenueAccountIdAsset(
  ctx: { db: any },
  venueAccountId: Id<"venueAccounts">,
  asset: string,
) {
  return await ctx.db
    .query("walletAssetStates")
    .withIndex("by_venueAccountId_asset", (q: any) =>
      q.eq("venueAccountId", venueAccountId).eq("asset", asset.toUpperCase()),
    )
    .first();
}

export async function getRecentWalletTransferEvents(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
  limit: number,
) {
  return await ctx.db
    .query("walletTransferEvents")
    .withIndex("by_strategyAccountId_observedAt", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .take(limit);
}

export async function getWalletSecretByVenueAccountId(ctx: { db: any }, venueAccountId: Id<"venueAccounts">) {
  return await ctx.db
    .query("walletSecrets")
    .withIndex("by_venueAccountId", (q: any) => q.eq("venueAccountId", venueAccountId))
    .first();
}

export async function getExecutionLeaseByStrategyAccountId(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
) {
  return await ctx.db
    .query("executionLeases")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .first();
}

export async function getLatestBalanceSnapshot(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
) {
  return await ctx.db
    .query("balanceSnapshots")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .first();
}

export async function getOpenLpPositions(ctx: { db: any }, strategyAccountId: Id<"strategyAccounts">) {
  return await ctx.db
    .query("lpPositions")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .filter((q: any) => q.eq(q.field("status"), "open"))
    .collect();
}

export async function getOpenHedgePositions(ctx: { db: any }, strategyAccountId: Id<"strategyAccounts">) {
  return await ctx.db
    .query("hedgePositions")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .filter((q: any) => q.eq(q.field("status"), "open"))
    .collect();
}

export async function getRecentExecutions(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
  limit: number,
) {
  const rows = await ctx.db
    .query("executions")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .take(limit);
  return rows;
}

export async function getExecutionsSince(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
  since: number,
) {
  const rows = await ctx.db
    .query("executions")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .collect();
  return rows.filter((execution: any) => (execution.executedAt ?? execution.createdAt ?? 0) >= since);
}

export async function getOpenAlerts(ctx: { db: any }, strategyAccountId: Id<"strategyAccounts">, limit: number) {
  const rows = await ctx.db
    .query("strategyAlerts")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .take(limit);
  return rows.filter((alert: any) => alert.status !== "resolved");
}

export async function getRecentAuditEvents(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
  limit: number,
) {
  return await ctx.db
    .query("auditEvents")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .take(limit);
}

export async function getRecentVenueStates(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
  limit: number,
) {
  return await ctx.db
    .query("venueStates")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .take(limit);
}

export async function getRecentIncidentEvents(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
  limit: number,
) {
  const rows = await ctx.db
    .query("incidentEvents")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .take(limit);
  return rows;
}

export async function getRecentReconciliationDeltas(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
  limit: number,
) {
  return await ctx.db
    .query("reconciliationDeltas")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .take(limit);
}

export async function getWithdrawalsByStrategyAccountId(
  ctx: { db: any },
  strategyAccountId: Id<"strategyAccounts">,
  limit: number,
) {
  return await ctx.db
    .query("withdrawals")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId))
    .order("desc")
    .take(limit);
}

export async function requireViewerStrategy(ctx: { db: any }, authSubject: string) {
  const user = await getUserByAuthSubject(ctx, authSubject);
  if (!user) {
    return { user: null, strategyAccount: null };
  }

  const strategyAccount = await getStrategyAccountByUserId(ctx, user._id);
  return { user, strategyAccount };
}
