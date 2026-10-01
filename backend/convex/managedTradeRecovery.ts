import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { sameController } from "../lib/programOwnership";

/** Historical identity for observing a possibly submitted trade. Never authorizes another order. */
export const getReconciliationContext = internalQuery({
  args: { proposalId: v.id("tradeProposals"), commandId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || !["approved", "executing", "executed"].includes(proposal.status) || !proposal.jobId
        || !proposal.programAssignmentId || !proposal.programVersionId
        || !proposal.controllerRef || proposal.controllerMode !== "autopilot"
        || proposal.teamId || proposal.teamVersionId || proposal.deploymentId
        || (args.commandId !== undefined && proposal.idempotencyKey !== args.commandId)) return null;
    const [job, account, assignment, version] = await Promise.all([
      ctx.db.get(proposal.jobId), ctx.db.get(proposal.strategyAccountId),
      ctx.db.get(proposal.programAssignmentId), ctx.db.get(proposal.programVersionId),
    ]);
    if (!job || !account || !assignment || !version
        || job.status !== "completed" || job.analysisId !== proposal.analysisId
        || job.strategyAccountId !== proposal.strategyAccountId
        || job.userId !== proposal.userId || job.programAssignmentId !== proposal.programAssignmentId
        || job.programVersionId !== proposal.programVersionId || job.marketId !== proposal.marketId
        || job.controllerMode !== "autopilot" || !job.controllerRef
        || !sameController(job.controllerRef, proposal.controllerRef)
        || assignment.strategyAccountId !== account._id
        || assignment.userId !== proposal.userId
        || assignment.programVersionId !== version._id
        || proposal.controllerRef.controllerKind !== "managed_program"
        || proposal.controllerRef.controllerId !== String(assignment._id)
        || proposal.controllerRef.controllerVersionId !== String(version._id)
        || proposal.controllerRef.contentHash !== version.contentHash
        || proposal.controllerRef.strategyAccountId !== String(account._id)) return null;
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(proposal.payloadJson); }
    catch { return null; }
    if (!payload || payload.side !== "long" || payload.order_type !== "market"
        || payload.leverage !== 1 || !Array.isArray(payload.candidate_venues)
        || payload.candidate_venues.length !== 1 || payload.candidate_venues[0] !== "uniswap") return null;
    return { authority: "reconciliation_only" as const,
      commandId: proposal.idempotencyKey,
      proposal: { ...proposal, payload }, controllerRef: proposal.controllerRef,
      programAssignmentId: proposal.programAssignmentId,
      programVersionId: proposal.programVersionId };
  },
});
