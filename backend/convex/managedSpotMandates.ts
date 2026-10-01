import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByAuthSubject } from "./model";
import { controllerHash } from "../lib/programOwnership";
import { operatorOwnedProgramSource, verifyFrozenProgramVersion } from "./mobile";
import { parseAutomationPolicy } from "./helpers/agentPolicy";
import { hasObservedMagicDelegation, mobileMagicAccount,
  selectMobileMagicWallet } from "./mobileMagicWallet";

const OWNER = /^0x[a-f0-9]{40}$/;
const UNITS = /^[1-9][0-9]{0,17}$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const DAYS = new Set([1, 7, 14, 30]);

function decimalUsdc(value: unknown): bigint {
  const text = String(value);
  if (!/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(text)) {
    throw new Error("The frozen policy has no exact USDC order ceiling.");
  }
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0");
}

async function ownedAssignment(ctx: any, subject: string, ownerAddress: string) {
  const user = await getUserByAuthSubject(ctx, subject);
  const selected = user ? await mobileMagicAccount(ctx, user, ownerAddress) : null;
  const state = { user, strategyAccount: selected?.strategyAccount ?? null };
  if (!state.user || !state.strategyAccount) throw new Error("The signed-in strategy account is unavailable.");
  const wallets = await ctx.db.query("accountWallets")
    .withIndex("by_userId", (q: any) => q.eq("userId", state.user._id)).collect();
  const owned = selectMobileMagicWallet(wallets, state.user._id, state.strategyAccount, ownerAddress);
  if (!hasObservedMagicDelegation(owned)) {
    throw new Error("The Magic owner does not match this strategy account.");
  }
  const assignments = await ctx.db.query("programAssignments")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
  const eligible = assignments.filter((row: any) => row.userId === state.user._id
    && row.source === "explicit" && row.controllerMode === "autopilot"
    && ["paused", "active"].includes(row.status));
  if (eligible.length !== 1) throw new Error("One explicit Autopilot program assignment is required.");
  const assignment = eligible[0];
  const version = await ctx.db.get(assignment.programVersionId);
  if (!version || version.runtimeCompatibility !== "agent-v1"
    || !await operatorOwnedProgramSource(ctx, version)
    || !await verifyFrozenProgramVersion(version)) {
    throw new Error("The assigned program version is unavailable or failed integrity checks.");
  }
  const policy = parseAutomationPolicy(version.policyJson);
  if (policy.allowedVenues.length !== 1 || policy.allowedVenues[0] !== "uniswap"
    || !policy.allowedMarkets.some((market: string) =>
      ["WETH-USDC", "ETH-USDC", "ETH/USDC", "WETH/USDC"].includes(market))) {
    throw new Error("The assigned program is not the qualified Arbitrum spot route.");
  }
  return { state, assignment, version, policy };
}

