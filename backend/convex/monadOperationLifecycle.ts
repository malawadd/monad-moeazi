import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendMonadActivity, findMonadOperation, MONAD_CHAIN_ID, requireMonadOperator,
  requireServiceOperation, requireStoredMeraOwner, safeOperation } from "./monadHelpers";

export const getServiceOperation = query({
  args: { operationId: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await findMonadOperation(ctx, args.operationId);
    return row ? { ...safeOperation(row), signedTransaction: row.signedTransaction ?? null } : null;
  },
});

export const authorizeOperation = mutation({
  args: { operationId: v.string(), ownerAddress: v.string(), signedTransactionHash: v.string(), signedTransaction: v.string() },
  handler: async (ctx, args) => {
    const row = await findMonadOperation(ctx, args.operationId);
    if (!row) throw new Error("Monad operation was not found.");
    await requireServiceOperation(ctx, row, args.ownerAddress);
    if (!/^0x[a-f0-9]{64}$/.test(args.signedTransactionHash) || args.signedTransaction.length > 300_000) {
      throw new Error("Signed transaction is invalid.");
    }
    if (row.status === "authorized" && row.signedTransactionHash === args.signedTransactionHash) return safeOperation(row);
    if (row.status !== "prepared" || row.expiresAt <= Date.now()) throw new Error("Monad operation is no longer available for signing.");
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "authorized", signedTransactionHash: args.signedTransactionHash,
      signedTransaction: args.signedTransaction, txHash: args.signedTransactionHash, updatedAt: now });
    await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: row.ownerAddress,
      activityId: `operation:${row.operationId}:authorized`, operationId: row.operationId,
      mandateId: row.mandateId, txHash: args.signedTransactionHash, kind: row.kind,
      status: "authorized", summary: "Signed Monad transaction verified", dataJson: JSON.stringify({ actor: row.initiator }) });
    return safeOperation({ ...row, status: "authorized", signedTransactionHash: args.signedTransactionHash,
      txHash: args.signedTransactionHash, updatedAt: now });
  },
});

export const claimBroadcast = mutation({
  args: { operationId: v.string(), ownerAddress: v.string(), signedTransactionHash: v.string() },
  handler: async (ctx, args) => {
    const row = await findMonadOperation(ctx, args.operationId);
    if (!row) throw new Error("Monad operation was not found.");
    await requireServiceOperation(ctx, row, args.ownerAddress);
    if (row.signedTransactionHash !== args.signedTransactionHash) throw new Error("Broadcast differs from the verified transaction.");
    if (["broadcasting", "submitted", "executed", "uncertain", "finalized", "failed"].includes(row.status)) return safeOperation(row);
    if (row.status !== "authorized" || row.expiresAt <= Date.now()) throw new Error("Monad operation is not available for broadcast.");
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "broadcasting", updatedAt: now });
    return safeOperation({ ...row, status: "broadcasting", updatedAt: now });
  },
});

export const recordBroadcast = mutation({
  args: { operationId: v.string(), ownerAddress: v.string(), txHash: v.string() },
  handler: async (ctx, args) => {
    const row = await findMonadOperation(ctx, args.operationId);
    if (!row) throw new Error("Monad operation was not found.");
    await requireServiceOperation(ctx, row, args.ownerAddress);
    if (row.txHash !== args.txHash || row.signedTransactionHash !== args.txHash) throw new Error("Broadcast hash does not match the signed payload.");
    if (["submitted", "executed", "uncertain", "finalized", "failed"].includes(row.status)) return safeOperation(row);
    if (row.status !== "broadcasting") throw new Error("Monad operation is not broadcasting.");
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "submitted", updatedAt: now });
    await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: row.ownerAddress,
      activityId: `operation:${row.operationId}:submitted`, operationId: row.operationId,
      mandateId: row.mandateId, txHash: args.txHash, kind: row.kind, status: "submitted",
      summary: "Monad transaction submitted to the testnet RPC" });
    return safeOperation({ ...row, status: "submitted", updatedAt: now });
  },
});

