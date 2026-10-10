import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { formatUnits } from "viem";
import { getUserByAuthSubject } from "./model";
import { controllerHash, mobileAssignmentState } from "../lib/programOwnership";
import { DEFAULT_AUTOMATION_POLICY, parseAutomationPolicy } from "./helpers/agentPolicy";
import { getManagedProgramScheduleState } from "./managedProgramCadence";
import { hasObservedMagicDelegation, mobileMagicWallet,
  selectMobileMagicWallet } from "./mobileMagicWallet";
import { managedAgentReleaseSummary } from "./helpers/managedAgentRelease";
import { verifyFrozenProgramVersion } from "./helpers/frozenProgramVersion";
import { assertMobileChainActionsPaused } from "./mobileAuthOnly";
export { verifyFrozenProgramVersion } from "./helpers/frozenProgramVersion";

const SCHEMA_VERSION = "2026-09-01" as const;

async function viewer(ctx: any, create = false) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication is required.");
  const address = String(identity.walletAddress ?? "").toLowerCase();
  if (identity.authProvider !== "mera" || !/^0x[a-f0-9]{40}$/.test(address)
      || identity.subject !== `mera:${address}`) {
    throw new Error("A valid Mera mobile identity is required.");
  }
  let user = await getUserByAuthSubject(ctx, identity.subject);
  if (!user && create) {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authSubject: identity.subject, authProvider: "mera", walletAddress: address,
      email: typeof identity.email === "string" ? identity.email : undefined,
      displayName: typeof identity.name === "string" ? identity.name : undefined,
      createdAt: now, updatedAt: now,
    });
    user = await ctx.db.get(userId);
  }
  if (!user) throw new Error("Moeazi account is not provisioned.");
  if (user.authProvider !== "mera" || String(user.walletAddress ?? "").toLowerCase() !== address) {
    throw new Error("Mera account identity does not match its wallet.");
  }
  return { identity, user, strategyAccount: null as any };
}

function money(value: number) { return Math.max(0, value).toFixed(2); }
function parse(value: string | undefined) { try { return value ? JSON.parse(value) : {}; } catch { return {}; } }

function latestAiUpdate(job: any, proposal: any) {
  const jobAt = Number(job?.updatedAt ?? job?.createdAt ?? 0);
  const proposalAt = Number(proposal?.updatedAt ?? proposal?.createdAt ?? 0);
  if (!jobAt && !proposalAt) return undefined;
  if (proposalAt >= jobAt) {
    const market = proposal.marketId || "a market";
    const side = proposal.side === "long" ? "buy" : "sell";
    if (["failed", "blocked"].includes(proposal.status)) return { state: "blocked", summary: `The latest ${market} decision was blocked before funds moved.`, occurredAt: new Date(proposalAt).toISOString(), activityId: String(proposal._id) };
    if (["rejected", "expired"].includes(proposal.status)) return { state: "hold", summary: `The ${market} decision did not continue, so no new action started.`, occurredAt: new Date(proposalAt).toISOString(), activityId: String(proposal._id) };
    if (proposal.status === "executed") return { state: "acted", summary: `The AI completed its latest ${market} ${side} decision.`, occurredAt: new Date(proposalAt).toISOString(), activityId: String(proposal._id) };
    return { state: "acted", summary: `The AI prepared a ${market} ${side} decision for the next deterministic checks.`, occurredAt: new Date(proposalAt).toISOString(), activityId: String(proposal._id) };
  }
  const market = job.marketId === "__POLICY__" ? "your limits" : job.marketId;
  if (["queued", "claimed", "running"].includes(job.status)) return { state: "checking", summary: `The AI is checking ${market} now.`, occurredAt: new Date(jobAt).toISOString(), activityId: String(job._id) };
  if (["failed", "cancelled"].includes(job.status)) return { state: "blocked", summary: `The latest check of ${market} could not complete.`, occurredAt: new Date(jobAt).toISOString(), activityId: String(job._id) };
  return { state: "hold", summary: `The AI finished checking ${market}; no newer trade decision was created.`, occurredAt: new Date(jobAt).toISOString(), activityId: String(job._id) };
}

async function assignmentForAccount(ctx: any, strategyAccountId: any, userId: any) {
  const rows = await ctx.db.query("programAssignments").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId)).collect();
  const selected = mobileAssignmentState(rows as Array<{ _id: any; status: string; userId: any; strategyAccountId: any; programVersionId: any; source?: string; controllerMode?: "shadow" | "autopilot"; shadowCadenceEnabled?: boolean }>);
  if (!selected.assignment) {
    const paused = rows.filter((row: any) => row.status === "paused");
    const staged = paused.length === 1 && selected.reason === "unassigned"
      && paused[0].source === "explicit" && paused[0].userId === userId
      && paused[0].strategyAccountId === strategyAccountId ? paused[0] : null;
    const version = staged ? await ctx.db.get(staged.programVersionId) : null;
    const validStaged = Boolean(staged && version && await operatorOwnedProgramSource(ctx, version)
      && await verifyFrozenProgramVersion(version));
    if (staged && !validStaged) return { state: "invalid_assignment", assignment: null, staged: null, version: null };
    return { state: staged ? "paused" : paused.length === 1 && selected.reason === "unassigned"
      ? "invalid_assignment" : selected.reason,
      assignment: null, staged, version };
  }
  const assignment = selected.assignment;
  const version = assignment.userId === userId && assignment.strategyAccountId === strategyAccountId
    ? await ctx.db.get(assignment.programVersionId) : null;
  if (!version || !await operatorOwnedProgramSource(ctx, version)
      || !await verifyFrozenProgramVersion(version)) {
    return { state: "invalid_assignment", assignment: null, version: null };
  }
  return { state: "active", assignment, staged: null, version };
}

/** The program source belongs to its operator creator; the assignment belongs to the customer. */
export async function operatorOwnedProgramSource(ctx: any, version: any) {
  const [program, source] = await Promise.all([
    ctx.db.get(version.programId), ctx.db.get(version.sourceStrategyAccountId),
  ]);
  if (!program?.createdBySubject || !source?.userId) return false;
  const creator = await ctx.db.get(source.userId);
  return creator?.authSubject === program.createdBySubject;
}

const MANAGED_PROGRAM_AUTHORITY_UNAVAILABLE = "A current backed finance and venue authority receipt is required before managed Autopilot can start.";
const HASH = /^[0-9a-f]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;

