import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const hex32 = /^0x[0-9a-f]{64}$/;
const sha = /^[0-9a-f]{64}$/;
const uint = /^(?:0|[1-9][0-9]*)$/;
const positive = /^[1-9][0-9]*$/;

/** A projection of an already-finalized native fill and reconciled finance journal. */
export const recordConfirmedUniswapBuy = internalMutation({
  args: {
    proposalId: v.id("tradeProposals"), strategyAccountId: v.id("strategyAccounts"),
    assignmentId: v.id("programAssignments"), programVersionId: v.id("tradingProgramVersions"),
    intentId: v.string(), attemptId: v.string(), reservationId: v.string(), grantId: v.string(),
    userOperationHash: v.string(), transactionHash: v.string(),
    confirmedBlockNumber: v.string(), confirmedBlockHash: v.string(),
    postFillSnapshotHash: v.string(), financeRevision: v.string(),
    journalTransactionId: v.string(), actualInputUnits: v.string(), actualOutputUnits: v.string(),
  },
  handler: async (ctx, args) => {
    if (!sha.test(args.attemptId) || !sha.test(args.reservationId)
        || !sha.test(args.postFillSnapshotHash) || !sha.test(args.journalTransactionId)
        || !hex32.test(args.userOperationHash) || !hex32.test(args.transactionHash)
        || !hex32.test(args.confirmedBlockHash) || !positive.test(args.confirmedBlockNumber)
        || !uint.test(args.financeRevision) || !positive.test(args.actualInputUnits)
        || !positive.test(args.actualOutputUnits) || !args.intentId || !args.grantId) {
      throw new Error("Native Uniswap finance proof is malformed.");
    }
    const prior = await ctx.db.query("managedUniswapTradeReceipts")
      .withIndex("by_proposalId", (q) => q.eq("proposalId", args.proposalId)).first();
    if (prior) {
      for (const key of ["attemptId", "reservationId", "transactionHash", "postFillSnapshotHash",
        "journalTransactionId", "actualInputUnits", "actualOutputUnits"] as const) {
        if (prior[key] !== args[key]) throw new Error("Confirmed native fill conflicts with prior proof.");
      }
      const execution = await ctx.db.query("executions")
        .withIndex("by_strategyAccountId_requestId", (q) => q.eq("strategyAccountId", args.strategyAccountId)
          .eq("requestId", args.intentId)).first();
      if (!execution || execution.status !== "filled" || execution.txHash !== args.transactionHash) {
        throw new Error("Confirmed native fill has no matching execution projection.");
      }
      return { receiptId: String(prior._id), executionId: String(execution._id), duplicate: true };
    }
    const existingTx = await ctx.db.query("managedUniswapTradeReceipts")
      .withIndex("by_transactionHash", (q) => q.eq("transactionHash", args.transactionHash)).first();
    if (existingTx) throw new Error("Transaction is already attributed to another proposal.");
    const [proposal, assignment, version] = await Promise.all([
      ctx.db.get(args.proposalId), ctx.db.get(args.assignmentId), ctx.db.get(args.programVersionId),
    ]);
    if (!proposal || !assignment || !version || proposal.status !== "executing"
        || proposal.strategyAccountId !== args.strategyAccountId
        || proposal.programAssignmentId !== args.assignmentId
        || proposal.programVersionId !== args.programVersionId
        || proposal.controllerMode !== "autopilot"
        || proposal.controllerRef?.controllerKind !== "managed_program"
        || proposal.controllerRef.controllerId !== String(args.assignmentId)
        || proposal.controllerRef.controllerVersionId !== String(args.programVersionId)
        || proposal.controllerRef.contentHash !== version.contentHash
        || assignment.strategyAccountId !== args.strategyAccountId
        || assignment.userId !== proposal.userId
        || assignment.programVersionId !== args.programVersionId) {
      throw new Error("Native fill does not match the managed proposal and account.");
    }
    let payload: any;
    try { payload = JSON.parse(proposal.payloadJson); }
    catch { throw new Error("Native proposal payload is malformed."); }
    if (payload.side !== "long" || payload.candidate_venues?.[0] !== "uniswap"
        || payload.order_type !== "market" || payload.leverage !== 1) {
      throw new Error("Native fill is outside the approved Uniswap buy route.");
    }
    const now = Date.now();
    const receiptId = await ctx.db.insert("managedUniswapTradeReceipts", { ...args, createdAt: now });
    const executionId = await ctx.db.insert("executions", {
      strategyAccountId: args.strategyAccountId, kind: "uniswap_pool_swap", status: "filled",
      summary: "Confirmed Uniswap buy reconciled to native financial state",
      detail: JSON.stringify({ proposalId: String(args.proposalId), intentId: args.intentId,
        reservationId: args.reservationId, journalTransactionId: args.journalTransactionId,
        postFillSnapshotHash: args.postFillSnapshotHash, receiptId: String(receiptId) }),
      txHash: args.transactionHash, requestId: args.intentId,
      origin: "system", pipelineStage: "reconciliation", confirmedAt: now,
      createdAt: now, updatedAt: now, executedAt: now,
    });
    await ctx.db.patch(proposal._id, { status: "executed", updatedAt: now,
      decidedAt: proposal.decidedAt ?? now });
    return { receiptId: String(receiptId), executionId: String(executionId), duplicate: false };
  },
});

