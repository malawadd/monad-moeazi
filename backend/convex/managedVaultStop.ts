import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { operatorOwnedProgramSource, verifyFrozenProgramVersion } from "./mobile";

const address = /^0x[a-f0-9]{40}$/;
const transactionHash = /^0x[a-f0-9]{64}$/;

/** The stopped assignment's exact Magic-owned vault; expiry does not remove exit authority. */
export const context = internalQuery({
  args: { mandateId: v.id("managedSpotMandates"), subject: v.string() },
  handler: async (ctx, args) => {
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || !["active", "stopped"].includes(mandate.status)
      || !mandate.vaultAddress || !mandate.vaultCodeHash
      || !mandate.executorAddress || !mandate.fundingOperationId) return null;
    const [user, account, assignment, version, funding, venue] = await Promise.all([
      ctx.db.get(mandate.userId), ctx.db.get(mandate.strategyAccountId),
      ctx.db.get(mandate.assignmentId), ctx.db.get(mandate.programVersionId),
      ctx.db.query("managedSpotFundingOperations").withIndex("by_operationId", (q) =>
        q.eq("operationId", mandate.fundingOperationId!)).first(),
      mandate.venueAccountId ? ctx.db.get(mandate.venueAccountId) : null,
    ]);
    if (!user || user.authSubject !== args.subject || !account || !assignment
      || !version || !funding || !venue || account.userId !== user._id
      || assignment.userId !== user._id || assignment.strategyAccountId !== account._id
      || assignment.programVersionId !== version._id || assignment.source !== "explicit"
      || assignment.controllerMode !== "autopilot" || assignment.status !== "paused"
      || assignment.shadowCadenceEnabled || funding.mandateId !== mandate._id
      || funding.status !== "confirmed" || venue.strategyAccountId !== account._id
      || venue.role !== "arbitrum_managed_vault"
      || venue.accountRef !== `arbitrum:42161:vault:${mandate.vaultAddress}`
      || venue.ownerAddress !== mandate.ownerAddress
      || mandate.programHash !== version.contentHash
      || mandate.policyHash !== version.policyHash
      || !await operatorOwnedProgramSource(ctx, version)
      || !await verifyFrozenProgramVersion(version)) return null;
    const wallets = await ctx.db.query("accountWallets")
      .withIndex("by_userId", (q) => q.eq("userId", user._id)).collect();
    if (!address.test(mandate.ownerAddress)
      || wallets.filter((wallet) => wallet.walletProvider === "magic"
        && wallet.ownerVerifiedAt && wallet.accountMode === "eip7702"
        && String(wallet.ownerAddress).toLowerCase() === mandate.ownerAddress).length !== 1) return null;
    return { mandateId: String(mandate._id), assignmentId: String(assignment._id),
      strategyAccountId: String(account._id), customerSubject: user.authSubject,
      stopState: mandate.stopState ?? null,
      stopTransactionHash: mandate.stopTransactionHash ?? null,
      vaultAddress: mandate.vaultAddress, ownerAddress: mandate.ownerAddress,
      executorAddress: mandate.executorAddress, codeHash: mandate.vaultCodeHash,
      programHash: mandate.programHash, policyHash: mandate.policyHash,
      capitalUnits: mandate.capitalUnits, maxBuyUnits: mandate.maxBuyUnits,
      expiresAt: mandate.expiresAt };
  },
});

/** A single durable claim precedes the possible on-chain stop send. */
export const claim = internalMutation({
  args: { mandateId: v.id("managedSpotMandates") },
  handler: async (ctx, args) => {
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || !["active", "stopped"].includes(mandate.status)) {
      throw new Error("Funded Magic vault mandate is unavailable");
    }
    const assignment = await ctx.db.get(mandate.assignmentId);
    if (!assignment || assignment.status !== "paused" || assignment.shadowCadenceEnabled) {
      throw new Error("Stop the managed assignment before claiming vault stop");
    }
    if (mandate.stopState) return { claimed: false, state: mandate.stopState };
    await ctx.db.patch(mandate._id, { stopState: "claimed", updatedAt: Date.now() });
    return { claimed: true, state: "claimed" as const };
  },
});

export const outcome = internalMutation({
  args: { mandateId: v.id("managedSpotMandates"),
    state: v.union(v.literal("submitted"), v.literal("uncertain"), v.literal("confirmed")),
    transactionHash: v.optional(v.string()),
    finalizedBlockNumber: v.optional(v.string()),
    finalizedBlockHash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || !mandate.stopState || !["active", "stopped"].includes(mandate.status)
      || (args.transactionHash && !transactionHash.test(args.transactionHash))
      || (mandate.stopTransactionHash && args.transactionHash
        && mandate.stopTransactionHash !== args.transactionHash)) {
      throw new Error("Magic vault stop outcome differs from the claimed mandate");
    }
    if (mandate.stopState === "confirmed" && args.state !== "confirmed") {
      throw new Error("Finalized vault stop cannot regress");
    }
    if (args.state === "confirmed" && (!args.finalizedBlockNumber
      || !/^[1-9][0-9]*$/.test(args.finalizedBlockNumber)
      || !args.finalizedBlockHash || !transactionHash.test(args.finalizedBlockHash))) {
      throw new Error("Finalized vault stop requires exact block evidence");
    }
    const patch = { stopState: args.state,
      stopTransactionHash: args.transactionHash ?? mandate.stopTransactionHash,
      stopFinalizedBlockNumber: args.finalizedBlockNumber ?? mandate.stopFinalizedBlockNumber,
      stopFinalizedBlockHash: args.finalizedBlockHash ?? mandate.stopFinalizedBlockHash,
      status: args.state === "confirmed" ? "stopped" as const : mandate.status,
      updatedAt: Date.now() };
    await ctx.db.patch(mandate._id, patch);
    return { state: args.state, mandateStatus: patch.status };
  },
});
