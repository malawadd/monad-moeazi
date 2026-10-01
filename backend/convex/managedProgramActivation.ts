import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { managedProgramActivationAuthorityHash, operatorOwnedProgramSource,
  verifyFrozenProgramVersion, type ManagedProgramActivationReceipt } from "./mobile";
import { parseAutomationPolicy } from "./helpers/agentPolicy";
import { fundedVaultContext } from "./managedSpotMandates";
import { hasObservedMagicDelegation, selectMobileMagicWallet } from "./mobileMagicWallet";

const hash = /^[0-9a-f]{64}$/;
const uint = /^(?:0|[1-9][0-9]*)$/;
const grant = /^[A-Za-z0-9_-]{8,128}$/;

async function exactContext(ctx: any, assignmentId: any, grantId: string) {
  if (!grant.test(grantId)) return null;
  const assignment = await ctx.db.get(assignmentId);
  if (!assignment || assignment.source !== "explicit"
      || !["active", "paused"].includes(assignment.status)
      || assignment.controllerMode !== "autopilot") return null;
  const [account, user, version] = await Promise.all([
    ctx.db.get(assignment.strategyAccountId), ctx.db.get(assignment.userId),
    ctx.db.get(assignment.programVersionId),
  ]);
  if (!account || !user || !version || account.userId !== user._id
      || account.status !== "active" || account.emergencyStop
      || !await operatorOwnedProgramSource(ctx, version)
      || !await verifyFrozenProgramVersion(version)) return null;
  let policy;
  try { policy = parseAutomationPolicy(version.policyJson); }
  catch { return null; }
  if (!policy.allowedVenues.includes("uniswap") || !policy.allowedMarkets.some(
    (market) => ["WETH-USDC", "ETH-USDC", "ETH/USDC", "WETH/USDC"].includes(market))) return null;
  const [wallets, venueAccounts, integrations, permissions] = await Promise.all([
    ctx.db.query("accountWallets").withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect(),
    ctx.db.query("venueAccounts").withIndex("by_strategyAccountId", (q: any) =>
      q.eq("strategyAccountId", account._id)).collect(),
    ctx.db.query("venueIntegrations").withIndex("by_strategyAccountId_venue", (q: any) =>
      q.eq("strategyAccountId", account._id).eq("venue", "uniswap")).collect(),
    ctx.db.query("venuePermissions").withIndex("by_strategyAccountId_venue", (q: any) =>
      q.eq("strategyAccountId", account._id).eq("venue", "uniswap")).collect(),
  ]);
  const wallet = selectMobileMagicWallet(wallets, user._id, account, user.walletAddress);
  if (!hasObservedMagicDelegation(wallet)) return null;
  const ownerAddress = String(wallet.ownerAddress).toLowerCase();
  const native = venueAccounts.filter((row: any) => row.venue === "uniswap"
    && row.status === "ready" && !row.legacy && row.lastSyncStatus === "fresh"
    && String(row.walletAddress ?? "").toLowerCase() === ownerAddress);
  const integration = integrations.filter((row: any) => row.enabled && row.routingEnabled
    && row.status === "ready" && row.authorityMode === "autopilot");
  const active = permissions.filter((row: any) => row.status === "active"
    && row.authorityMode === "autopilot" && row.chainId === 42161
    && row.expiresAt > Date.now() && String(row.ownerAddress).toLowerCase() === ownerAddress);
  if (native.length !== 1 || integration.length !== 1 || active.length !== 1) return null;
  return { strategyAccountId: String(account._id), assignmentId: String(assignment._id),
    customerSubject: user.authSubject,
    programVersionId: String(version._id), contentHash: version.contentHash,
    ownerAddress, venue: "uniswap" as const, venueAccountId: String(native[0]._id),
    sourceAccountId: `arbitrum:42161:wallet:${ownerAddress}`,
    policyHash: version.policyHash, policyJson: version.policyJson,
    limitsJson: active[0].limitsJson, authorityExpiresAt: active[0].expiresAt as number,
    executionGrantId: grantId, financialAuthority: "identity_only" as const };
}

/** Read-only identity and consent context; it does not attest financial capacity. */
export const getContext = internalQuery({
  args: { assignmentId: v.id("programAssignments"), executionGrantId: v.string() },
  handler: async (ctx, args) => exactContext(ctx, args.assignmentId, args.executionGrantId),
});