/** Project only a journal-reconciled, finalized Magic-owned vault fill. */
export const recordConfirmedVaultBuy = internalMutation({
  args: { proposalId: v.id("tradeProposals"),
    strategyAccountId: v.id("strategyAccounts"),
    assignmentId: v.id("programAssignments"),
    programVersionId: v.id("tradingProgramVersions"),
    mandateId: v.id("managedSpotMandates"),
    intentId: v.string(), attemptId: v.string(), reservationId: v.string(),
    grantId: v.string(), vaultAddress: v.string(), orderId: v.string(),
    transactionHash: v.string(), confirmedBlockNumber: v.string(),
    confirmedBlockHash: v.string(), postFillSnapshotHash: v.string(),
    financeRevision: v.string(), journalTransactionId: v.string(),
    actualInputUnits: v.string(), actualOutputUnits: v.string() },
  handler: async (ctx, args) => {
    if (!sha.test(args.attemptId) || !sha.test(args.reservationId)
      || !sha.test(args.postFillSnapshotHash) || !sha.test(args.journalTransactionId)
      || !hex32.test(args.orderId) || !hex32.test(args.transactionHash)
      || !hex32.test(args.confirmedBlockHash)
      || !/^0x[0-9a-f]{40}$/.test(args.vaultAddress)
      || !positive.test(args.confirmedBlockNumber) || !uint.test(args.financeRevision)
      || !positive.test(args.actualInputUnits) || !positive.test(args.actualOutputUnits)
      || args.grantId !== `vault-${String(args.mandateId)}` || !args.intentId) {
      throw new Error("Managed vault native fill proof is malformed.");
    }
    const prior = await ctx.db.query("managedUniswapTradeReceipts")
      .withIndex("by_proposalId", (q) => q.eq("proposalId", args.proposalId)).first();
    if (prior) {
      for (const key of ["attemptId", "reservationId", "transactionHash", "vaultAddress",
        "orderId", "postFillSnapshotHash", "journalTransactionId",
        "actualInputUnits", "actualOutputUnits"] as const) {
        if (prior[key] !== args[key]) throw new Error("Vault fill conflicts with prior proof.");
      }
      return { receiptId: String(prior._id), duplicate: true };
    }
    if (await ctx.db.query("managedUniswapTradeReceipts")
      .withIndex("by_transactionHash", (q) => q.eq("transactionHash", args.transactionHash)).first()) {
      throw new Error("Vault transaction is attributed to another proposal.");
    }
    const [proposal, assignment, version, mandate] = await Promise.all([
      ctx.db.get(args.proposalId), ctx.db.get(args.assignmentId),
      ctx.db.get(args.programVersionId), ctx.db.get(args.mandateId),
    ]);
    if (!proposal || !assignment || !version || !mandate
      || proposal.status !== "executing"
      || proposal.strategyAccountId !== args.strategyAccountId
      || proposal.programAssignmentId !== args.assignmentId
      || proposal.programVersionId !== args.programVersionId
      || proposal.controllerMode !== "autopilot"
      || proposal.controllerRef?.controllerKind !== "managed_program"
      || proposal.controllerRef.controllerId !== String(args.assignmentId)
      || proposal.controllerRef.controllerVersionId !== String(args.programVersionId)
      || proposal.controllerRef.contentHash !== version.contentHash
      || assignment.strategyAccountId !== args.strategyAccountId
      || assignment.userId !== proposal.userId
      || mandate.userId !== proposal.userId
      || mandate.strategyAccountId !== args.strategyAccountId
      || mandate.assignmentId !== args.assignmentId
      || mandate.programVersionId !== args.programVersionId
      || mandate.vaultAddress !== args.vaultAddress
      || !["active", "stopped"].includes(mandate.status)) {
      throw new Error("Vault fill is not linked to the Magic-owned managed proposal.");
    }
    let payload: any;
    try { payload = JSON.parse(proposal.payloadJson); }
    catch { throw new Error("Managed proposal payload is malformed."); }
    if (payload.side !== "long" || payload.candidate_venues?.[0] !== "uniswap"
      || payload.order_type !== "market" || payload.leverage !== 1) {
      throw new Error("Vault fill is outside the approved spot buy route.");
    }
    const now = Date.now();
    const receiptId = await ctx.db.insert("managedUniswapTradeReceipts", {
      proposalId: args.proposalId, strategyAccountId: args.strategyAccountId,
      assignmentId: args.assignmentId, programVersionId: args.programVersionId,
      intentId: args.intentId, attemptId: args.attemptId,
      reservationId: args.reservationId, grantId: args.grantId,
      vaultAddress: args.vaultAddress, orderId: args.orderId,
      transactionHash: args.transactionHash,
      confirmedBlockNumber: args.confirmedBlockNumber,
      confirmedBlockHash: args.confirmedBlockHash,
      postFillSnapshotHash: args.postFillSnapshotHash,
      financeRevision: args.financeRevision,
      journalTransactionId: args.journalTransactionId,
      actualInputUnits: args.actualInputUnits,
      actualOutputUnits: args.actualOutputUnits, createdAt: now,
    });
    const executionId = await ctx.db.insert("executions", {
      strategyAccountId: args.strategyAccountId, kind: "uniswap_pool_swap", status: "filled",
      summary: "Confirmed vault buy reconciled to native financial state",
      detail: JSON.stringify({ proposalId: String(args.proposalId),
        mandateId: String(args.mandateId), vaultAddress: args.vaultAddress,
        orderId: args.orderId, receiptId: String(receiptId),
        journalTransactionId: args.journalTransactionId }),
      txHash: args.transactionHash, requestId: args.intentId,
      origin: "system", pipelineStage: "reconciliation", confirmedAt: now,
      createdAt: now, updatedAt: now, executedAt: now,
    });
    await ctx.db.patch(proposal._id, { status: "executed", updatedAt: now,
      decidedAt: proposal.decidedAt ?? now });
    return { receiptId: String(receiptId), executionId: String(executionId), duplicate: false };
  },
});