export type ManagedProgramActivationVenue = { venue: string; venueAccountId: string };
export type ManagedProgramActivationReceipt = {
  source: "native_finance_authority";
  state: "ready" | "blocked" | "revoked";
  strategyAccountId: string; assignmentId: string; programVersionId: string;
  contentHash: string; ownerAddress: string; financeSnapshotHash: string;
  accountRevision: string; writerEpoch: string; authorityEpoch: string;
  venue: string; venueAccountId: string; executionGrantId: string;
  executionGrantHash: string; expiresAt: number;
};

/** Hashes receipt contents; its trusted source comes from the internal-only producer. */
export async function managedProgramActivationAuthorityHash(receipt: ManagedProgramActivationReceipt) {
  return await controllerHash({ schemaVersion: 1, authorityKind: "managed_program_activation",
    source: receipt.source, state: receipt.state, strategyAccountId: receipt.strategyAccountId,
    assignmentId: receipt.assignmentId, programVersionId: receipt.programVersionId,
    contentHash: receipt.contentHash, ownerAddress: receipt.ownerAddress,
    financeSnapshotHash: receipt.financeSnapshotHash, accountRevision: receipt.accountRevision,
    writerEpoch: receipt.writerEpoch, authorityEpoch: receipt.authorityEpoch,
    venue: receipt.venue, venueAccountId: receipt.venueAccountId,
    executionGrantId: receipt.executionGrantId,
    executionGrantHash: receipt.executionGrantHash, expiresAt: receipt.expiresAt });
}

/**
 * Validates the current internal receipt set for a managed assignment. The hash and
 * source label detect content drift; only the internal-only native finance producer
 * establishes provenance and native-state truth.
 */
export async function managedProgramActivationReceiptsReady(ctx: any, input: {
  strategyAccountId: string; assignmentId: string; programVersionId: string;
  contentHash: string; ownerAddress: string; venues: ManagedProgramActivationVenue[]; now?: number;
}) {
  const now = input.now ?? Date.now();
  if (!input.venues.length || new Set(input.venues.map((item) => item.venue)).size !== input.venues.length
      || input.venues.some((item) => !item.venue || !item.venueAccountId)) return false;
  const receipts: any[] = await ctx.db.query("managedProgramActivationAuthorities")
    .withIndex("by_assignmentId", (q: any) => q.eq("assignmentId", input.assignmentId)).collect();
  if (receipts.length !== input.venues.length) return false;
  const expected = new Map(input.venues.map((item) => [item.venue, item.venueAccountId]));
  const seen = new Set<string>();
  let financeBinding: string | null = null;
  for (const receipt of receipts) {
    const venueAccountId = expected.get(receipt.venue);
    if (!venueAccountId || seen.has(receipt.venue)) return false;
    if (receipt.source !== "native_finance_authority" || receipt.state !== "ready"
        || String(receipt.strategyAccountId) !== input.strategyAccountId
        || String(receipt.assignmentId) !== input.assignmentId
        || String(receipt.programVersionId) !== input.programVersionId
        || receipt.contentHash !== input.contentHash
        || receipt.ownerAddress !== input.ownerAddress.toLowerCase()
        || String(receipt.venueAccountId) !== venueAccountId
        || !receipt.executionGrantId || !HASH.test(receipt.executionGrantHash ?? "")
        || !HASH.test(receipt.contentHash ?? "")
        || !HASH.test(receipt.financeSnapshotHash ?? "")
        || !UINT.test(receipt.accountRevision ?? "")
        || !UINT.test(receipt.writerEpoch ?? "")
        || !UINT.test(receipt.authorityEpoch ?? "")
        || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= now
        || !HASH.test(receipt.receiptHash ?? "")) return false;
    const hashInput: ManagedProgramActivationReceipt = {
      source: receipt.source, state: receipt.state,
      strategyAccountId: String(receipt.strategyAccountId), assignmentId: String(receipt.assignmentId),
      programVersionId: String(receipt.programVersionId), contentHash: receipt.contentHash,
      ownerAddress: receipt.ownerAddress, financeSnapshotHash: receipt.financeSnapshotHash,
      accountRevision: receipt.accountRevision, writerEpoch: receipt.writerEpoch,
      authorityEpoch: receipt.authorityEpoch, venue: receipt.venue,
      venueAccountId: String(receipt.venueAccountId),
      executionGrantId: receipt.executionGrantId,
      executionGrantHash: receipt.executionGrantHash, expiresAt: receipt.expiresAt,
    };
    if (await managedProgramActivationAuthorityHash(hashInput) !== receipt.receiptHash) return false;
    const financeRow = JSON.stringify([receipt.financeSnapshotHash, receipt.accountRevision,
      receipt.writerEpoch, receipt.authorityEpoch]);
    if (financeBinding && financeBinding !== financeRow) return false;
    financeBinding = financeRow;
    seen.add(receipt.venue);
  }
  return seen.size === expected.size;
}

function parseFrozenRiskPolicy(value: string | undefined) {
  if (!value) return null;
  try { const raw = JSON.parse(value); if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || !Object.keys(DEFAULT_AUTOMATION_POLICY).every((key) => Object.prototype.hasOwnProperty.call(raw, key))) return null; return parseAutomationPolicy(value); }
  catch { return null; }
}

function exactGrantUnits(value: unknown) {
  if (typeof value !== "string" || !UINT.test(value)) return null;
  try { const parsed = BigInt(value); return parsed > 0n ? parsed : null; }
  catch { return null; }
}

