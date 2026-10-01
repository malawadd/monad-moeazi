import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { managedTradingVenue } from "./agentValidators";
import { getViewerUser, requireViewerUser } from "./tradeHelpers";

const VENUES = ["hyperliquid", "lighter", "orderly", "gmx", "ostium", "uniswap"] as const;
const authority = v.union(v.literal("shadow"), v.literal("approval"), v.literal("autopilot"));
const ARBITRUM = 42161;

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("");
}

async function ownedContext(ctx: any) {
  const user = await requireViewerUser(ctx);
  const strategy = await ctx.db.query("strategyAccounts")
    .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).first();
  if (!strategy) throw new Error("Create a strategy account first.");
  const wallet = await ctx.db.query("accountWallets")
    .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).first();
  if (!wallet) throw new Error("Sync your Particle or Magic Universal Account first.");
  return { user, strategy, wallet };
}

function capabilities(wallet: any) {
  let chains: number[] = [];
  try { chains = JSON.parse(wallet.delegatedChainIdsJson ?? "[]").map(Number); } catch { chains = []; }
  const delegated = wallet.accountMode === "eip7702" && chains.includes(ARBITRUM);
  return {
    provider: wallet.walletProvider ?? "particle",
    ownerAddress: wallet.ownerAddress,
    uaAddress: wallet.evmUaAddress,
    accountImplementation: wallet.accountImplementation ?? null,
    chainId: ARBITRUM,
    arbitrumDelegated: delegated,
    shadow: true,
    approval: true,
    autopilot: delegated,
    reason: delegated
      ? "Arbitrum delegation is active. Policy and environment ceilings still apply."
      : "Shadow and Approval are available; Autopilot requires Arbitrum EIP-7702 delegation.",
  };
}

async function upsertIntegration(ctx: any, strategyId: any, venue: typeof VENUES[number], patch: any) {
  const existing = await ctx.db.query("venueIntegrations")
    .withIndex("by_strategyAccountId_venue", (q: any) => q.eq("strategyAccountId", strategyId).eq("venue", venue)).first();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("venueIntegrations", {
    strategyAccountId: strategyId, venue, enabled: false, status: "disabled",
    createdAt: now, updatedAt: now, ...patch,
  });
}

export const getOwnerCapabilities = query({
  args: {},
  handler: async (ctx) => {
    const { identity, user } = await getViewerUser(ctx);
    if (!identity || !user) return null;
    const wallet = await ctx.db.query("accountWallets").withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
    return wallet ? capabilities(wallet) : null;
  },
});

export const getVenueIntegrations = query({
  args: {},
  handler: async (ctx) => {
    const { identity, user } = await getViewerUser(ctx);
    if (!identity || !user) return { signedIn: Boolean(identity), strategyAccountId: null, owner: null, integrations: [] };
    const strategy = await ctx.db.query("strategyAccounts").withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
    const wallet = await ctx.db.query("accountWallets").withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
    if (!strategy) return { signedIn: true, strategyAccountId: null, owner: wallet ? capabilities(wallet) : null, integrations: defaults([]) };
    const [configured, accounts, attempts, legacy] = await Promise.all([
      ctx.db.query("venueIntegrations").withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategy._id)).collect(),
      ctx.db.query("venueAccounts").withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategy._id)).collect(),
      ctx.db.query("venueSetupAttempts").withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategy._id)).collect(),
      ctx.db.query("venueAccounts").withIndex("by_strategyAccountId_role", (q) => q.eq("strategyAccountId", strategy._id).eq("role", "optimism_execution_wallet")).first(),
    ]);
    return {
      signedIn: true, strategyAccountId: strategy._id, owner: wallet ? capabilities(wallet) : null,
      legacyOptimism: legacy ? { present: true, balanceJson: legacy.balanceJson ?? "{}", accountId: legacy._id } : null,
      integrations: defaults(configured, accounts, attempts),
    };
  },
});

