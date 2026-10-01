import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const HASH = /^0x[a-f0-9]{64}$/;
const OPERATION = /^[A-Za-z0-9._:-]{12,128}$/;

export const prepare = internalMutation({
  args: { mandateId: v.id("managedSpotMandates"), ownerAddress: v.string(),
    operationId: v.string(), rootHash: v.string(), transactionJson: v.string(),
    expiresAt: v.number() },
  handler: async (ctx, args) => {
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || mandate.status !== "vault_ready" || !mandate.vaultAddress
      || !mandate.vaultCodeHash || mandate.ownerAddress !== args.ownerAddress
      || !OPERATION.test(args.operationId) || !HASH.test(args.rootHash)
      || args.transactionJson.length > 90_000
      || !Number.isSafeInteger(args.expiresAt)
      || args.expiresAt <= Date.now() + 5_000
      || args.expiresAt > Math.min(mandate.expiresAt, Date.now() + 5 * 60_000)) {
      throw new Error("Funding preparation differs from the ready owned mandate.");
    }
    const rows = await ctx.db.query("managedSpotFundingOperations")
      .withIndex("by_mandateId", (q) => q.eq("mandateId", mandate._id)).collect();
    const current = rows.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (current && (current.expiresAt > Date.now() || current.status !== "prepared")) {
      return { operationId: current.operationId, rootHash: current.rootHash,
        transactionJson: current.transactionJson, expiresAt: current.expiresAt,
        status: current.status };
    }
    const now = Date.now();
    await ctx.db.insert("managedSpotFundingOperations", { ...args, userId: mandate.userId,
      status: "prepared", createdAt: now, updatedAt: now });
    return { operationId: args.operationId, rootHash: args.rootHash,
      transactionJson: args.transactionJson, expiresAt: args.expiresAt,
      status: "prepared" as const };
  },
});

export const read = internalQuery({ args: { operationId: v.string() }, handler: async (ctx, args) => {
  const row = await ctx.db.query("managedSpotFundingOperations")
    .withIndex("by_operationId", (q) => q.eq("operationId", args.operationId)).first();
  if (!row) return null;
  const mandate = await ctx.db.get(row.mandateId);
  if (!mandate || mandate.userId !== row.userId || mandate.ownerAddress !== row.ownerAddress) return null;
  return { operationId: row.operationId, ownerAddress: row.ownerAddress,
    mandateId: row.mandateId, status: row.status, rootHash: row.rootHash,
    transactionJson: row.transactionJson, expiresAt: row.expiresAt,
    particleTransactionId: row.particleTransactionId ?? null,
    vaultAddress: mandate.vaultAddress, executorAddress: mandate.executorAddress,
    vaultCodeHash: mandate.vaultCodeHash,
    programHash: mandate.programHash, policyHash: mandate.policyHash,
    capitalUnits: mandate.capitalUnits, maxBuyUnits: mandate.maxBuyUnits,
    mandateExpiresAt: mandate.expiresAt };
} });

export const claim = internalMutation({
  args: { operationId: v.string(), ownerAddress: v.string(), rootHash: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("managedSpotFundingOperations")
      .withIndex("by_operationId", (q) => q.eq("operationId", args.operationId)).first();
    if (!row || row.ownerAddress !== args.ownerAddress || row.rootHash !== args.rootHash
      || row.expiresAt <= Date.now()) throw new Error("Funding operation is unavailable or expired.");
    if (row.status !== "prepared") return { claimed: false, status: row.status };
    const mandate = await ctx.db.get(row.mandateId);
    if (!mandate || mandate.status !== "vault_ready") throw new Error("Mandate is no longer ready for funding.");
    await ctx.db.patch(row._id, { status: "submitting", updatedAt: Date.now() });
    return { claimed: true, status: "submitting" as const };
  },
});

export const outcome = internalMutation({
  args: { operationId: v.string(), status: v.union(v.literal("submitted"), v.literal("uncertain")),
    particleTransactionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("managedSpotFundingOperations")
      .withIndex("by_operationId", (q) => q.eq("operationId", args.operationId)).first();
    if (!row) throw new Error("Funding operation does not exist.");
    if (row.status === args.status && row.particleTransactionId === args.particleTransactionId) {
      return { status: row.status, duplicate: true };
    }
    if (row.status !== "submitting") throw new Error("Funding outcome cannot overwrite a prior decision.");
    await ctx.db.patch(row._id, { status: args.status,
      particleTransactionId: args.particleTransactionId, updatedAt: Date.now() });
    return { status: args.status, duplicate: false };
  },
});