export const request = mutation({
  args: { capitalUnits: v.string(), durationDays: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.authProvider !== "magic") throw new Error("Magic authentication is required.");
    const ownerAddress = String(identity.walletAddress ?? "").toLowerCase();
    if (!OWNER.test(ownerAddress) || !UNITS.test(args.capitalUnits)
      || !DAYS.has(args.durationDays) || !KEY.test(args.idempotencyKey)) {
      throw new Error("Choose an exact capital amount, supported period, and stable request key.");
    }
    const { state, assignment, version, policy } = await ownedAssignment(ctx, identity.subject, ownerAddress);
    const requested = BigInt(args.capitalUnits);
    const orderCeiling = decimalUsdc(policy.maxOrderUsd);
    if (orderCeiling === 0n) throw new Error("The frozen program does not permit a spot order.");
    const maxBuyUnits = requested < orderCeiling ? requested : orderCeiling;
    const existing = await ctx.db.query("managedSpotMandates")
      .withIndex("by_strategyAccountId_idempotencyKey", (q) =>
        q.eq("strategyAccountId", state.strategyAccount._id).eq("idempotencyKey", args.idempotencyKey)).first();
    if (existing) {
      if (existing.ownerAddress !== ownerAddress || existing.assignmentId !== assignment._id
        || existing.programVersionId !== version._id || existing.capitalUnits !== args.capitalUnits
        || existing.durationDays !== args.durationDays) throw new Error("Mandate request key was reused for different terms.");
      return { mandateId: existing._id, mandateHash: existing.mandateHash,
        status: existing.status, vaultAddress: existing.vaultAddress ?? null };
    }
    const now = Date.now();
    const prior = await ctx.db.query("managedSpotMandates")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
    for (const row of prior) {
      if (row.status === "closed" || row.status === "expired_unfunded") continue;
      if (row.status === "awaiting_vault" && row.expiresAt <= now
        && !row.provisioningState && !row.vaultAddress && !row.fundingOperationId
        && !(await ctx.db.query("managedSpotFundingOperations")
          .withIndex("by_mandateId", (q) => q.eq("mandateId", row._id)).first())) {
        await ctx.db.patch(row._id, { status: "expired_unfunded", updatedAt: now });
        continue;
      }
      throw new Error("Resolve the existing mandate and any open exposure before starting another.");
    }
    // The vault stores uint64 Unix seconds; freeze the same representable instant.
    const expiresAt = Math.floor(now / 1000) * 1000 + args.durationDays * 86_400_000;
    const body = { schemaVersion: 1, ownerAddress, strategyAccountId: String(state.strategyAccount._id),
      assignmentId: String(assignment._id), programVersionId: String(version._id),
      programHash: version.contentHash, policyHash: version.policyHash,
      capitalUnits: args.capitalUnits, maxBuyUnits: maxBuyUnits.toString(), expiresAt };
    const mandateHash = await controllerHash(body);
    const mandateId = await ctx.db.insert("managedSpotMandates", {
      userId: state.user._id, strategyAccountId: state.strategyAccount._id,
      assignmentId: assignment._id, programVersionId: version._id,
      ownerAddress, programHash: version.contentHash, policyHash: version.policyHash,
      capitalUnits: args.capitalUnits, maxBuyUnits: maxBuyUnits.toString(),
      durationDays: args.durationDays, expiresAt, mandateHash, idempotencyKey: args.idempotencyKey,
      status: "awaiting_vault", createdAt: now, updatedAt: now,
    });
    return { mandateId, mandateHash, status: "awaiting_vault" as const, vaultAddress: null };
  },
});

export const current = query({ args: {}, handler: async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.authProvider !== "magic") throw new Error("Magic authentication is required.");
  const user = await getUserByAuthSubject(ctx, identity.subject);
  const selected = user ? await mobileMagicAccount(ctx, user,
    typeof identity.walletAddress === "string" ? identity.walletAddress : undefined) : null;
  const state = { user, strategyAccount: selected?.strategyAccount ?? null };
  if (!state.user || !state.strategyAccount) return null;
  const rows = await ctx.db.query("managedSpotMandates")
    .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", state.strategyAccount._id)).collect();
  const latest = rows.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!latest || latest.userId !== state.user._id
    || latest.ownerAddress !== String(identity.walletAddress ?? "").toLowerCase()) return null;
  const fundingRows = await ctx.db.query("managedSpotFundingOperations")
    .withIndex("by_mandateId", (q) => q.eq("mandateId", latest._id)).collect();
  const funding = fundingRows.sort((a, b) => b.createdAt - a.createdAt)[0];
  return { mandateId: latest._id, mandateHash: latest.mandateHash,
    status: latest.status, ownerAddress: latest.ownerAddress,
    assignmentId: latest.assignmentId, programVersionId: latest.programVersionId,
    programHash: latest.programHash, policyHash: latest.policyHash,
    capitalUnits: latest.capitalUnits, maxBuyUnits: latest.maxBuyUnits,
    durationDays: latest.durationDays, expiresAt: latest.expiresAt,
    vaultAddress: latest.vaultAddress ?? null, vaultCodeHash: latest.vaultCodeHash ?? null,
    executorAddress: latest.executorAddress ?? null,
    provisioningState: latest.provisioningState ?? null,
    provisioningTransactionHash: latest.provisioningTransactionHash ?? null,
    venueAccountId: latest.venueAccountId ?? null,
    fundingTransactionHash: latest.fundingTransactionHash ?? null,
    stopFinalizedBlockNumber: latest.stopFinalizedBlockNumber ?? null,
    stopFinalizedBlockHash: latest.stopFinalizedBlockHash ?? null,
    releaseTransactionHash: latest.releaseTransactionHash ?? null,
    releaseAmountUnits: latest.releaseAmountUnits ?? null,
    releaseFinanceSnapshotHash: latest.releaseFinanceSnapshotHash ?? null,
    fundingOperation: funding ? { operationId: funding.operationId,
      status: funding.status, particleTransactionId: funding.particleTransactionId ?? null } : null };
} });