export const prepareArbitrumDelegation = mutation({
  args: {},
  handler: async (ctx) => {
    const { wallet } = await ownedContext(ctx);
    if (capabilities(wallet).arbitrumDelegated) return { required: false, chainId: ARBITRUM };
    await ctx.db.patch(wallet._id, { arbitrumDelegationStatus: "pending", updatedAt: Date.now() });
    return { required: true, chainId: ARBITRUM, ownerAddress: wallet.ownerAddress, uaAddress: wallet.evmUaAddress };
  },
});

export const confirmArbitrumDelegation = mutation({
  args: { transactionId: v.string() },
  handler: async (ctx, args) => {
    const { user, strategy, wallet } = await ownedContext(ctx);
    if (!capabilities(wallet).arbitrumDelegated) throw new Error("Sync the confirmed Arbitrum delegation before continuing.");
    await ctx.db.patch(wallet._id, { arbitrumDelegationStatus: "active", updatedAt: Date.now() });
    await ctx.db.insert("auditEvents", {
      strategyAccountId: strategy._id, userId: user._id, actor: "viewer", kind: "wallet.arbitrum_delegated",
      summary: "Arbitrum EIP-7702 delegation verified", detail: JSON.stringify({ transactionId: args.transactionId }), createdAt: Date.now(),
    });
    return capabilities(wallet);
  },
});

export const beginVenueSetup = mutation({
  args: { venue: managedTradingVenue, fundingAmount: v.string(), authorityMode: authority },
  handler: async (ctx, args) => {
    if (process.env.MAINNET_VENUE_SETUP_ENABLED !== "true") throw new Error("Mainnet venue setup is disabled by the environment gate.");
    if (!/^\d+(\.\d+)?$/.test(args.fundingAmount)) throw new Error("Funding amount must be a positive decimal value.");
    const { strategy, wallet } = await ownedContext(ctx);
    const caps = capabilities(wallet);
    if (args.authorityMode === "autopilot" && !caps.autopilot) throw new Error(caps.reason);
    const now = Date.now();
    const shadow = args.authorityMode === "shadow";
    const attemptId = await ctx.db.insert("venueSetupAttempts", {
      strategyAccountId: strategy._id, accountWalletId: wallet._id, venue: args.venue,
      authorityMode: args.authorityMode, fundingAmount: args.fundingAmount,
      state: shadow ? "ready" : "awaiting_funding", step: shadow ? "complete" : "funding",
      workflowId: `venue-setup-${strategy._id}-${args.venue}-${now}`, createdAt: now, updatedAt: now,
      completedAt: shadow ? now : undefined,
    });
    await upsertIntegration(ctx, strategy._id, args.venue, {
      enabled: true, routingEnabled: shadow, authorityMode: args.authorityMode,
      status: shadow ? "ready" : "authorization_required", activeSetupAttemptId: attemptId,
    });
    return await ctx.db.get(attemptId);
  },
});

export const prepareVenueSetupStep = mutation({
  args: { attemptId: v.id("venueSetupAttempts") },
  handler: async (ctx, args) => {
    const { strategy, wallet } = await ownedContext(ctx);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.strategyAccountId !== strategy._id) throw new Error("Setup attempt not found.");
    return stepContract(attempt.venue, attempt.authorityMode, wallet.evmUaAddress, attempt.fundingAmount);
  },
});

export const confirmVenueSetupStep = mutation({
  args: { attemptId: v.id("venueSetupAttempts"), transactionId: v.optional(v.string()), signature: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { strategy } = await ownedContext(ctx);
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.strategyAccountId !== strategy._id) throw new Error("Setup attempt not found.");
    if (!args.transactionId && !args.signature) throw new Error("A transaction ID or provider signature is required.");
    await ctx.db.patch(attempt._id, {
      state: "verifying", step: "verification", transactionId: args.transactionId,
      signatureHash: args.signature ? await sha256(args.signature) : undefined, updatedAt: Date.now(),
    });
    return { state: "verifying", message: "Submitted for mainnet authority and collateral verification." };
  },
});

