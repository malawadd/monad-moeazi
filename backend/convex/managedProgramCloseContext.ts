import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { parseAutomationPolicy } from "./helpers/agentPolicy";
import { operatorOwnedProgramSource, verifyFrozenProgramVersion } from "./mobile";

const address = /^0x[0-9a-f]{40}$/;

/** Stopped-program identity for a reduce-only exit; this never grants entry authority. */
export const getCloseContext = internalQuery({
  args: { assignmentId: v.id("programAssignments"), subject: v.string() },
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || assignment.status !== "paused" || assignment.shadowCadenceEnabled === true
        || assignment.source !== "explicit" || assignment.controllerMode !== "autopilot"
        || assignment.positionClosureState !== "unconfirmed") return null;
    const [account, user, version, authorities] = await Promise.all([
      ctx.db.get(assignment.strategyAccountId), ctx.db.get(assignment.userId),
      ctx.db.get(assignment.programVersionId),
      ctx.db.query("managedProgramActivationAuthorities")
        .withIndex("by_assignmentId_venue", (q) => q.eq("assignmentId", assignment._id)
          .eq("venue", "uniswap")).collect(),
    ]);
    if (!account || !user || !version || account.userId !== user._id
        || user.authSubject !== args.subject || authorities.length !== 1
        || !await operatorOwnedProgramSource(ctx, version)
        || !await verifyFrozenProgramVersion(version)) return null;
    const authority = authorities[0];
    const owner = authority.ownerAddress?.toLowerCase();
    if (authority.state !== "revoked" || authority.source !== "native_finance_authority"
        || authority.strategyAccountId !== account._id
        || authority.programVersionId !== version._id
        || authority.contentHash !== version.contentHash
        || !address.test(owner) || !authority.executionGrantId) return null;
    const isVault = authority.executionGrantId.startsWith("vault-");
    const mandates = isVault ? await ctx.db.query("managedSpotMandates")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", account._id)).collect() : [];
    const matchingVaults = mandates.filter((mandate) =>
      `vault-${String(mandate._id)}` === authority.executionGrantId
      && mandate.assignmentId === assignment._id
      && mandate.programVersionId === version._id
      && mandate.ownerAddress === owner
      && mandate.status === "stopped" && mandate.stopState === "confirmed"
      && mandate.vaultAddress && mandate.vaultCodeHash && mandate.executorAddress);
    if (isVault && matchingVaults.length !== 1) return null;
    const vault = matchingVaults[0];
    const wallets = await ctx.db.query("accountWallets")
      .withIndex("by_userId", (q) => q.eq("userId", user._id)).collect();
    if (wallets.filter((wallet) => wallet.ownerAddress?.toLowerCase() === owner
        && (!isVault || wallet.walletProvider === "magic")
        && (!wallet.strategyAccountId || wallet.strategyAccountId === account._id)).length !== 1) return null;
    let policy;
    try { policy = parseAutomationPolicy(version.policyJson); }
    catch { return null; }
    if (!policy.allowedVenues.includes("uniswap")) return null;
    return { authority: "reduce_only_close" as const,
      strategyAccountId: String(account._id), assignmentId: String(assignment._id),
      customerSubject: user.authSubject, programVersionId: String(version._id),
      contentHash: version.contentHash, frozenProgramPolicyHash: version.policyHash,
      ownerAddress: owner, sourceAccountId: vault
        ? `arbitrum:42161:vault:${vault.vaultAddress}`
        : `arbitrum:42161:wallet:${owner}`,
      executionGrantId: authority.executionGrantId,
      executionGrantHash: authority.executionGrantHash,
      activationReceiptExpiresAt: authority.expiresAt,
      maxSlippageBps: policy.maxSlippageBps,
      ...(vault ? { vault: { mandateId: String(vault._id),
        vaultAddress: vault.vaultAddress, ownerAddress: vault.ownerAddress,
        executorAddress: vault.executorAddress, codeHash: vault.vaultCodeHash,
        programHash: vault.programHash, policyHash: vault.policyHash,
        capitalUnits: vault.capitalUnits, maxBuyUnits: vault.maxBuyUnits,
        expiresAt: vault.expiresAt } } : {}),
      controllerRef: { schemaVersion: 1 as const, environment: "live" as const,
        strategyAccountId: String(account._id), controllerKind: "managed_program" as const,
        controllerId: String(assignment._id), controllerVersionId: String(version._id),
        contentHash: version.contentHash } };
  },
});