/** Viewer-only context for preparing an owner-signed, one-call Uniswap grant. */
export const getUniswapGrantContext = query({ args: {}, handler: async (ctx) => {
  assertMobileChainActionsPaused();
  const { identity, user, strategyAccount } = await viewer(ctx);
  const blocked = (code: string, blockingReason: string) => ({ contextAvailable: false as const, code, blockingReason });
  if (!strategyAccount) return blocked("managed_assignment_required", "Finish Magic account setup before preparing a managed venue grant.");
  const [selected, wallet, venueAccounts, integrations, permissions] = await Promise.all([
    assignmentForAccount(ctx, strategyAccount._id, user._id),
    mobileMagicWallet(ctx, user, strategyAccount, identity.walletAddress),
    ctx.db.query("venueAccounts").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).collect(),
    ctx.db.query("venueIntegrations").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).collect(),
    ctx.db.query("venuePermissions").withIndex("by_strategyAccountId_venue", (q: any) => q.eq("strategyAccountId", strategyAccount._id).eq("venue", "uniswap")).collect(),
  ]);
  const assignment = selected.assignment ?? selected.staged;
  const version = selected.version;
  if (!assignment) return blocked("managed_assignment_required", "An explicitly released managed program assignment is required before preparing a Uniswap grant.");
  if (assignment.userId !== user._id || assignment.strategyAccountId !== strategyAccount._id
      || assignment.source !== "explicit" || !version || !await verifyFrozenProgramVersion(version)
      || !await operatorOwnedProgramSource(ctx, version)) {
    return blocked("managed_assignment_invalid", "The managed program assignment failed ownership or frozen-version checks.");
  }
  if (assignment.controllerMode !== "autopilot") return blocked("autopilot_policy_required", "Select an explicit Autopilot managed program before preparing a Uniswap grant.");
  const policy = parseFrozenRiskPolicy(version.policyJson);
  if (!policy) return blocked("frozen_policy_invalid", "The managed program's frozen risk policy could not be verified.");
  if (policy.allowedVenues.length !== 1 || policy.allowedVenues[0] !== "uniswap") {
    return blocked("uniswap_policy_not_exclusive", "This mobile grant route requires a frozen policy that allows Uniswap only.");
  }
  const owner = String(wallet?.ownerAddress ?? "").toLowerCase();
  if (!hasObservedMagicDelegation(wallet) || !/^0x[a-f0-9]{40}$/.test(owner)) {
    return blocked("owner_delegation_required", "Verify the Magic owner and complete Arbitrum account delegation before preparing the scoped grant.");
  }
  const now = Date.now();
  const matchingAccounts = venueAccounts.filter((row: any) => row.venue === "uniswap"
    && row.status === "ready" && row.legacy !== true && row.lastSyncStatus === "fresh"
    && String(row.ownerAddress ?? row.walletAddress).toLowerCase() === owner);
  const matchingIntegrations = integrations.filter((row: any) => row.venue === "uniswap"
    && row.enabled && row.routingEnabled && row.status === "ready" && row.authorityMode === "autopilot");
  const matchingPermissions = permissions.filter((row: any) => row.status === "active"
    && row.authorityMode === "autopilot" && row.chainId === 42161 && row.expiresAt !== undefined
    && row.expiresAt > now && String(row.ownerAddress).toLowerCase() === owner);
  if (matchingAccounts.length !== 1 || matchingIntegrations.length !== 1 || matchingPermissions.length !== 1) {
    return blocked("uniswap_authority_unavailable", "A fresh Uniswap account, enabled Autopilot integration, and current owner permission are required.");
  }
  const venueAccount = matchingAccounts[0], permission = matchingPermissions[0];
  let limits: any;
  try { limits = JSON.parse(permission.limitsJson); } catch { limits = null; }
  const matchesBinding = limits && limits.schemaVersion === 1
    && String(limits.strategyAccountId) === String(strategyAccount._id)
    && String(limits.assignmentId) === String(assignment._id)
    && String(limits.programVersionId) === String(version._id)
    && String(limits.contentHash) === version.contentHash
    && String(limits.policyHash) === version.policyHash
    && String(limits.venueAccountId) === String(venueAccount._id)
    && String(limits.ownerAddress).toLowerCase() === owner;
  const maxUsdc = exactGrantUnits(limits?.maxUsdcUnits);
  const maxWeth = exactGrantUnits(limits?.maxWethUnits);
  const minWethOut = exactGrantUnits(limits?.minWethOutUnits);
  const minUsdcOut = exactGrantUnits(limits?.minUsdcOutUnits);
  if (!matchesBinding || !maxUsdc || !maxWeth || !minWethOut || !minUsdcOut) {
    return blocked("exact_uniswap_limits_missing", "Exact policy-bound USDC/WETH grant limits are not recorded for this assignment and venue account. No USD-to-WETH limits will be inferred.");
  }
  const policyMaxUsdc = BigInt(Math.floor(policy.maxOrderUsd * 1_000_000));
  const effectiveMaxUsdc = maxUsdc < policyMaxUsdc ? maxUsdc : policyMaxUsdc;
  const authorityExpiresAt = typeof permission.expiresAt === "number" ? permission.expiresAt : 0;
  const nowSeconds = Math.floor(now / 1000);
  const fiveMinuteWindow = Math.floor(nowSeconds / 300) * 300;
  const expiresAt = Math.min(Math.floor(authorityExpiresAt / 1000), fiveMinuteWindow + 6 * 24 * 60 * 60);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= nowSeconds + 30) {
    return blocked("uniswap_authority_expired", "The Uniswap authority expires too soon to prepare a scoped grant.");
  }
  const bounds = { maxUsdcUnits: effectiveMaxUsdc.toString(), maxWethUnits: maxWeth.toString(),
    minWethOutUnits: minWethOut.toString(), minUsdcOutUnits: minUsdcOut.toString() };
  const grantContextHash = await controllerHash({ schemaVersion: 1, grantKind: "managed_uniswap_scoped_grant",
    strategyAccountId: String(strategyAccount._id), assignmentId: String(assignment._id),
    programVersionId: String(version._id), contentHash: version.contentHash, policyHash: version.policyHash,
    ownerAddress: owner, venueAccountId: String(venueAccount._id), bounds, expiresAt });
  return { contextAvailable: true as const, strategyAccountId: String(strategyAccount._id),
    assignmentId: String(assignment._id), programVersionId: String(version._id),
    contentHash: version.contentHash, policyHash: version.policyHash, ownerAddress: owner,
    venueAccountId: String(venueAccount._id), executionGrantId: `managed-${grantContextHash.slice(0, 48)}`,
    expiresAt, bounds, ownerSignaturesRequired: ["buy", "exit"] as const,
    broadcastEnabled: false as const };
} });