/** Internal deployment context contains no authority to move the Magic owner's funds. */
export const getProvisioningContext = internalQuery({
  args: { mandateId: v.id("managedSpotMandates") },
  handler: async (ctx, args) => {
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || mandate.status !== "awaiting_vault"
      || mandate.expiresAt <= Date.now() + 5 * 60_000) return null;
    const [user, account, assignment, version] = await Promise.all([
      ctx.db.get(mandate.userId), ctx.db.get(mandate.strategyAccountId),
      ctx.db.get(mandate.assignmentId), ctx.db.get(mandate.programVersionId),
    ]);
    if (!user || !account || !assignment || !version
      || account.userId !== user._id || account.status !== "active"
      || assignment.userId !== user._id || assignment.strategyAccountId !== account._id
      || assignment.programVersionId !== version._id || assignment.source !== "explicit"
      || assignment.controllerMode !== "autopilot"
      || !["paused", "active"].includes(assignment.status)
      || mandate.programHash !== version.contentHash
      || mandate.policyHash !== version.policyHash
      || !await operatorOwnedProgramSource(ctx, version)
      || !await verifyFrozenProgramVersion(version)) return null;
    const wallets = await ctx.db.query("accountWallets")
      .withIndex("by_userId", (q) => q.eq("userId", user._id)).collect();
    const wallet = selectMobileMagicWallet(wallets, user._id, account, mandate.ownerAddress);
    if (!hasObservedMagicDelegation(wallet)) return null;
    return { mandateId: String(mandate._id), mandateHash: mandate.mandateHash,
      ownerAddress: mandate.ownerAddress, programHash: mandate.programHash,
      policyHash: mandate.policyHash, capitalUnits: mandate.capitalUnits,
      maxBuyUnits: mandate.maxBuyUnits, expiresAt: mandate.expiresAt,
      provisioningState: mandate.provisioningState ?? null };
  },
});

/** One claim before a possible deployment side effect; retries inspect the factory. */
export const claimProvisioning = internalMutation({
  args: { mandateId: v.id("managedSpotMandates") },
  handler: async (ctx, args) => {
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || mandate.status !== "awaiting_vault"
      || mandate.expiresAt <= Date.now() + 5 * 60_000) return { claimed: false };
    if (mandate.provisioningState) return { claimed: false,
      state: mandate.provisioningState };
    await ctx.db.patch(mandate._id, { provisioningState: "claimed", updatedAt: Date.now() });
    return { claimed: true, state: "claimed" as const };
  },
});

export const recordProvisioningOutcome = internalMutation({
  args: { mandateId: v.id("managedSpotMandates"),
    state: v.union(v.literal("submitted"), v.literal("uncertain")),
    transactionHash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || mandate.status !== "awaiting_vault"
      || !mandate.provisioningState) throw new Error("Vault provisioning was not claimed.");
    if (args.transactionHash && !/^0x[a-f0-9]{64}$/.test(args.transactionHash)) {
      throw new Error("Deployment transaction hash is invalid.");
    }
    if (mandate.provisioningTransactionHash
      && mandate.provisioningTransactionHash !== args.transactionHash) {
      throw new Error("Deployment transaction identity cannot change.");
    }
    await ctx.db.patch(mandate._id, { provisioningState: args.state,
      provisioningTransactionHash: args.transactionHash, updatedAt: Date.now() });
    return { state: args.state };
  },
});