/** Called only through the exact-secret native-finance ingress after DB and grant verification. */
export const recordNativeReceipt = internalMutation({
  args: {
    strategyAccountId: v.id("strategyAccounts"), assignmentId: v.id("programAssignments"),
    programVersionId: v.id("tradingProgramVersions"), venueAccountId: v.id("venueAccounts"),
    venue: v.literal("uniswap"), ownerAddress: v.string(), contentHash: v.string(),
    financeSnapshotHash: v.string(), accountRevision: v.string(), writerEpoch: v.string(),
    authorityEpoch: v.string(), executionGrantId: v.string(), executionGrantHash: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const current = await exactContext(ctx, args.assignmentId, args.executionGrantId);
    if (!current || args.venue !== current.venue
        || String(args.strategyAccountId) !== current.strategyAccountId
        || String(args.programVersionId) !== current.programVersionId
        || String(args.venueAccountId) !== current.venueAccountId
        || args.ownerAddress !== current.ownerAddress || args.contentHash !== current.contentHash
        || !hash.test(args.financeSnapshotHash) || !hash.test(args.executionGrantHash)
        || !uint.test(args.accountRevision) || !uint.test(args.writerEpoch)
        || !uint.test(args.authorityEpoch)
        || !Number.isSafeInteger(args.expiresAt) || args.expiresAt <= Date.now()
        || args.expiresAt > Math.min(current.authorityExpiresAt, Date.now() + 15 * 60_000)) {
      throw new Error("Native finance activation receipt is inconsistent or expired.");
    }
    const receipt: ManagedProgramActivationReceipt = { ...args,
      strategyAccountId: String(args.strategyAccountId), assignmentId: String(args.assignmentId),
      programVersionId: String(args.programVersionId), venueAccountId: String(args.venueAccountId),
      source: "native_finance_authority", state: "ready" };
    const receiptHash = await managedProgramActivationAuthorityHash(receipt);
    const existing = await ctx.db.query("managedProgramActivationAuthorities")
      .withIndex("by_assignmentId_venue", (q) => q.eq("assignmentId", args.assignmentId)
        .eq("venue", "uniswap")).collect();
    if (existing.length > 1) throw new Error("Ambiguous native finance activation receipts.");
    const row = { ...args, source: "native_finance_authority" as const,
      state: "ready" as const, receiptHash };
    const id = existing[0] ? existing[0]._id
      : await ctx.db.insert("managedProgramActivationAuthorities", row);
    if (existing[0]) await ctx.db.patch(id, row);
    return { receiptId: String(id), receiptHash, expiresAt: args.expiresAt };
  },
});

/** The native finance writer alone may publish a funded Magic-owned vault receipt. */
export const recordNativeVaultReceipt = internalMutation({
  args: { mandateId: v.id("managedSpotMandates"),
    strategyAccountId: v.id("strategyAccounts"), assignmentId: v.id("programAssignments"),
    programVersionId: v.id("tradingProgramVersions"), venueAccountId: v.id("venueAccounts"),
    ownerAddress: v.string(), contentHash: v.string(), financeSnapshotHash: v.string(),
    accountRevision: v.string(), writerEpoch: v.string(), authorityEpoch: v.string(),
    expiresAt: v.number() },
  handler: async (ctx, args) => {
    const current = await fundedVaultContext(ctx, args.mandateId);
    if (!current || String(args.strategyAccountId) !== current.strategyAccountId
      || String(args.assignmentId) !== current.assignmentId
      || String(args.programVersionId) !== current.programVersionId
      || String(args.venueAccountId) !== current.venueAccountId
      || args.ownerAddress !== current.ownerAddress || args.contentHash !== current.programHash
      || !hash.test(args.financeSnapshotHash)
      || !uint.test(args.accountRevision) || !uint.test(args.writerEpoch)
      || !uint.test(args.authorityEpoch) || !Number.isSafeInteger(args.expiresAt)
      || args.expiresAt <= Date.now()
      || args.expiresAt > Math.min(current.expiresAt, Date.now() + 15 * 60_000)) {
      throw new Error("Vault finance receipt differs from the confirmed Magic mandate.");
    }
    const receipt: ManagedProgramActivationReceipt = {
      source: "native_finance_authority", state: "ready",
      strategyAccountId: current.strategyAccountId, assignmentId: current.assignmentId,
      programVersionId: current.programVersionId, venueAccountId: current.venueAccountId,
      venue: "uniswap", ownerAddress: current.ownerAddress,
      contentHash: current.programHash, financeSnapshotHash: args.financeSnapshotHash,
      accountRevision: args.accountRevision, writerEpoch: args.writerEpoch,
      authorityEpoch: args.authorityEpoch,
      executionGrantId: `vault-${current.mandateId}`,
      executionGrantHash: current.mandateHash, expiresAt: args.expiresAt,
    };
    const receiptHash = await managedProgramActivationAuthorityHash(receipt);
    const existing = await ctx.db.query("managedProgramActivationAuthorities")
      .withIndex("by_assignmentId_venue", (q) => q.eq("assignmentId", args.assignmentId)
        .eq("venue", "uniswap")).collect();
    if (existing.length > 1 || existing.some((row) =>
      String(row.venueAccountId) !== current.venueAccountId)) {
      throw new Error("Conflicting Uniswap activation authority exists.");
    }
    const row = { ...args, venue: "uniswap" as const,
      executionGrantId: receipt.executionGrantId,
      executionGrantHash: receipt.executionGrantHash,
      source: receipt.source, state: receipt.state, receiptHash };
    const { mandateId: _mandateId, ...stored } = row;
    const id = existing[0] ? existing[0]._id
      : await ctx.db.insert("managedProgramActivationAuthorities", stored);
    if (existing[0]) await ctx.db.patch(id, stored);
    return { receiptId: String(id), receiptHash, expiresAt: args.expiresAt };
  },
});
