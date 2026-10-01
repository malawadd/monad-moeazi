import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { operatorOwnedProgramSource, verifyFrozenProgramVersion } from "./mobile";

const address = /^0x[a-f0-9]{40}$/;
const hash = /^0x[a-f0-9]{64}$/;
const sha = /^[a-f0-9]{64}$/;
const positive = /^[1-9][0-9]*$/;

/** Identity only. Native vault, transfer, journal and account facts are checked elsewhere. */
export const context = internalQuery({
  args: { mandateId: v.id("managedSpotMandates"), subject: v.string() },
  handler: async (ctx, args) => {
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || !["stopped", "closed"].includes(mandate.status)
      || mandate.stopState !== "confirmed" || !mandate.stopFinalizedBlockNumber
      || !mandate.vaultAddress || !mandate.vaultCodeHash || !mandate.executorAddress
      || !mandate.fundingOperationId || !mandate.venueAccountId) return null;
    const [user, account, assignment, version, venue, funding] = await Promise.all([
      ctx.db.get(mandate.userId), ctx.db.get(mandate.strategyAccountId),
      ctx.db.get(mandate.assignmentId), ctx.db.get(mandate.programVersionId),
      ctx.db.get(mandate.venueAccountId),
      ctx.db.query("managedSpotFundingOperations").withIndex("by_operationId",
        (q) => q.eq("operationId", mandate.fundingOperationId!)).first(),
    ]);
    if (!user || user.authSubject !== args.subject || !account || !assignment
      || !version || !venue || !funding || funding.status !== "confirmed"
      || account.userId !== user._id || assignment.userId !== user._id
      || assignment.strategyAccountId !== account._id
      || assignment.programVersionId !== version._id
      || assignment.source !== "explicit" || assignment.controllerMode !== "autopilot"
      || assignment.status !== "paused" || assignment.positionClosureState !== "confirmed_flat"
      || assignment.shadowCadenceEnabled === true
      || venue.strategyAccountId !== account._id || venue.role !== "arbitrum_managed_vault"
      || venue.accountRef !== `arbitrum:42161:vault:${mandate.vaultAddress}`
      || venue.ownerAddress !== mandate.ownerAddress
      || mandate.programHash !== version.contentHash || mandate.policyHash !== version.policyHash
      || !await operatorOwnedProgramSource(ctx, version)
      || !await verifyFrozenProgramVersion(version)) return null;
    const wallets = await ctx.db.query("accountWallets")
      .withIndex("by_userId", (q) => q.eq("userId", user._id)).collect();
    if (!address.test(mandate.ownerAddress)
      || wallets.filter((wallet) => wallet.walletProvider === "magic"
        && wallet.ownerVerifiedAt && wallet.accountMode === "eip7702"
        && wallet.ownerAddress.toLowerCase() === mandate.ownerAddress).length !== 1) return null;
    return { mandateId: String(mandate._id), strategyAccountId: String(account._id),
      assignmentId: String(assignment._id), customerSubject: user.authSubject,
      programVersionId: String(version._id), ownerAddress: mandate.ownerAddress,
      vaultAddress: mandate.vaultAddress, executorAddress: mandate.executorAddress,
      codeHash: mandate.vaultCodeHash, programHash: mandate.programHash,
      policyHash: mandate.policyHash, capitalUnits: mandate.capitalUnits,
      maxBuyUnits: mandate.maxBuyUnits, expiresAt: mandate.expiresAt,
      fromBlock: mandate.stopFinalizedBlockNumber,
      closed: mandate.status === "closed",
      releaseTransactionHash: mandate.releaseTransactionHash ?? null };
  },
});

/** Only a reconciled native withdrawal proof closes the managed mandate. */
export const confirm = internalMutation({
  args: { mandateId: v.id("managedSpotMandates"), ownerAddress: v.string(),
    transactionHash: v.string(), amountUnits: v.string(),
    finalizedBlockNumber: v.string(), finalizedBlockHash: v.string(),
    financeSnapshotHash: v.string(), journalTransactionId: v.string() },
  handler: async (ctx, args) => {
    if (!address.test(args.ownerAddress) || !hash.test(args.transactionHash)
      || !positive.test(args.amountUnits) || !positive.test(args.finalizedBlockNumber)
      || !hash.test(args.finalizedBlockHash) || !sha.test(args.financeSnapshotHash)
      || !sha.test(args.journalTransactionId)) {
      throw new Error("Finalized Magic vault return proof is malformed");
    }
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || mandate.ownerAddress !== args.ownerAddress
      || mandate.stopState !== "confirmed" || !mandate.vaultAddress) {
      throw new Error("Magic vault return has no stopped owned mandate");
    }
    const assignment = await ctx.db.get(mandate.assignmentId);
    if (!assignment || assignment.status !== "paused"
      || assignment.positionClosureState !== "confirmed_flat") {
      throw new Error("Managed position is not confirmed flat");
    }
    const fields = { releaseTransactionHash: args.transactionHash,
      releaseAmountUnits: args.amountUnits,
      releaseFinalizedBlockNumber: args.finalizedBlockNumber,
      releaseFinalizedBlockHash: args.finalizedBlockHash,
      releaseFinanceSnapshotHash: args.financeSnapshotHash,
      releaseJournalTransactionId: args.journalTransactionId };
    if (mandate.status === "closed") {
      if (Object.entries(fields).some(([key, value]) =>
        mandate[key as keyof typeof fields] !== value)) {
        throw new Error("Managed vault return conflicts with prior closure");
      }
      return { status: "closed" as const, duplicate: true };
    }
    if (mandate.status !== "stopped") throw new Error("Magic vault is not stopped");
    await ctx.db.patch(mandate._id, { ...fields, status: "closed", updatedAt: Date.now() });
    return { status: "closed" as const, duplicate: false };
  },
});