export const reconcileReceipt = mutation({
  args: { operationId: v.string(), ownerAddress: v.string(), txHash: v.string(), receiptStatus: v.number(),
    blockNumber: v.number(), blockHash: v.string(), canonicalBlockHash: v.string(),
    finalizedBlockNumber: v.optional(v.number()), confirmations: v.number(), finalityBlocks: v.number() },
  handler: async (ctx, args) => {
    const row = await findMonadOperation(ctx, args.operationId);
    if (!row) throw new Error("Monad operation was not found.");
    await requireServiceOperation(ctx, row, args.ownerAddress);
    if (row.txHash !== args.txHash || ![0, 1].includes(args.receiptStatus)
        || args.confirmations < 0 || args.finalityBlocks < 1
        || args.canonicalBlockHash.toLowerCase() !== args.blockHash.toLowerCase()) {
      throw new Error("Monad receipt does not match the canonical chain.");
    }
    const final = args.finalizedBlockNumber !== undefined && args.finalizedBlockNumber >= args.blockNumber;
    const status = final ? (args.receiptStatus === 1 ? "finalized" : "failed") : "executed";
    const changed = row.status !== status || row.blockHash !== args.blockHash;
    const now = Date.now();
    await ctx.db.patch(row._id, { status, nonceReserved: !final, receiptStatus: args.receiptStatus,
      blockNumber: args.blockNumber, blockHash: args.blockHash, confirmations: args.confirmations,
      finalizedBlockNumber: final ? args.finalizedBlockNumber : undefined,
      finalityMode: final ? "monad_finalized_block" : undefined, updatedAt: now });
    if (changed) await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: row.ownerAddress,
      activityId: `operation:${row.operationId}:${status}:${args.blockHash}`, operationId: row.operationId,
      mandateId: row.mandateId, txHash: args.txHash, kind: row.kind, status,
      summary: status === "finalized" ? "Monad transaction is included in the finalized checkpoint"
        : status === "failed" ? "Monad transaction reverted on chain" : "Monad transaction receipt observed",
      dataJson: JSON.stringify({ ...JSON.parse(row.intentJson), receiptStatus: args.receiptStatus,
        blockNumber: args.blockNumber, confirmations: args.confirmations,
        finalizedBlockNumber: args.finalizedBlockNumber, finalityMode: final ? "monad_finalized_block" : undefined }) });
    return safeOperation({ ...row, status, receiptStatus: args.receiptStatus,
      blockNumber: args.blockNumber, blockHash: args.blockHash, confirmations: args.confirmations,
      finalizedBlockNumber: final ? args.finalizedBlockNumber : undefined,
      finalityMode: final ? "monad_finalized_block" : undefined, updatedAt: now });
  },
});