/** Admin registration only. Funding preparation independently rereads on-chain terms. */
export const bindDeployedVault = internalMutation({
  args: { mandateId: v.id("managedSpotMandates"), vaultAddress: v.string(),
    executorAddress: v.string(), codeHash: v.string() },
  handler: async (ctx, args) => {
    const vaultAddress = args.vaultAddress.toLowerCase();
    const executorAddress = args.executorAddress.toLowerCase();
    const codeHash = args.codeHash.toLowerCase();
    if (!OWNER.test(vaultAddress) || !OWNER.test(executorAddress)
      || executorAddress === vaultAddress || !/^0x[a-f0-9]{64}$/.test(codeHash)) {
      throw new Error("The deployed vault identity is invalid.");
    }
    const mandate = await ctx.db.get(args.mandateId);
    if (!mandate || mandate.expiresAt <= Date.now() + 5 * 60_000) {
      throw new Error("The mandate is missing or expires too soon.");
    }
    if (mandate.status === "vault_ready" && mandate.vaultAddress === vaultAddress
      && mandate.executorAddress === executorAddress
      && mandate.vaultCodeHash === codeHash) return { mandateId: mandate._id, duplicate: true };
    if (mandate.status !== "awaiting_vault") throw new Error("The mandate cannot change its deployed vault.");
    const bound = await ctx.db.query("managedSpotMandates")
      .withIndex("by_vaultAddress", (q) => q.eq("vaultAddress", vaultAddress)).first();
    if (bound) throw new Error("This vault is already bound to a mandate.");
    const accountRef = `arbitrum:42161:vault:${vaultAddress}`;
    if (await ctx.db.query("venueAccounts").withIndex("by_accountRef",
      (q) => q.eq("accountRef", accountRef)).first()) {
      throw new Error("This vault already belongs to a venue account.");
    }
    const now = Date.now();
    const venueAccountId = await ctx.db.insert("venueAccounts", {
      strategyAccountId: mandate.strategyAccountId, role: "arbitrum_managed_vault",
      venue: "uniswap", chainRef: "eip155:42161", accountRef,
      walletAddress: vaultAddress, ownerAddress: mandate.ownerAddress,
      status: "provisioning", lastSyncStatus: "never", legacy: false,
      metadataJson: JSON.stringify({ mandateId: String(mandate._id),
        codeHash, executorAddress }), createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(mandate._id, { vaultAddress, executorAddress, vaultCodeHash: codeHash,
      venueAccountId, status: "vault_ready", updatedAt: now });
    return { mandateId: mandate._id, venueAccountId, duplicate: false };
  },
});

/** Identity-only context for the live finance writer; native vault facts are reread there. */
export async function fundedVaultContext(ctx: any, mandateId: any) {
    const mandate = await ctx.db.get(mandateId);
    if (!mandate || mandate.status !== "active" || mandate.expiresAt <= Date.now()
      || !mandate.vaultAddress || !mandate.vaultCodeHash || !mandate.executorAddress
      || !mandate.fundingOperationId || !mandate.venueAccountId) return null;
    const [user, account, assignment, version, operation, venueAccount] = await Promise.all([
      ctx.db.get(mandate.userId), ctx.db.get(mandate.strategyAccountId),
      ctx.db.get(mandate.assignmentId), ctx.db.get(mandate.programVersionId),
      ctx.db.query("managedSpotFundingOperations")
        .withIndex("by_operationId", (q: any) => q.eq("operationId", mandate.fundingOperationId!)).first(),
      ctx.db.get(mandate.venueAccountId),
    ]);
    if (!user || !account || !assignment || !version || !operation || !venueAccount
      || account.userId !== user._id || account.status !== "active" || account.emergencyStop
      || assignment.userId !== user._id || assignment.strategyAccountId !== account._id
      || assignment.programVersionId !== version._id || assignment.source !== "explicit"
      || !["paused", "active"].includes(assignment.status)
      || assignment.controllerMode !== "autopilot"
      || operation.mandateId !== mandate._id || operation.status !== "confirmed"
      || venueAccount.strategyAccountId !== account._id
      || venueAccount.role !== "arbitrum_managed_vault"
      || venueAccount.status !== "ready" || venueAccount.lastSyncStatus !== "fresh"
      || venueAccount.accountRef !== `arbitrum:42161:vault:${mandate.vaultAddress}`
      || venueAccount.walletAddress !== mandate.vaultAddress
      || venueAccount.ownerAddress !== mandate.ownerAddress
      || mandate.programHash !== version.contentHash || mandate.policyHash !== version.policyHash
      || !await operatorOwnedProgramSource(ctx, version)
      || !await verifyFrozenProgramVersion(version)) return null;
    const wallets = await ctx.db.query("accountWallets")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect();
    const wallet = selectMobileMagicWallet(wallets, user._id, account, mandate.ownerAddress);
    if (!hasObservedMagicDelegation(wallet)) return null;
    return { financialAuthority: "identity_only" as const,
      customerSubject: user.authSubject, strategyAccountId: String(account._id),
      assignmentId: String(assignment._id), programVersionId: String(version._id),
      venueAccountId: String(venueAccount._id),
      mandateId: String(mandate._id), mandateHash: mandate.mandateHash,
      ownerAddress: mandate.ownerAddress, vaultAddress: mandate.vaultAddress,
      executorAddress: mandate.executorAddress, vaultCodeHash: mandate.vaultCodeHash,
      programHash: mandate.programHash, policyHash: mandate.policyHash,
      capitalUnits: mandate.capitalUnits, maxBuyUnits: mandate.maxBuyUnits,
      expiresAt: mandate.expiresAt, sourceAccountId: `arbitrum:42161:vault:${mandate.vaultAddress}`,
      venue: "uniswap" as const, policyJson: version.policyJson };
}

export const getFinanceContext = internalQuery({
  args: { mandateId: v.id("managedSpotMandates") },
  handler: async (ctx, args) => fundedVaultContext(ctx, args.mandateId),
});