export const confirm = internalMutation({
  args: { operationId: v.string(), ownerAddress: v.string(), finalizedBlockHash: v.string(),
    vaultAddress: v.string(), vaultUsdcUnits: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("managedSpotFundingOperations")
      .withIndex("by_operationId", (q) => q.eq("operationId", args.operationId)).first();
    if (!row || row.ownerAddress !== args.ownerAddress || !HASH.test(args.finalizedBlockHash)) {
      throw new Error("Funding confirmation has no owned finalized operation.");
    }
    const mandate = await ctx.db.get(row.mandateId);
    if (!mandate || mandate.ownerAddress !== args.ownerAddress
      || mandate.vaultAddress !== args.vaultAddress
      || !mandate.venueAccountId
      || BigInt(args.vaultUsdcUnits) < BigInt(mandate.capitalUnits)) {
      throw new Error("Funded vault does not match the selected mandate capital.");
    }
    if (row.status === "confirmed" && mandate.status === "active") return { confirmed: true, duplicate: true };
    if (!["submitting", "submitted", "uncertain"].includes(row.status)
      || mandate.status !== "vault_ready") throw new Error("Funding confirmation is out of sequence.");
    const venueAccount = await ctx.db.get(mandate.venueAccountId);
    if (!venueAccount || venueAccount.strategyAccountId !== mandate.strategyAccountId
      || venueAccount.role !== "arbitrum_managed_vault"
      || venueAccount.walletAddress !== mandate.vaultAddress
      || venueAccount.ownerAddress !== mandate.ownerAddress
      || venueAccount.status !== "provisioning") {
      throw new Error("The owned vault venue account is unavailable.");
    }
    const integrations = await ctx.db.query("venueIntegrations")
      .withIndex("by_strategyAccountId_venue", (q) =>
        q.eq("strategyAccountId", mandate.strategyAccountId).eq("venue", "uniswap")).collect();
    const permissions = await ctx.db.query("venuePermissions")
      .withIndex("by_strategyAccountId_venue", (q) =>
        q.eq("strategyAccountId", mandate.strategyAccountId).eq("venue", "uniswap")).collect();
    if (integrations.length > 1 || permissions.some((permission) => {
      try { return JSON.parse(permission.limitsJson)?.source === "managed_spot_vault_v1"
        && permission.status === "active"; }
      catch { return false; }
    })) {
      throw new Error("Ambiguous or existing active vault authority must be resolved.");
    }
    const now = Date.now();
    await ctx.db.patch(venueAccount._id, { status: "ready", lastSyncStatus: "fresh",
      lastSyncedAt: now, updatedAt: now });
    const integration = { strategyAccountId: mandate.strategyAccountId,
      venue: "uniswap", enabled: true, routingEnabled: true,
      authorityMode: "autopilot", status: "ready", lastHealthAt: now,
      lastHealthMessage: "Funded managed vault verified at finalized Arbitrum block",
      createdAt: integrations[0]?.createdAt ?? now, updatedAt: now } as const;
    if (integrations[0]) await ctx.db.patch(integrations[0]._id, integration);
    else await ctx.db.insert("venueIntegrations", integration);
    await ctx.db.insert("venuePermissions", { strategyAccountId: mandate.strategyAccountId,
      venue: "uniswap", ownerAddress: mandate.ownerAddress,
      delegatePublicKey: mandate.executorAddress, authorityMode: "autopilot", chainId: 42161,
      limitsJson: JSON.stringify({ source: "managed_spot_vault_v1",
        vaultAddress: mandate.vaultAddress, capitalUnits: mandate.capitalUnits,
        maxBuyUnits: mandate.maxBuyUnits, mandateId: String(mandate._id) }),
      status: "active", expiresAt: mandate.expiresAt,
      transactionId: row.particleTransactionId, createdAt: now, updatedAt: now });
    await ctx.db.patch(row._id, { status: "confirmed", updatedAt: now });
    await ctx.db.patch(mandate._id, { status: "active", finalizedBlockHash: args.finalizedBlockHash,
      fundingOperationId: row.operationId, updatedAt: now });
    return { confirmed: true, duplicate: false };
  },
});
