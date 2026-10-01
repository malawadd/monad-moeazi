import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const sha = /^[0-9a-f]{64}$/;
const hex32 = /^0x[0-9a-f]{64}$/;
const uint = /^(?:0|[1-9][0-9]*)$/;
const positive = /^[1-9][0-9]*$/;
const address = /^0x[0-9a-f]{40}$/;

/** Finance's finalized reduce-only sell proof is the sole writer of confirmed flat. */
export const recordConfirmedFlat = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"), assignmentId: v.id("programAssignments"),
    programVersionId: v.id("tradingProgramVersions"), ownerAddress: v.string(),
    grantId: v.string(), financeSnapshotHash: v.string(), financeRevision: v.string(),
    confirmedBlockNumber: v.string(), confirmedBlockHash: v.string(),
    wethUnits: v.string(), pendingAttemptCount: v.number(),
    exitAttemptId: v.string(), exitReservationId: v.string(), exitIntentId: v.string(),
    actualWethInputUnits: v.string(), actualUsdcOutputUnits: v.string(),
    exitTransactionHash: v.string(), journalTransactionId: v.string(),
  },
  handler: async (ctx, args) => {
    if (!address.test(args.ownerAddress) || !args.grantId
        || !sha.test(args.financeSnapshotHash) || !uint.test(args.financeRevision)
        || !positive.test(args.confirmedBlockNumber) || !hex32.test(args.confirmedBlockHash)
        || args.wethUnits !== "0" || args.pendingAttemptCount !== 0
        || !sha.test(args.exitAttemptId) || !sha.test(args.exitReservationId)
        || !sha.test(args.exitIntentId) || !positive.test(args.actualWethInputUnits)
        || !positive.test(args.actualUsdcOutputUnits)
        || !hex32.test(args.exitTransactionHash) || !sha.test(args.journalTransactionId)) {
      throw new Error("Native flat-position finance proof is malformed.");
    }
    const priorTx = await ctx.db.query("managedUniswapCloseReceipts")
      .withIndex("by_exitTransactionHash", (q) => q.eq("exitTransactionHash", args.exitTransactionHash)).first();
    if (priorTx) {
      for (const key of Object.keys(args) as Array<keyof typeof args>) {
        if (priorTx[key] !== args[key]) throw new Error("Native close conflicts with prior proof.");
      }
      const assignment = await ctx.db.get(args.assignmentId);
      return { receiptId: String(priorTx._id), duplicate: true,
        closureConfirmed: assignment?.positionClosureState === "confirmed_flat" };
    }
    const account = await ctx.db.get(args.strategyAccountId);
    if (!account) throw new Error("Managed strategy account is unavailable.");
    const [assignment, version, authorities, proposals, wallets] = await Promise.all([
      ctx.db.get(args.assignmentId),
      ctx.db.get(args.programVersionId),
      ctx.db.query("managedProgramActivationAuthorities")
        .withIndex("by_assignmentId", (q) => q.eq("assignmentId", args.assignmentId)).collect(),
      ctx.db.query("tradeProposals")
        .withIndex("by_programAssignmentId", (q) => q.eq("programAssignmentId", args.assignmentId)).collect(),
      ctx.db.query("accountWallets").withIndex("by_userId", (q) =>
        q.eq("userId", account.userId)).collect(),
    ]);
    if (!assignment || !version || account.userId !== assignment.userId
        || assignment.strategyAccountId !== account._id
        || assignment.programVersionId !== version._id
        || assignment.source !== "explicit" || assignment.controllerMode !== "autopilot"
        || assignment.status !== "paused" || assignment.shadowCadenceEnabled === true
        || wallets.filter((wallet) => wallet.ownerAddress.toLowerCase() === args.ownerAddress
          && (!wallet.strategyAccountId || wallet.strategyAccountId === account._id)).length !== 1
        || authorities.some((receipt) => receipt.state === "ready")
        || !authorities.some((receipt) => receipt.source === "native_finance_authority"
          && receipt.venue === "uniswap" && receipt.state === "revoked"
          && receipt.strategyAccountId === args.strategyAccountId
          && receipt.programVersionId === args.programVersionId
          && receipt.ownerAddress === args.ownerAddress
          && receipt.executionGrantId === args.grantId)
        || proposals.some((proposal) => proposal.status === "executing")) {
      throw new Error("Managed assignment is not stopped, owned, and settled for a flat projection.");
    }
    const prior = await ctx.db.query("managedUniswapCloseReceipts")
      .withIndex("by_assignmentId", (q) => q.eq("assignmentId", args.assignmentId)).collect();
    if (prior.some((receipt) => receipt.grantId === args.grantId)) {
      throw new Error("Managed exit grant already has a different close proof.");
    }
    const now = Date.now();
    const receiptId = await ctx.db.insert("managedUniswapCloseReceipts", {
      ...args, source: "native_finance_close", createdAt: now,
    });
    await ctx.db.patch(assignment._id, { positionClosureState: "confirmed_flat",
      positionClosureUpdatedAt: now, updatedAt: now });
    return { receiptId: String(receiptId), duplicate: false, closureConfirmed: true };
  },
});