export const refreshVenueSetup = mutation({
  args: { venue: managedTradingVenue },
  handler: async (ctx, args) => {
    const { strategy } = await ownedContext(ctx);
    const attempt = await ctx.db.query("venueSetupAttempts")
      .withIndex("by_strategyAccountId_venue", (q) => q.eq("strategyAccountId", strategy._id).eq("venue", args.venue)).order("desc").first();
    return attempt ?? null;
  },
});

export const setVenueRoutingEnabled = mutation({
  args: { venue: managedTradingVenue, enabled: v.boolean() },
  handler: async (ctx, args) => {
    const { strategy } = await ownedContext(ctx);
    const integration = await ctx.db.query("venueIntegrations")
      .withIndex("by_strategyAccountId_venue", (q) => q.eq("strategyAccountId", strategy._id).eq("venue", args.venue)).first();
    if (args.enabled && integration?.status !== "ready") throw new Error("Finish and verify venue setup before enabling routing.");
    return await upsertIntegration(ctx, strategy._id, args.venue, { enabled: args.enabled, routingEnabled: args.enabled });
  },
});

export const setVenueEnabled = setVenueRoutingEnabled;

export const revokeVenueAuthority = mutation({
  args: { venue: managedTradingVenue },
  handler: async (ctx, args) => {
    const { user, strategy } = await ownedContext(ctx);
    const [permissions, credentials] = await Promise.all([
      ctx.db.query("venuePermissions").withIndex("by_strategyAccountId_venue", (q) => q.eq("strategyAccountId", strategy._id).eq("venue", args.venue)).collect(),
      ctx.db.query("venueCredentials").withIndex("by_strategyAccountId_venue", (q) => q.eq("strategyAccountId", strategy._id).eq("venue", args.venue)).collect(),
    ]);
    const now = Date.now();
    await Promise.all(permissions.map((row) => ctx.db.patch(row._id, { status: "revoked", updatedAt: now })));
    await Promise.all(credentials.map((row) => ctx.db.patch(row._id, { status: "revoked", revokedAt: now, updatedAt: now })));
    await upsertIntegration(ctx, strategy._id, args.venue, { enabled: false, routingEnabled: false, status: "disabled" });
    await ctx.db.insert("auditEvents", { strategyAccountId: strategy._id, userId: user._id, actor: "viewer", kind: "venue.authority_revoked", summary: `${args.venue} authority revoked`, createdAt: now });
    return { revoked: true };
  },
});