export async function managedProgramActivationEligibility(ctx: any, user: any, strategyAccount: any) {
  const [assignment, walletRows, credit, venueAccounts, integrations, permissions, mandates] = await Promise.all([
    assignmentForAccount(ctx, strategyAccount._id, user._id),
    ctx.db.query("accountWallets").withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect(),
    ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) => q.eq("userId", user._id)).first(),
    ctx.db.query("venueAccounts").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).collect(),
    ctx.db.query("venueIntegrations").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).collect(),
    ctx.db.query("venuePermissions").withIndex("by_strategyAccountId_venue", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).collect(),
    ctx.db.query("managedSpotMandates").withIndex("by_strategyAccountId", (q: any) =>
      q.eq("strategyAccountId", strategyAccount._id)).collect(),
  ]);
  const candidate = assignment.assignment ?? assignment.staged;
  const relevantMandates = mandates.filter((row: any) =>
    row.assignmentId === candidate?._id && row.status !== "closed");
  const vaultMandate = relevantMandates.length === 1 ? relevantMandates[0] : null;
  const selectedWallet = selectMobileMagicWallet(walletRows, user._id, strategyAccount,
    vaultMandate?.ownerAddress ?? user.walletAddress);
  const wallet = selectedWallet?.ownerVerifiedAt && selectedWallet.accountMode === "eip7702"
    ? selectedWallet : null;
  const explicitAssignmentReady = ["active", "paused"].includes(assignment.state)
    && candidate?.source === "explicit" && candidate.userId === user._id
    && candidate.strategyAccountId === strategyAccount._id
    && relevantMandates.length <= 1
    && candidate.controllerMode === "autopilot" && Boolean(assignment.version?.policyJson);
  const frozenPolicy = assignment.version
    ? parseFrozenRiskPolicy(assignment.version.policyJson) : null;
  const riskPolicyReady = Boolean(frozenPolicy), walletReady = hasObservedMagicDelegation(wallet);
  const creditReady = Number(credit?.balance ?? 0) - Number(credit?.reserved ?? 0) > 0, now = Date.now();
  const venues = (frozenPolicy?.allowedVenues ?? []).map((venue) => {
    const matchingIntegrations = integrations.filter((row: any) => row.venue === venue
      && row.enabled && row.routingEnabled && row.status === "ready" && row.authorityMode === "autopilot");
    const matchingAccounts = venueAccounts.filter((row: any) => row.venue === venue
      && row.status === "ready" && row.legacy !== true && row.lastSyncStatus === "fresh"
      && (!vaultMandate || (row.role === "arbitrum_managed_vault"
        && row._id === vaultMandate.venueAccountId)));
    const matchingPermissions = permissions.filter((row: any) => row.venue === venue
      && row.status === "active" && row.authorityMode === "autopilot" && row.chainId === 42161
      && row.expiresAt !== undefined && row.expiresAt > now
      && String(row.ownerAddress).toLowerCase() === String(wallet?.ownerAddress ?? "").toLowerCase()
      && (!vaultMandate || (() => { try {
        const limits = JSON.parse(row.limitsJson);
        return limits.source === "managed_spot_vault_v1"
          && limits.mandateId === String(vaultMandate._id)
          && limits.vaultAddress === vaultMandate.vaultAddress;
      } catch { return false; } })()));
    return { venue, integration: matchingIntegrations.length === 1 ? matchingIntegrations[0] : null,
      account: matchingAccounts.length === 1 ? matchingAccounts[0] : null,
      permission: matchingPermissions.length === 1 ? matchingPermissions[0] : null };
  });
  const venueAuthorityReady = Boolean(venues.length && venues.every((item) =>
    item.integration && item.account && item.permission));
  const fundingOperation = vaultMandate?.status === "vault_ready"
    ? await ctx.db.query("managedSpotFundingOperations")
      .withIndex("by_mandateId", (q: any) => q.eq("mandateId", vaultMandate._id))
      .order("desc").first()
    : null;
  const authorityReceiptReady = Boolean(candidate && assignment.version && wallet?.ownerAddress
    && venueAuthorityReady && await managedProgramActivationReceiptsReady(ctx, {
      strategyAccountId: String(strategyAccount._id), assignmentId: String(candidate._id),
      programVersionId: String(assignment.version._id), contentHash: assignment.version.contentHash,
      ownerAddress: String(wallet.ownerAddress), venues: venues.map((item) => ({
        venue: item.venue, venueAccountId: String(item.account?._id ?? ""),
      })), now,
    }));
  // Convex financial projections are display-only; only this internal receipt set
  // can grant the mobile activation gate.
  const durableStartReady = authorityReceiptReady;
  const modeConfirmationRequired = assignment.state === "paused" && assignment.staged?.controllerMode !== "autopilot";
  const assignmentBlocker = assignment.state === "paused" && modeConfirmationRequired
    ? "Confirm Autopilot for this staged managed program before preparing its owner-signed venue grant."
    : assignment.state === "paused"
      ? "The managed program assignment is staged and needs backed native activation before it can start."
    : assignment.state === "invalid_assignment"
      ? "The managed program assignment failed its ownership or version checks."
      : assignment.state === "active" && assignment.assignment?.source === "explicit"
        && assignment.assignment.controllerMode !== "autopilot"
        ? "Select and confirm Autopilot for this managed program assignment."
      : "An explicit, owned program assignment is required before Autopilot can start.";
  const blockers: string[] = [];
  if (!explicitAssignmentReady) blockers.push(assignmentBlocker);
  if (!riskPolicyReady) blockers.push("The assigned program's frozen risk policy could not be verified.");
  if (!walletReady) blockers.push("Verify the Arbitrum owner account before Autopilot can start.");
  if (!creditReady) blockers.push("Add Moeazi credits before Autopilot can start.");
  if (!venueAuthorityReady) blockers.push(fundingOperation
    && ["submitting", "submitted", "uncertain"].includes(fundingOperation.status)
    ? "Vault funding was submitted. Autopilot will stay paused until Arbitrum finality and finance activation complete."
    : "Verify time-bounded Autopilot authority for every venue in the assigned risk policy.");
  if (!durableStartReady) blockers.push(MANAGED_PROGRAM_AUTHORITY_UNAVAILABLE);
  const activationReady = explicitAssignmentReady && riskPolicyReady && walletReady && creditReady && venueAuthorityReady && durableStartReady;
  return { assignmentReady: activationReady, activationReady, explicitAssignmentReady, riskPolicyReady,
    walletReady, creditReady, venueAuthorityReady, authorityReceiptReady, consentRequired: true,
    durableStartReady, modeConfirmationRequired, activationBlockers: blockers };
}