/** A finalized zero-WETH read also closes an abstaining or manually flattened account. */
export const recordObservedFlat = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"), assignmentId: v.id("programAssignments"),
    programVersionId: v.id("tradingProgramVersions"), ownerAddress: v.string(),
    financeSnapshotHash: v.string(), financeRevision: v.string(),
    finalizedBlockNumber: v.string(), finalizedBlockHash: v.string(),
    wethUnits: v.string(), pendingAttemptCount: v.number(),
  },
  handler: async (ctx, args) => {
    if (!address.test(args.ownerAddress) || !sha.test(args.financeSnapshotHash)
        || !uint.test(args.financeRevision) || !positive.test(args.finalizedBlockNumber)
        || !hex32.test(args.finalizedBlockHash) || args.wethUnits !== "0"
        || args.pendingAttemptCount !== 0) {
      throw new Error("Observed flat account proof is malformed.");
    }
    const prior = await ctx.db.query("managedUniswapFlatObservations")
      .withIndex("by_financeSnapshotHash", (q) => q.eq("financeSnapshotHash", args.financeSnapshotHash)).first();
    if (prior) {
      for (const key of Object.keys(args) as Array<keyof typeof args>) {
        if (prior[key] !== args[key]) throw new Error("Observed flat proof conflicts with prior account.");
      }
      const assignment = await ctx.db.get(args.assignmentId);
      return { receiptId: String(prior._id), duplicate: true,
        closureConfirmed: assignment?.positionClosureState === "confirmed_flat" };
    }
    const account = await ctx.db.get(args.strategyAccountId);
    if (!account) throw new Error("Managed strategy account is unavailable.");
    const [assignment, version, authorities, proposals, wallets] = await Promise.all([
      ctx.db.get(args.assignmentId), ctx.db.get(args.programVersionId),
      ctx.db.query("managedProgramActivationAuthorities")
        .withIndex("by_assignmentId", (q) => q.eq("assignmentId", args.assignmentId)).collect(),
      ctx.db.query("tradeProposals")
        .withIndex("by_programAssignmentId", (q) => q.eq("programAssignmentId", args.assignmentId)).collect(),
      ctx.db.query("accountWallets").withIndex("by_userId", (q) => q.eq("userId", account.userId)).collect(),
    ]);
    if (!assignment || !version || assignment.strategyAccountId !== account._id
        || assignment.userId !== account.userId || assignment.programVersionId !== version._id
        || assignment.source !== "explicit" || assignment.controllerMode !== "autopilot"
        || assignment.status !== "paused" || assignment.shadowCadenceEnabled === true
        || wallets.filter((wallet) => wallet.ownerAddress.toLowerCase() === args.ownerAddress
          && (!wallet.strategyAccountId || wallet.strategyAccountId === account._id)).length !== 1
        || authorities.some((receipt) => receipt.state === "ready")
        || !authorities.some((receipt) => receipt.source === "native_finance_authority"
          && receipt.state === "revoked" && receipt.venue === "uniswap"
          && receipt.ownerAddress === args.ownerAddress
          && receipt.programVersionId === args.programVersionId)
        || proposals.some((proposal) => proposal.status === "executing")) {
      throw new Error("Observed flat account is not a stopped and settled managed assignment.");
    }
    const now = Date.now();
    const receiptId = await ctx.db.insert("managedUniswapFlatObservations", {
      ...args, source: "native_finance_observed_flat", createdAt: now,
    });
    await ctx.db.patch(assignment._id, { positionClosureState: "confirmed_flat",
      positionClosureUpdatedAt: now, updatedAt: now });
    return { receiptId: String(receiptId), duplicate: false, closureConfirmed: true };
  },
});