export const completeVaultOperation = mutation({
  args: { operationId: v.string(), ownerAddress: v.string(), mandateId: v.optional(v.string()),
    onchainActive: v.boolean(), vaultStopped: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const { user, owner } = await requireStoredMeraOwner(ctx, `mera:${args.ownerAddress.toLowerCase()}`, args.ownerAddress);
    const operation = await ctx.db.query("monadOperations")
      .withIndex("by_userId_operationId", (q: any) => q.eq("userId", user._id).eq("operationId", args.operationId)).first();
    if (!operation || operation.ownerAddress !== owner || operation.status !== "finalized"
        || !["mandate_authorize", "mandate_revoke", "vault_stop", "vault_resume"].includes(operation.kind)) {
      throw new Error("Finalized Monad vault operation was not found.");
    }
    const now = Date.now();
    if (operation.kind === "mandate_authorize") {
      const id = args.mandateId ?? operation.mandateId;
      const mandate = id ? await ctx.db.query("monadMandates")
        .withIndex("by_userId_mandateId", (q: any) => q.eq("userId", user._id).eq("mandateId", id)).first() : null;
      if (!mandate || mandate.status !== "signed" || !args.onchainActive) throw new Error("Signed mandate is not active on chain.");
      await ctx.db.patch(mandate._id, { status: "active", updatedAt: now });
      const vault = await ctx.db.query("monadVaults")
        .withIndex("by_userId_mandateId", (q: any) => q.eq("userId", user._id).eq("mandateId", id)).first();
      if (vault) await ctx.db.patch(vault._id, { status: "active", updatedAt: now });
    } else if (operation.kind === "mandate_revoke") {
      const id = args.mandateId ?? operation.mandateId;
      const mandate = id ? await ctx.db.query("monadMandates")
        .withIndex("by_userId_mandateId", (q: any) => q.eq("userId", user._id).eq("mandateId", id)).first() : null;
      if (!mandate || args.onchainActive) throw new Error("Monad mandate revocation is not confirmed on chain.");
      await ctx.db.patch(mandate._id, { status: "revoked", updatedAt: now });
    } else if (operation.kind === "vault_stop") {
      if (args.vaultStopped !== true || args.onchainActive) throw new Error("Monad vault stop is not confirmed on chain.");
      const vaults = await ctx.db.query("monadVaults")
        .withIndex("by_userId_vaultAddress", (q: any) => q.eq("userId", user._id)).collect();
      for (const vault of vaults) if (vault.ownerAddress === owner) await ctx.db.patch(vault._id, { status: "stopped", updatedAt: now });
      const mandates = await ctx.db.query("monadMandates")
        .withIndex("by_userId_mandateId", (q: any) => q.eq("userId", user._id)).collect();
      for (const mandate of mandates) if (mandate.ownerAddress === owner && mandate.status === "active") {
        await ctx.db.patch(mandate._id, { status: "revoked", updatedAt: now });
      }
    } else {
      if (args.vaultStopped !== false || args.onchainActive) throw new Error("Monad vault resume is not confirmed on chain.");
      const vaults = await ctx.db.query("monadVaults")
        .withIndex("by_userId_vaultAddress", (q: any) => q.eq("userId", user._id)).collect();
      for (const vault of vaults) if (vault.ownerAddress === owner) await ctx.db.patch(vault._id, { status: "pending", updatedAt: now });
    }
    return { operationId: operation.operationId, status: "reconciled" as const };
  },
});

export const markUncertain = mutation({
  args: { operationId: v.string(), ownerAddress: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await findMonadOperation(ctx, args.operationId);
    if (!row) throw new Error("Monad operation was not found.");
    await requireServiceOperation(ctx, row, args.ownerAddress);
    if (!row.signedTransactionHash || !["authorized", "broadcasting", "submitted", "uncertain"].includes(row.status)) {
      throw new Error("Only a signed Monad operation can be marked uncertain.");
    }
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "uncertain", nonceReserved: true, errorCode: args.reason.slice(0, 80), updatedAt: now });
    await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: row.ownerAddress,
      activityId: `operation:${row.operationId}:uncertain`, operationId: row.operationId,
      mandateId: row.mandateId, txHash: row.txHash, kind: row.kind, status: "uncertain",
      summary: "Monad submission is uncertain; retry the same signed transaction" });
    return safeOperation({ ...row, status: "uncertain", nonceReserved: true, updatedAt: now });
  },
});

export const expireOperation = mutation({
  args: { operationId: v.string(), ownerAddress: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const { user, owner } = await requireStoredMeraOwner(ctx, `mera:${args.ownerAddress.toLowerCase()}`, args.ownerAddress);
    const row = await ctx.db.query("monadOperations")
      .withIndex("by_userId_operationId", (q: any) => q.eq("userId", user._id).eq("operationId", args.operationId)).first();
    if (!row || row.ownerAddress !== owner || row.expiresAt > Date.now() || row.status !== "prepared") return null;
    await ctx.db.patch(row._id, { status: "expired", nonceReserved: false, updatedAt: Date.now() });
    await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: owner,
      activityId: `operation:${row.operationId}:expired`, operationId: row.operationId,
      mandateId: row.mandateId, kind: row.kind, status: "expired", summary: "Monad operation expired before broadcast" });
    return { operationId: row.operationId, status: "expired" as const };
  },
});
