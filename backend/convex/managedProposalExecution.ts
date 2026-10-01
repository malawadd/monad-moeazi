import { sameController } from "../lib/programOwnership";
import { resolveManagedProgramContext } from "./managedProgramRuntime";
import { managedProgramActivationEligibility } from "./mobile";

/** Revalidate a managed proposal against its originating job and current assignment. */
export async function managedProposalExecutionContext(ctx: any, proposal: any) {
  if (!proposal.jobId || !proposal.programAssignmentId || !proposal.programVersionId
      || proposal.teamId || proposal.teamVersionId || proposal.deploymentId
      || proposal.controllerMode !== "autopilot" || !proposal.controllerRef) return null;
  const [job, strategy, user] = await Promise.all([
    ctx.db.get(proposal.jobId), ctx.db.get(proposal.strategyAccountId),
    ctx.db.get(proposal.userId),
  ]);
  if (!job || !strategy || !user || strategy.status !== "active" || strategy.emergencyStop
      || job.status !== "completed" || job.analysisId !== proposal.analysisId
      || job.strategyAccountId !== strategy._id || job.userId !== proposal.userId
      || strategy.userId !== proposal.userId
      || job.programAssignmentId !== proposal.programAssignmentId
      || job.programVersionId !== proposal.programVersionId
      || job.marketId !== proposal.marketId || job.controllerMode !== "autopilot"
      || !sameController(job.controllerRef, proposal.controllerRef)) return null;
  const managed = await resolveManagedProgramContext(ctx, job, strategy);
  if (!managed || !sameController(managed.controllerRef, proposal.controllerRef)
      || managed.managedProgram.assignment.assignmentId !== proposal.programAssignmentId
      || managed.managedProgram.version._id !== proposal.programVersionId) return null;
  const assignment = await ctx.db.get(proposal.programAssignmentId);
  if (!assignment || assignment.shadowCadenceEnabled !== true
      || !(await managedProgramActivationEligibility(ctx, user, strategy)).activationReady) return null;
  const venue = JSON.parse(proposal.payloadJson).candidate_venues?.[0];
  if (typeof venue !== "string") return null;
  const [wallets, authority, mandates] = await Promise.all([
    ctx.db.query("accountWallets").withIndex("by_userId", (q: any) =>
      q.eq("userId", user._id)).collect(),
    ctx.db.query("managedProgramActivationAuthorities")
      .withIndex("by_assignmentId_venue", (q: any) =>
        q.eq("assignmentId", assignment._id).eq("venue", venue)).first(),
    ctx.db.query("managedSpotMandates").withIndex("by_strategyAccountId", (q: any) =>
      q.eq("strategyAccountId", strategy._id)).collect(),
  ]);
  if (!authority || authority.state !== "ready" || authority.expiresAt <= Date.now()) return null;
  const ownedWallets = wallets.filter((wallet: any) => wallet.ownerVerifiedAt
    && String(wallet.ownerAddress ?? "").toLowerCase() === authority.ownerAddress
    && (!String(authority.executionGrantId).startsWith("vault-")
      || wallet.walletProvider === "magic"));
  if (ownedWallets.length !== 1) return null;
  const vaultMandates = mandates.filter((mandate: any) =>
    `vault-${String(mandate._id)}` === authority.executionGrantId
    && mandate.status === "active" && mandate.assignmentId === assignment._id
    && mandate.programVersionId === proposal.programVersionId
    && mandate.ownerAddress === authority.ownerAddress
    && mandate.venueAccountId === authority.venueAccountId);
  if (String(authority.executionGrantId).startsWith("vault-") && vaultMandates.length !== 1) return null;
  const vault = vaultMandates[0];
  return {
    proposal: { ...proposal, payload: JSON.parse(proposal.payloadJson) },
    profile: managed.profile, controllerRef: managed.controllerRef,
    programAssignmentId: proposal.programAssignmentId,
    programVersionId: proposal.programVersionId,
    managedProgram: managed.managedProgram,
    policy: managed.policy, strategy,
    availableCredits: managed.availableCredits,
    nativeAuthority: {
      venue, venueAccountId: String(authority.venueAccountId),
      ownerAddress: authority.ownerAddress,
      financeSnapshotHash: authority.financeSnapshotHash,
      accountRevision: authority.accountRevision,
      writerEpoch: authority.writerEpoch,
      authorityEpoch: authority.authorityEpoch,
      activationReceiptHash: authority.receiptHash,
      executionGrantId: authority.executionGrantId,
      executionGrantHash: authority.executionGrantHash,
      expiresAt: authority.expiresAt,
      ...(vault ? { mandateId: String(vault._id), vaultAddress: vault.vaultAddress,
        vaultCodeHash: vault.vaultCodeHash, executorAddress: vault.executorAddress,
        capitalUnits: vault.capitalUnits, maxBuyUnits: vault.maxBuyUnits,
        programHash: vault.programHash, policyHash: vault.policyHash,
        mandateExpiresAt: vault.expiresAt } : {}),
    },
  };
}