async function buildHome(ctx: any) {
  const { identity, user, strategyAccount } = await viewer(ctx);
  if (!strategyAccount) return {
    schemaVersion: SCHEMA_VERSION, totalBalanceUsd: "0.00", managedBalanceUsd: "0.00",
    walletBalanceUsd: "0.00", managedVaultCapitalUsdc: null,
    availableCredits: 0, aiState: "blocked", primaryAction: "fix_issue",
    statusMessage: "Your Moeazi account needs to finish setup.", blockingReason: "Open Moeazi on the web once to finish account setup.",
    assignmentState: "unassigned", assignmentId: null, managedPositionClosureUnconfirmed: false,
    programVersionId: null, controllerRef: null,
  };
  const [wallet, snapshot, credit, assignment, policy, config, venues, mandates] = await Promise.all([
    mobileMagicWallet(ctx, user, strategyAccount, identity.walletAddress),
    ctx.db.query("balanceSnapshots").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).order("desc").first(),
    ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) => q.eq("userId", user._id)).first(),
    assignmentForAccount(ctx, strategyAccount._id, user._id),
    ctx.db.query("automationPolicies").withIndex("by_strategyAccountId_status", (q: any) => q.eq("strategyAccountId", strategyAccount._id).eq("status", "active")).first(),
    ctx.db.query("strategyConfigs").withIndex("by_strategyAccountId_active", (q: any) => q.eq("strategyAccountId", strategyAccount._id).eq("active", true)).first(),
    ctx.db.query("venueAccounts").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).collect(),
    ctx.db.query("managedSpotMandates").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).collect(),
  ]);
  const managedEquity = Number(snapshot?.totalEquityUsd ?? 0);
  const hasDirectWalletProjection = wallet?.arbitrumUsdcBalance !== undefined;
  const walletTradingBalance = Number(wallet?.arbitrumUsdcBalance ?? wallet?.unifiedBalanceUsd ?? 0);
  const total = hasDirectWalletProjection
    ? walletTradingBalance + managedEquity
    : Number(snapshot?.totalEquityUsd ?? wallet?.unifiedBalanceUsd ?? 0);
  const availableCredits = Math.max(0, Number(credit?.balance ?? 0) - Number(credit?.reserved ?? 0));
  const policyValues = parse(policy?.policyJson);
  const owner = String(identity.walletAddress ?? user.walletAddress ?? "").toLowerCase();
  const activeMandates = mandates.filter((row: any) => row.status === "active"
    && row.userId === user._id && row.ownerAddress === owner
    && String(row.assignmentId) === String(assignment.assignment?._id ?? assignment.staged?._id)
    && String(row.programVersionId) === String(assignment.version?._id)
    && /^[1-9][0-9]*$/.test(row.capitalUnits));
  const managedVaultCapitalUsdc = activeMandates.length === 1
    ? formatUnits(BigInt(activeMandates[0].capitalUnits), 6) : null;
  const managed = managedVaultCapitalUsdc !== null ? Number(managedVaultCapitalUsdc)
    : assignment.assignment ? Math.min(managedEquity,
      Number(policyValues.managedAmountUsd ?? config?.maxDailyVolumeUsd ?? managedEquity)) : 0;
  const venueReady = venues.some((row: any) => ["ready", "active"].includes(row.status));
  const currentManagedAssignment = assignment.assignment ?? assignment.staged;
  const closureAuthorities = currentManagedAssignment
    ? await ctx.db.query("managedProgramActivationAuthorities")
      .withIndex("by_assignmentId", (q: any) => q.eq("assignmentId", currentManagedAssignment._id)).collect()
    : [];
  const managedPositionClosureUnconfirmed = Boolean(currentManagedAssignment
    && currentManagedAssignment.source === "explicit" && currentManagedAssignment.controllerMode === "autopilot"
    && (currentManagedAssignment.positionClosureState === "unconfirmed"
      || (currentManagedAssignment.positionClosureState !== "confirmed_flat"
        && (currentManagedAssignment.status === "active" || closureAuthorities.some((receipt: any) => receipt.state === "revoked")))));
  const agentReleaseView = await managedAgentReleaseSummary(ctx, assignment.version);
  const result = { schemaVersion: SCHEMA_VERSION, totalBalanceUsd: money(total), managedBalanceUsd: money(managed),
    walletBalanceUsd: money(walletTradingBalance), managedVaultCapitalUsdc,
    availableCredits,
    assignmentState: assignment.state, assignmentId: assignment.assignment?._id ?? assignment.staged?._id ?? null,
    managedPositionClosureUnconfirmed,
    programVersionId: assignment.version?._id ?? null,
    ...agentReleaseView,
    controllerRef: (assignment.assignment ?? assignment.staged) && assignment.version ? {
      schemaVersion: 1, environment: "live", strategyAccountId: String(strategyAccount._id),
      controllerKind: "managed_program", controllerId: String((assignment.assignment ?? assignment.staged)._id),
      controllerVersionId: String(assignment.version._id), contentHash: assignment.version.contentHash,
    } : null } as any;
  if (strategyAccount.emergencyStop) return { ...result, aiState: "emergency_stopped", primaryAction: "review_safety", statusMessage: "All new trading activity is stopped." };
  if (!assignment.assignment && !assignment.staged) return { ...result, aiState: "blocked", primaryAction: "fix_issue",
    statusMessage: assignment.state === "paused" ? "Your managed program assignment is paused." : "No managed program is assigned to this account.",
    blockingReason: assignment.state === "paused" ? "Managed program activation is awaiting release qualification."
      : assignment.state === "invalid_assignment" ? "The managed program assignment failed its ownership or version checks."
        : assignment.state === "ambiguous_assignment" ? "More than one active managed program assignment needs release review."
          : "A managed program assignment is required before the AI trader can start." };
  if (assignment.state === "paused" && assignment.staged) {
    const eligibility = await managedProgramActivationEligibility(ctx, user, strategyAccount);
    return { ...result, aiState: "paused", primaryAction: eligibility.activationReady ? "start" : "fix_issue",
      statusMessage: "The managed assignment is paused. New entries are blocked; existing positions are not reported closed.",
      ...(!eligibility.activationReady ? { blockingReason: eligibility.activationBlockers[0] ?? MANAGED_PROGRAM_AUTHORITY_UNAVAILABLE } : {}) };
  }
  const eligibility = await managedProgramActivationEligibility(ctx, user, strategyAccount);
  if (assignment.assignment?.shadowCadenceEnabled === true) {
    const authorityReason = eligibility.activationBlockers[0] ?? MANAGED_PROGRAM_AUTHORITY_UNAVAILABLE;
    return { ...result,
      aiState: "scheduled",
      primaryAction: "stop",
      statusMessage: eligibility.activationReady
        ? "Autopilot is on. Moeazi is scheduled to check the markets and will show each decision here."
        : "Autopilot is on, but a current trading check needs attention. New trades may be blocked.",
      ...(!eligibility.activationReady ? { blockingReason: authorityReason } : {}) };
  }
  if (total <= 0) return { ...result, aiState: "needs_funds", primaryAction: "deposit", statusMessage: "Add USDC on Arbitrum before the AI can trade." };
  if (availableCredits <= 0) return { ...result, aiState: "needs_credits", primaryAction: "buy_credits", statusMessage: "You need Moeazi credits to run the AI." };
  if (wallet && wallet.accountMode === "eip7702" && !wallet.eip7702Delegated) return { ...result, aiState: "blocked", primaryAction: "fix_issue", statusMessage: "Secure your AI trader before it can start.", blockingReason: "One-time Arbitrum account activation is required." };
  if (!wallet || !policy || !config || !venueReady) {
    const reason = !wallet ? "Your trading account is not ready." : !policy || !config ? "Your conservative limits need to be configured." : "A trading connection needs attention.";
    return { ...result, aiState: "blocked", primaryAction: "fix_issue", statusMessage: "The AI trader needs your attention.", blockingReason: reason };
  }
  if (eligibility.activationReady) return { ...result, aiState: "ready", primaryAction: "start",
    statusMessage: "The managed program passed current start checks. Starting enables scheduled analysis; any live order requires separate risk and execution checks." };
  return { ...result, aiState: "blocked", primaryAction: "fix_issue",
    statusMessage: "The managed program cannot start its scheduled analysis yet.",
    blockingReason: eligibility.activationBlockers[0] ?? MANAGED_PROGRAM_AUTHORITY_UNAVAILABLE };
}