export const prepareOptimismMigration = mutation({
  args: {},
  handler: async (ctx) => {
    const { strategy, wallet } = await ownedContext(ctx);
    const legacy = await ctx.db.query("venueAccounts").withIndex("by_strategyAccountId_role", (q) => q.eq("strategyAccountId", strategy._id).eq("role", "optimism_execution_wallet")).first();
    if (!legacy) return null;
    const now = Date.now();
    const id = await ctx.db.insert("optimismMigrations", {
      strategyAccountId: strategy._id, accountWalletId: wallet._id, legacyVenueAccountId: legacy._id,
      balancesJson: legacy.balanceJson ?? "{}", allowancesJson: "[]", pendingTransactionsJson: "[]",
      retainedGasWei: "0", status: "review", createdAt: now, updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const confirmOptimismMigration = mutation({
  args: { transactionId: v.string() },
  handler: async (ctx, args) => {
    const { strategy } = await ownedContext(ctx);
    const row = await ctx.db.query("optimismMigrations").withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategy._id)).order("desc").first();
    if (!row || row.status !== "review") throw new Error("Prepare and review the migration first.");
    await ctx.db.patch(row._id, { status: "submitted", transactionId: args.transactionId, updatedAt: Date.now() });
    return await ctx.db.get(row._id);
  },
});

export const storeVenueCredentialEnvelope = internalMutation({
  args: { strategyAccountId: v.id("strategyAccounts"), venue: managedTradingVenue, publicKey: v.string(), encryptedEnvelope: v.string(), kmsKeyRef: v.string(), keyVersion: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("venueCredentials").withIndex("by_strategyAccountId_venue", (q) => q.eq("strategyAccountId", args.strategyAccountId).eq("venue", args.venue)).filter((q) => q.eq(q.field("status"), "active")).first();
    if (existing) throw new Error("An active credential already exists for this venue.");
    const now = Date.now();
    return await ctx.db.insert("venueCredentials", { ...args, status: "active", createdAt: now, updatedAt: now });
  },
});

export const getHyperliquidBindingContext = internalQuery({
  args: { attemptId: v.id("venueSetupAttempts") },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.venue !== "hyperliquid" || attempt.state !== "verifying"
      || !["approval", "autopilot"].includes(attempt.authorityMode)) return null;
    const [strategy, wallet] = await Promise.all([
      ctx.db.get(attempt.strategyAccountId), ctx.db.get(attempt.accountWalletId),
    ]);
    if (!strategy || !wallet || strategy.userId !== wallet.userId
      || (wallet.strategyAccountId && wallet.strategyAccountId !== strategy._id)) {
      return null;
    }
    const integration = await ctx.db.query("venueIntegrations").withIndex("by_strategyAccountId_venue", (q) =>
      q.eq("strategyAccountId", strategy._id).eq("venue", "hyperliquid")).first();
    if (!integration || integration.activeSetupAttemptId !== attempt._id
      || integration.authorityMode !== attempt.authorityMode) return null;
    return {
      attemptId: attempt._id, strategyAccountId: strategy._id, accountWalletId: wallet._id,
      venue: attempt.venue, state: attempt.state, authorityMode: attempt.authorityMode,
      ownerAddress: wallet.ownerAddress.toLowerCase(),
    };
  },
});

export const storeHyperliquidCredentialBinding = internalMutation({
  args: {
    attemptId: v.id("venueSetupAttempts"), masterAddress: v.string(), targetAddress: v.string(),
    targetKind: v.union(v.literal("master"), v.literal("subaccount")), apiWalletAddress: v.string(),
    encryptedEnvelope: v.string(), kmsKeyRef: v.string(), keyVersion: v.number(),
    credentialContext: v.string(), ownerSignatureHash: v.string(), bindingReceiptJson: v.string(),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt || attempt.venue !== "hyperliquid" || attempt.state !== "verifying"
      || !["approval", "autopilot"].includes(attempt.authorityMode)) {
      throw new Error("Hyperliquid setup attempt is unavailable.");
    }
    const [strategy, wallet] = await Promise.all([
      ctx.db.get(attempt.strategyAccountId), ctx.db.get(attempt.accountWalletId),
    ]);
    if (!strategy || !wallet || strategy.userId !== wallet.userId
      || (wallet.strategyAccountId && wallet.strategyAccountId !== strategy._id)) {
      throw new Error("Hyperliquid setup owner context is invalid.");
    }
    const masterAddress = args.masterAddress.toLowerCase();
    const targetAddress = args.targetAddress.toLowerCase();
    const apiWalletAddress = args.apiWalletAddress.toLowerCase();
    if (masterAddress !== wallet.ownerAddress.toLowerCase()) {
      throw new Error("Hyperliquid master does not match the connected account owner.");
    }
    if ((args.targetKind === "master" && targetAddress !== masterAddress)
      || (args.targetKind === "subaccount" && targetAddress === masterAddress)) {
      throw new Error("Hyperliquid target scope is invalid.");
    }
    const expectedCredentialContext = `venue-credential:v1:${strategy._id}:hyperliquid:${apiWalletAddress}`;
    if (args.credentialContext !== expectedCredentialContext) {
      throw new Error("Hyperliquid credential context is invalid.");
    }
    let receipt: any;
    try { receipt = JSON.parse(args.bindingReceiptJson); } catch { throw new Error("Hyperliquid binding receipt is malformed."); }
    const apiRole = receipt?.apiWalletRole;
    const targetRole = receipt?.targetRole;
    const extraAgent = receipt?.extraAgent;
    const expectedTargetRole = args.targetKind === "master" ? "user" : "subAccount";
    if (receipt?.schemaVersion !== 1 || receipt?.source !== "hyperliquid_info"
      || receipt?.attemptId !== String(attempt._id) || receipt?.strategyAccountId !== String(strategy._id)
      || receipt?.masterAddress !== masterAddress || receipt?.targetAddress !== targetAddress
      || receipt?.targetKind !== args.targetKind || receipt?.apiWalletAddress !== apiWalletAddress
      || receipt?.credentialContext !== args.credentialContext
      || receipt?.ownerSignatureHash !== args.ownerSignatureHash
      || !Number.isFinite(receipt?.verifiedAt) || receipt.verifiedAt > Date.now()
      || apiRole?.role !== "agent" || String(apiRole?.data?.user ?? "").toLowerCase() !== masterAddress
      || targetRole?.role !== expectedTargetRole
      || (args.targetKind === "subaccount" && String(targetRole?.data?.master ?? "").toLowerCase() !== masterAddress)
      || String(extraAgent?.address ?? "").toLowerCase() !== apiWalletAddress
      || !Number.isFinite(extraAgent?.validUntil) || extraAgent.validUntil <= Date.now()) {
      throw new Error("Hyperliquid Info evidence does not prove the requested wallet and scope binding.");
    }
    const [integration, accounts, credentials, permissions] = await Promise.all([
      ctx.db.query("venueIntegrations").withIndex("by_strategyAccountId_venue", (q) =>
        q.eq("strategyAccountId", strategy._id).eq("venue", "hyperliquid")).first(),
      ctx.db.query("venueAccounts").withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", strategy._id)).collect(),
      ctx.db.query("venueCredentials").withIndex("by_strategyAccountId_venue", (q) =>
        q.eq("strategyAccountId", strategy._id).eq("venue", "hyperliquid")).collect(),
      ctx.db.query("venuePermissions").withIndex("by_strategyAccountId_venue", (q) =>
        q.eq("strategyAccountId", strategy._id).eq("venue", "hyperliquid")).collect(),
    ]);
    if (!integration || integration.activeSetupAttemptId !== attempt._id
      || integration.authorityMode !== attempt.authorityMode) {
      throw new Error("Hyperliquid setup attempt is no longer the current authority context.");
    }
    if (integration?.status === "ready" || integration?.routingEnabled
      || permissions.some((row) => row.status === "active")
      || credentials.some((row) => row.status === "active")) {
      throw new Error("Revoke existing Hyperliquid authority before registering another API wallet.");
    }
    const currentMaster = accounts.find((row) => row.role === "hyperliquid_master_wallet");
    const currentAgent = accounts.find((row) => row.role === "hyperliquid_agent_wallet");
    if (currentMaster && currentMaster.walletAddress.toLowerCase() !== masterAddress) {
      throw new Error("A different Hyperliquid master is already registered for this account.");
    }
    if (currentAgent && (currentAgent.walletAddress.toLowerCase() !== apiWalletAddress
      || currentAgent.accountId?.toLowerCase() !== targetAddress)) {
      throw new Error("A different Hyperliquid API wallet or scope is already registered.");
    }
    const now = Date.now();
    const readinessJson = JSON.stringify({ state: "authorization_required", bindingReceipt: receipt });
    const masterFields = {
      strategyAccountId: strategy._id, role: "hyperliquid_master_wallet" as const, venue: "hyperliquid" as const,
      chainRef: "hyperliquid:mainnet", accountRef: `hyperliquid:master:${masterAddress}`,
      walletAddress: masterAddress, ownerAddress: masterAddress, accountId: masterAddress,
      readinessJson, legacy: false, status: "approval_required" as const,
      lastSyncStatus: "never" as const, updatedAt: now,
    };
    let masterAccount = currentMaster?._id;
    if (currentMaster) await ctx.db.patch(currentMaster._id, masterFields);
    else masterAccount = await ctx.db.insert("venueAccounts", { ...masterFields, createdAt: now });
    const agentFields = {
      strategyAccountId: strategy._id, role: "hyperliquid_agent_wallet" as const, venue: "hyperliquid" as const,
      chainRef: "hyperliquid:mainnet", accountRef: `hyperliquid:${args.targetKind}:${targetAddress}`,
      walletAddress: apiWalletAddress, ownerAddress: masterAddress, accountId: targetAddress,
      delegatePublicKey: apiWalletAddress, readinessJson, legacy: false,
      status: "approval_required" as const, lastSyncStatus: "never" as const, updatedAt: now,
    };
    let venueAccountId = currentAgent?._id;
    if (currentAgent) await ctx.db.patch(currentAgent._id, agentFields);
    else venueAccountId = await ctx.db.insert("venueAccounts", { ...agentFields, createdAt: now });
    if (!venueAccountId) throw new Error("Hyperliquid venue account could not be registered.");
    const credentialId = await ctx.db.insert("venueCredentials", {
      strategyAccountId: strategy._id, venue: "hyperliquid", venueAccountId,
      publicKey: apiWalletAddress, encryptedEnvelope: args.encryptedEnvelope,
      kmsKeyRef: args.kmsKeyRef, keyVersion: args.keyVersion,
      status: "authorization_required", createdAt: now, updatedAt: now,
    });
    if (integration) {
      await ctx.db.patch(integration._id, {
        enabled: false, routingEnabled: false, status: "authorization_required",
        authorityMode: attempt.authorityMode, updatedAt: now,
      });
    } else {
      await ctx.db.insert("venueIntegrations", {
        strategyAccountId: strategy._id, venue: "hyperliquid", enabled: false,
        routingEnabled: false, authorityMode: attempt.authorityMode,
        status: "authorization_required", createdAt: now, updatedAt: now,
      });
    }
    await ctx.db.patch(attempt._id, { state: "verifying", step: "authorization_required", updatedAt: now });
    await ctx.db.insert("auditEvents", {
      strategyAccountId: strategy._id, actor: "execution_gateway", kind: "venue.hyperliquid_binding_verified",
      summary: "Hyperliquid API wallet and account scope were verified; venue authority remains pending.",
      detail: JSON.stringify({ venueAccountId, masterAccount, credentialId, targetKind: args.targetKind,
        targetAddress, apiWalletAddress, receiptVerifiedAt: receipt.verifiedAt }),
      refTable: "venueSetupAttempts", refId: String(attempt._id), createdAt: now,
    });
    return { credentialId, venueAccountId, status: "authorization_required" };
  },
});