export const registerSession = mutation({
  args: { deviceId: v.string(), deviceName: v.string(), refreshJtiHash: v.string(), authChallengeHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const { user } = await viewer(ctx, true); const now = Date.now();
    const existing = await ctx.db.query("mobileSessions").withIndex("by_userId_deviceId", (q: any) => q.eq("userId", user._id).eq("deviceId", args.deviceId)).first();
    if (!/^[a-f0-9]{64}$/.test(args.authChallengeHash)) throw new Error("The sign-in challenge hash is invalid.");
    const usedChallenge = await ctx.db.query("mobileAuthChallenges")
      .withIndex("by_challengeHash", (q: any) => q.eq("challengeHash", args.authChallengeHash)).first();
    if (usedChallenge) throw new Error("This sign-in challenge was already used.");
    await ctx.db.insert("mobileAuthChallenges", { challengeHash: args.authChallengeHash,
      userId: user._id, deviceId: args.deviceId, expiresAt: now + 5 * 60_000,
      consumedAt: now, createdAt: now });
    const { authChallengeHash, ...session } = args;
    const values = { ...session, lastAuthChallengeHash: authChallengeHash, userId: user._id, status: "active" as const, revokedAt: undefined, updatedAt: now, createdAt: existing?.createdAt ?? now };
    if (existing) { await ctx.db.patch(existing._id, values); return existing._id; }
    return await ctx.db.insert("mobileSessions", values);
  },
});

export const getSession = query({ args: { deviceId: v.string() }, handler: async (ctx, args) => {
  const { user } = await viewer(ctx);
  const session = await ctx.db.query("mobileSessions").withIndex("by_userId_deviceId", (q: any) => q.eq("userId", user._id).eq("deviceId", args.deviceId)).first();
  return session ? { status: session.status, refreshJtiHash: session.refreshJtiHash, expiresAt: session.expiresAt } : null;
} });

export const rotateSession = mutation({ args: { deviceId: v.string(), previousJtiHash: v.string(), refreshJtiHash: v.string(), expiresAt: v.number() }, handler: async (ctx, args) => {
  const { user } = await viewer(ctx); const session = await ctx.db.query("mobileSessions").withIndex("by_userId_deviceId", (q: any) => q.eq("userId", user._id).eq("deviceId", args.deviceId)).first();
  if (!session || session.status !== "active" || session.refreshJtiHash !== args.previousJtiHash || session.expiresAt <= Date.now()) throw new Error("Mobile refresh credential was revoked or already used.");
  await ctx.db.patch(session._id, { refreshJtiHash: args.refreshJtiHash, expiresAt: args.expiresAt, lastRefreshedAt: Date.now(), updatedAt: Date.now() });
  return { rotated: true };
} });

export const revokeSession = mutation({ args: { deviceId: v.string() }, handler: async (ctx, args) => {
  const { user } = await viewer(ctx); const session = await ctx.db.query("mobileSessions").withIndex("by_userId_deviceId", (q: any) => q.eq("userId", user._id).eq("deviceId", args.deviceId)).first();
  if (session) await ctx.db.patch(session._id, { status: "revoked", revokedAt: Date.now(), updatedAt: Date.now() });
  return { revoked: Boolean(session) };
} });

export const pruneExpiredAuthChallenges = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(500, Math.floor(args.limit ?? 500)));
    const expired = await ctx.db.query("mobileAuthChallenges")
      .withIndex("by_expiresAt", (q: any) => q.lte("expiresAt", Date.now())).take(limit);
    for (const row of expired) await ctx.db.delete(row._id);
    return { deleted: expired.length, limit };
  },
});

export const getHome = query({ args: {}, handler: async () => assertMobileChainActionsPaused() });

export const getAutopilotLimits = query({ args: {}, handler: async (ctx) => {
  assertMobileChainActionsPaused();
  const { identity, user, strategyAccount } = await viewer(ctx); if (!strategyAccount) return null;
  const [credit, policy, config, venues, mandates] = await Promise.all([
    ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) => q.eq("userId", user._id)).first(),
    ctx.db.query("automationPolicies").withIndex("by_strategyAccountId_status", (q: any) => q.eq("strategyAccountId", strategyAccount._id).eq("status", "active")).first(),
    ctx.db.query("strategyConfigs").withIndex("by_strategyAccountId_active", (q: any) => q.eq("strategyAccountId", strategyAccount._id).eq("active", true)).first(),
    ctx.db.query("venueAccounts").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).collect(),
    ctx.db.query("managedSpotMandates").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccount._id)).collect(),
  ]);
  const snapshot = await buildHome(ctx);
  const eligibility = await managedProgramActivationEligibility(ctx, user, strategyAccount);
  const owner = String(identity.walletAddress ?? user.walletAddress ?? "").toLowerCase();
  const funded = mandates.filter((row: any) => row.status === "active"
    && row.userId === user._id && String(row.assignmentId) === String(snapshot.assignmentId)
    && String(row.programVersionId) === String(snapshot.programVersionId)
    && row.ownerAddress === owner && row.vaultAddress && row.venueAccountId
    && /^[1-9][0-9]*$/.test(row.capitalUnits));
  const managedVaultCapitalUsdc = funded.length === 1
    ? formatUnits(BigInt(funded[0].capitalUnits), 6) : null;
  const managedVaultAddress = funded.length === 1 ? funded[0].vaultAddress : null;
  const assignedVersion: any = snapshot.programVersionId
    ? await ctx.db.get(snapshot.programVersionId)
    : null;
  const frozenLimits = assignedVersion
    ? parseFrozenRiskPolicy(assignedVersion.policyJson) : null;
  const frozenCadence = assignedVersion
    ? parse(assignedVersion.teamConfigJson).cadence : null;
  const values = frozenLimits ?? parse(policy?.policyJson);
  return {
    version: `${policy?.version ?? 0}:${config?.version ?? 0}`,
    managedAmountUsd: snapshot.managedBalanceUsd,
    managedVaultCapitalUsdc,
    managedVaultAddress,
    allowedMarkets: Array.isArray(values.allowedMarkets) ? values.allowedMarkets : config?.allowedPairs ?? [],
    maxPositionUsd: money(Number(frozenLimits?.maxExposureUsd
      ?? values.maxPositionUsd ?? config?.maxSingleActionUsd ?? config?.maxArbTradeUsd ?? 0)),
    maxSingleOrderUsd: frozenLimits ? money(frozenLimits.maxOrderUsd) : null,
    maxDailyLossUsd: frozenLimits ? money(frozenLimits.maxDailyLossUsd) : null,
    dailyLossStopPercent: `${Number(values.dailyLossStopPercent ?? config?.maxDailyDrawdownPct ?? 0)}%`,
    cadenceLabel: frozenCadence === "on_demand" ? "On demand"
      : ["1m", "2m", "5m", "15m"].includes(frozenCadence)
        ? `Every ${frozenCadence.slice(0, -1)} minutes`
        : values.cadenceLabel ?? (config ? `Every ${Math.max(1, Math.round(config.pollIntervalSeconds / 60))} minutes` : "Not configured"),
    availableCredits: Math.max(0, Number(credit?.balance ?? 0) - Number(credit?.reserved ?? 0)),
    assignmentState: snapshot.assignmentState, assignmentId: snapshot.assignmentId,
    programVersionId: snapshot.programVersionId, controllerRef: snapshot.controllerRef,
    agentReleaseVersionId: snapshot.agentReleaseVersionId, agentModels: snapshot.agentModels,
    ...eligibility,
    venueReady: venues.some((row: any) => ["ready", "active"].includes(row.status)),
  };
} });