function defaults(configured: Doc<"venueIntegrations">[], accounts: Doc<"venueAccounts">[] = [], attempts: Doc<"venueSetupAttempts">[] = []) {
  return VENUES.map((venue) => {
    const integration = configured.find((item) => item.venue === venue);
    const account = accounts.find((item) => item.venue === venue && item.status === "ready");
    const attempt = attempts.filter((item) => item.venue === venue).sort((a, b) => b.createdAt - a.createdAt)[0];
    return { venue, enabled: integration?.enabled ?? false, routingEnabled: integration?.routingEnabled ?? false,
      authorityMode: integration?.authorityMode ?? "shadow", status: integration?.status ?? "disabled",
      ready: integration?.status === "ready" || Boolean(account), setupAttempt: attempt ?? null,
      lastHealthAt: integration?.lastHealthAt ?? account?.lastSyncedAt ?? null,
      lastHealthMessage: integration?.lastHealthMessage ?? null };
  });
}

function stepContract(venue: string, mode: string, owner: string, amount: string) {
  const copy: Record<string, string> = {
    hyperliquid: "Deposit UA-sourced collateral, then approve a unique restricted agent wallet.",
    lighter: "Review the Arbitrum CCTP deposit intent, then register the generated API key.",
    orderly: "Register the UA owner, deposit collateral, then authorize the scoped Ed25519 key.",
    gmx: "Fund the Arbitrum account and authorize a bounded GMX subaccount signer.",
    ostium: "Fund collateral and approve Ostium's native one-click delegation with limits and expiry.",
    uniswap: "Review Arbitrum router approval. Approval mode signs every swap; Autopilot uses scoped delegation.",
  };
  return { chainId: ARBITRUM, owner, fundingAmount: amount, authorityMode: mode, venue,
    instruction: copy[venue], requiresUserSignature: mode !== "shadow", automaticFundMovement: false };
}