export const getUaOperation = query({ args: { operationId: v.string() }, handler: async (ctx, args) => {
  assertMobileChainActionsPaused();
  const { user } = await viewer(ctx); const operation = await ctx.db.query("mobileUaOperations").withIndex("by_userId_operationId", (q: any) => q.eq("userId", user._id).eq("operationId", args.operationId)).first();
  if (!operation) return null;
  return { operationId: operation.operationId, status: operation.status, chainId: operation.chainId, normalizedIntentHash: operation.normalizedIntentHash, expiresAt: operation.expiresAt, updatedAt: operation.updatedAt };
} });

export const startAutopilot = mutation({ args: { confirmed: v.boolean() }, handler: async (ctx, args) => {
  assertMobileChainActionsPaused();
  if (!args.confirmed) throw new Error("Review and accept the current limits before starting.");
  const { user, strategyAccount } = await viewer(ctx); if (!strategyAccount) throw new Error("Strategy account is not ready.");
  const moneyOperations = await ctx.db.query("mobileConnectorOperations").withIndex("by_subject", (q: any) => q.eq("subject", user.authSubject ?? "")).collect();
  if (moneyOperations.some(row => row.kind !== "purchase" && !["completed", "failed", "cancelled", "expired"].includes(row.status) && (!["prepared", "authorization_required"].includes(row.status) || row.expiresAt > Date.now()))) throw new Error("Finish your wallet operation before starting the AI.");
  const eligibility = await managedProgramActivationEligibility(ctx, user, strategyAccount);
  if (!eligibility.assignmentReady) throw new Error(eligibility.activationBlockers[0] ?? "Managed program activation is unavailable.");
  const selected = await assignmentForAccount(ctx, strategyAccount._id, user._id);
  const assignment = selected.assignment ?? selected.staged;
  if (!assignment || assignment.source !== "explicit" || assignment.controllerMode !== "autopilot") {
    throw new Error("The exact backed Autopilot assignment is unavailable.");
  }
  if (assignment.status === "active" && assignment.shadowCadenceEnabled === true) {
    return await buildHome(ctx);
  }
  const now = Date.now();
  await ctx.db.patch(assignment._id, { status: "active", shadowCadenceEnabled: true,
    positionClosureState: "unconfirmed", positionClosureUpdatedAt: now, updatedAt: now });
  const schedule = await getManagedProgramScheduleState(ctx, String(assignment._id), user.authSubject);
  if (!schedule.active) throw new Error("The frozen managed program cannot be scheduled with its current configuration.");
  await ctx.scheduler.runAfter(0, internal.managedProgramCadenceActions.syncManagedProgramSchedule,
    { assignmentId: assignment._id });
  await ctx.db.insert("auditEvents", { strategyAccountId: strategyAccount._id, userId: user._id,
    actor: "mobile", kind: "agent.autopilot.started",
    summary: "Managed Autopilot analysis cadence enabled from mobile",
    detail: JSON.stringify({ assignmentId: String(assignment._id), programVersionId: String(assignment.programVersionId),
      authorityReceiptAccepted: true, temporalScheduleSync: "requested", tradeOrPositionConfirmed: false }),
    refTable: "programAssignments", refId: String(assignment._id), createdAt: now });
  const snapshot = await buildHome(ctx);
  return { ...snapshot, aiState: "starting", primaryAction: "stop",
    statusMessage: "Managed analysis cadence was enabled and Temporal sync was requested. Any order still requires a grounded proposal and current risk and execution checks; no trade or position is confirmed." };
} });

/** Records the customer's requested mode while keeping a staged assignment paused. */
export const confirmAutopilotMode = mutation({ args: { confirmed: v.boolean() }, handler: async (ctx, args) => {
  assertMobileChainActionsPaused();
  if (!args.confirmed) throw new Error("Confirm the managed program's Autopilot mode to continue.");
  const { user, strategyAccount } = await viewer(ctx);
  if (!strategyAccount) throw new Error("Strategy account is not ready.");
  const selected = await assignmentForAccount(ctx, strategyAccount._id, user._id);
  const assignment = selected.staged;
  if (selected.state !== "paused" || !assignment || assignment.userId !== user._id
      || assignment.strategyAccountId !== strategyAccount._id || assignment.source !== "explicit"
      || assignment.status !== "paused" || assignment.shadowCadenceEnabled === true) {
    throw new Error("Only the exact owned paused managed program can accept a mode confirmation.");
  }
  const policy = parseFrozenRiskPolicy(selected.version?.policyJson);
  if (!policy || policy.allowedVenues.length !== 1 || policy.allowedVenues[0] !== "uniswap") {
    throw new Error("This mobile Autopilot confirmation requires the frozen Uniswap-only program policy.");
  }
  if (!["ready", "active"].includes(strategyAccount.status) || strategyAccount.emergencyStop) {
    throw new Error("The Magic strategy account is not available for managed setup.");
  }
  if (strategyAccount.status === "ready") {
    await ctx.db.patch(strategyAccount._id, { status: "active", updatedAt: Date.now() });
  }
  if (assignment.controllerMode !== "autopilot") {
    const now = Date.now();
    await ctx.db.patch(assignment._id, { controllerMode: "autopilot", shadowCadenceEnabled: false, updatedAt: now });
    await ctx.db.insert("auditEvents", { strategyAccountId: strategyAccount._id, userId: user._id,
      actor: "mobile", kind: "managed_program.autopilot_mode_confirmed",
      summary: "Customer confirmed Autopilot mode for a paused managed program",
      detail: JSON.stringify({ assignmentId: String(assignment._id), programVersionId: String(assignment.programVersionId),
        controllerMode: "autopilot", cadenceEnabled: false, started: false }),
      refTable: "programAssignments", refId: String(assignment._id), createdAt: now });
  }
  return { assignmentId: String(assignment._id), assignmentStatus: "paused" as const,
    controllerMode: "autopilot" as const, cadenceEnabled: false, started: false,
    activationBlockers: (await managedProgramActivationEligibility(ctx, user, strategyAccount)).activationBlockers };
} });

export const stopAutopilot = mutation({ args: {}, handler: async (ctx) => {
  assertMobileChainActionsPaused();
  const { user, strategyAccount } = await viewer(ctx); if (!strategyAccount) throw new Error("Strategy account is not ready."); const now = Date.now();
  const selected = await assignmentForAccount(ctx, strategyAccount._id, user._id);
  const current = selected.assignment ?? selected.staged;
  const assignments = current && current.userId === user._id
    && current.strategyAccountId === strategyAccount._id && current.source === "explicit"
    && ["active", "paused"].includes(current.status) ? [current] : [];
  if (!assignments.length) return await buildHome(ctx);
  const changed = assignments.filter((assignment: any) =>
    assignment.status !== "paused" || assignment.shadowCadenceEnabled === true);
  const invalidatedByAssignment = new Map<string, number>();
  const revokedAuthoritiesByAssignment = new Map<string, number>();
  const closeOnlyUniswapGrants = new Map<string, { grantId: string; ownerAddress: string;
    strategyAccountId: string; assignmentId: string; policyHash: string; expiresAt: number }>();
  for (const assignment of assignments) {
    if (changed.some((item: any) => item._id === assignment._id)) {
      await ctx.db.patch(assignment._id, { status: "paused", shadowCadenceEnabled: false,
        positionClosureState: "unconfirmed", positionClosureUpdatedAt: now, updatedAt: now });
    }
    const authorities = await ctx.db.query("managedProgramActivationAuthorities")
      .withIndex("by_assignmentId", (q: any) => q.eq("assignmentId", assignment._id)).collect();
    let revokedAuthorityCount = 0;
    for (const receipt of authorities.filter((item: any) => item.venue === "uniswap"
      && typeof item.executionGrantId === "string" && item.executionGrantId)) {
      closeOnlyUniswapGrants.set(String(receipt.executionGrantId), {
        grantId: receipt.executionGrantId, ownerAddress: receipt.ownerAddress,
        strategyAccountId: String(receipt.strategyAccountId), assignmentId: String(receipt.assignmentId),
        policyHash: receipt.executionGrantHash, expiresAt: receipt.expiresAt,
      });
    }
    for (const receipt of authorities.filter((item: any) => item.state !== "revoked")) {
      const revoked = { source: receipt.source, state: "revoked" as const,
        strategyAccountId: String(receipt.strategyAccountId), assignmentId: String(receipt.assignmentId),
        programVersionId: String(receipt.programVersionId), contentHash: receipt.contentHash,
        ownerAddress: receipt.ownerAddress, financeSnapshotHash: receipt.financeSnapshotHash,
        accountRevision: receipt.accountRevision, writerEpoch: receipt.writerEpoch,
        authorityEpoch: receipt.authorityEpoch, venue: receipt.venue,
        venueAccountId: String(receipt.venueAccountId), executionGrantId: receipt.executionGrantId,
        executionGrantHash: receipt.executionGrantHash, expiresAt: receipt.expiresAt };
      await ctx.db.patch(receipt._id, { state: "revoked",
        receiptHash: await managedProgramActivationAuthorityHash(revoked) });
      revokedAuthorityCount += 1;
    }
    const proposals = await ctx.db.query("tradeProposals")
      .withIndex("by_programAssignmentId", (q: any) => q.eq("programAssignmentId", assignment._id)).collect();
    const prepared = proposals.filter((proposal: any) => ["pending_approval", "approved"].includes(proposal.status));
    for (const proposal of prepared) {
      await ctx.db.patch(proposal._id, { status: "blocked", decidedAt: now, updatedAt: now });
      const approvals = await ctx.db.query("approvalRequests")
        .withIndex("by_proposalId", (q: any) => q.eq("proposalId", proposal._id)).collect();
      for (const approval of approvals.filter((item: any) => item.status === "pending")) {
        await ctx.db.patch(approval._id, { status: "expired", decidedAt: now, updatedAt: now });
      }
    }
    invalidatedByAssignment.set(String(assignment._id), prepared.length);
    revokedAuthoritiesByAssignment.set(String(assignment._id), revokedAuthorityCount);
    await ctx.scheduler.runAfter(0, internal.managedProgramCadenceActions.syncManagedProgramSchedule,
      { assignmentId: assignment._id });
  }
  for (const assignment of assignments.filter((item: any) => changed.includes(item)
    || (invalidatedByAssignment.get(String(item._id)) ?? 0) > 0
    || (revokedAuthoritiesByAssignment.get(String(item._id)) ?? 0) > 0)) await ctx.db.insert("auditEvents", { strategyAccountId: strategyAccount._id, userId: user._id,
    actor: "mobile", kind: "agent.autopilot.stopped",
    summary: "New managed AI entries blocked from mobile",
    detail: JSON.stringify({ invalidatedPreparedEntries: invalidatedByAssignment.get(String(assignment._id)) ?? 0,
      revokedActivationAuthorities: revokedAuthoritiesByAssignment.get(String(assignment._id)) ?? 0,
      newEntriesBlockedImmediately: true,
      temporalScheduleCleanup: "requested", positionClosure: "unconfirmed" }),
    refTable: "programAssignments", refId: String(assignment._id), createdAt: now });
  const snapshot = await buildHome(ctx);
  return { ...snapshot, closeOnlyUniswapGrants: [...closeOnlyUniswapGrants.values()],
    ...(!strategyAccount.emergencyStop ? { aiState: "paused", primaryAction: snapshot.primaryAction === "start" ? "start" : "fix_issue" } : {}),
    statusMessage: strategyAccount.emergencyStop
      ? "All new trading activity is stopped. Temporal schedule cleanup was requested; position closure is not confirmed."
      : "New entries are blocked. Temporal schedule cleanup was requested; position closure is not confirmed." };
} });
