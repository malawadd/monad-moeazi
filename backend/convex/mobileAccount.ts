/* eslint-disable @typescript-eslint/no-explicit-any */
import { mutation } from "./_generated/server";
import { DEFAULT_STRATEGY_CONFIG, STRATEGY_HEALTH_STATUS, STRATEGY_SLUG } from "./constants";
import { DEFAULT_AUTOMATION_POLICY, parseAutomationPolicy } from "./helpers/agentPolicy";
import { getUserByAuthSubject } from "./model";
import { operatorOwnedProgramSource, verifyFrozenProgramVersion } from "./mobile";

const DEFAULT_MARKETS = DEFAULT_AUTOMATION_POLICY.allowedMarkets;

async function allowlistedManagedEnrollment(ctx: any, subject: string, userId: any, strategyAccountId: any, now: number) {
  if (process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED !== "true") return { state: "disabled" as const };
  const allowed = new Set((process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS ?? "")
    .split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowed.has(subject)) return { state: "not_allowlisted" as const };
  const programVersionId = process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID?.trim();
  if (!programVersionId) return { state: "blocked" as const, reason: "No operator-selected program version is configured." };
  let version: any;
  try { version = await ctx.db.get(programVersionId); } catch { version = null; }
  if (!version || version.runtimeCompatibility !== "agent-v1"
      || !await operatorOwnedProgramSource(ctx, version) || !await verifyFrozenProgramVersion(version)) {
    return { state: "blocked" as const, reason: "The operator-selected frozen program version failed ownership or integrity checks." };
  }
  let policy;
  try { policy = parseAutomationPolicy(version.policyJson); } catch { policy = null; }
  if (!policy || policy.allowedVenues.length !== 1 || policy.allowedVenues[0] !== "uniswap") {
    return { state: "blocked" as const, reason: "The configured mobile release must allow Uniswap only." };
  }
  const rows = await ctx.db.query("programAssignments")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId)).collect();
  if (rows.length) {
    const same = rows.length === 1 && rows[0].userId === userId
      && rows[0].strategyAccountId === strategyAccountId && rows[0].programVersionId === version._id
      && rows[0].source === "explicit" && rows[0].status === "paused";
    return same ? { state: "already_enrolled" as const, assignmentId: String(rows[0]._id) }
      : { state: "existing_assignment" as const };
  }
  const assignmentId = await ctx.db.insert("programAssignments", {
    strategyAccountId, userId, programVersionId: version._id, status: "paused", source: "explicit",
    controllerMode: "shadow", shadowCadenceEnabled: false, assignedBySubject: version.frozenBySubject,
    createdAt: now, updatedAt: now,
  });
  await ctx.db.insert("auditEvents", { strategyAccountId, userId, actor: "mobile",
    kind: "managed_program.allowlisted_self_enrolled",
    summary: "Allowlisted Magic account enrolled into the operator-selected managed program release",
    detail: JSON.stringify({ assignmentId: String(assignmentId), programVersionId: String(version._id),
      contentHash: version.contentHash, selectedByOperator: true, initialStatus: "paused",
      initialControllerMode: "shadow", cadenceEnabled: false }),
    refTable: "programAssignments", refId: String(assignmentId), createdAt: now });
  return { state: "enrolled_paused" as const, assignmentId: String(assignmentId),
    programVersionId: String(version._id), contentHash: version.contentHash };
}

export const bootstrap = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    const user = await getUserByAuthSubject(ctx, identity.subject);
    if (!user) throw new Error("Moeazi account is not provisioned.");
    const owner = String(identity.walletAddress ?? "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(owner)) throw new Error("Authenticated Magic owner is invalid.");
    const now = Date.now();

    const walletRows = await ctx.db.query("accountWallets")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect();
    const magicRows = walletRows.filter((row: any) => row.walletProvider === "magic"
      && String(row.ownerAddress).toLowerCase() === owner);
    if (magicRows.length > 1) throw new Error("Multiple Magic wallet records match this owner.");
    let wallet: (typeof walletRows)[number] | null = magicRows[0] ?? null;
    if (!wallet) {
      const walletId = await ctx.db.insert("accountWallets", {
        userId: user._id, ownerAddress: owner, evmUaAddress: owner, evmDepositAddress: owner,
        walletProvider: "magic", accountMode: "eip7702", eip7702Delegated: false,
        arbitrumDelegationStatus: "required", capabilitiesJson: JSON.stringify({ shadow: true, approval: true, autopilot: false, chainId: 42161 }),
        delegatedChainIdsJson: "[]", ownerVerifiedAt: now, unifiedBalanceUsd: 0,
        assetsJson: JSON.stringify({ assets: [], totalAmountInUSD: 0 }), lastRefreshedAt: now,
        createdAt: now, updatedAt: now,
      });
      wallet = await ctx.db.get(walletId);
    }
    if (!wallet) throw new Error("Account wallet could not be created.");

    const strategies = await ctx.db.query("strategyAccounts")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect();
    const bound = strategies.filter((row: any) => row.accountWalletId === wallet._id);
    if (bound.length > 1) throw new Error("Multiple strategies are bound to this Magic owner.");
    let strategy: (typeof strategies)[number] | null = bound[0]
      ?? (strategies.length === 1 ? strategies[0] : null);
    if (strategy && strategy.accountWalletId !== wallet._id) {
      const previousWalletId = strategy.accountWalletId;
      const previous = walletRows.find((row: any) => row._id === previousWalletId);
      if (strategy.accountWalletId && (!previous || previous.userId !== user._id
          || String(previous.ownerAddress).toLowerCase() !== owner)) {
        throw new Error("This strategy is linked to a different owner wallet. Review its ownership before mobile activation.");
      }
      if (previous && previous.strategyAccountId === strategy._id) {
        await ctx.db.patch(previous._id, { strategyAccountId: undefined, updatedAt: now });
      }
      await ctx.db.patch(strategy._id, { accountWalletId: wallet._id, updatedAt: now });
      await ctx.db.patch(wallet._id, { strategyAccountId: strategy._id, updatedAt: now });
      strategy = await ctx.db.get(strategy._id);
    }
    if (!strategy) {
      const strategyId = await ctx.db.insert("strategyAccounts", {
        userId: user._id, accountWalletId: wallet._id, strategyType: STRATEGY_SLUG,
        label: "Moeazi AI Trader", status: "ready", emergencyStop: false,
        healthStatus: STRATEGY_HEALTH_STATUS.bootstrapping,
        healthReason: "Arbitrum owner linked; activation and venue readiness are still required.",
        healthUpdatedAt: now, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(wallet._id, { strategyAccountId: strategyId, updatedAt: now });
      strategy = await ctx.db.get(strategyId);
      await ctx.db.insert("strategyConfigs", { strategyAccountId: strategyId, version: 1, active: true, ...DEFAULT_STRATEGY_CONFIG, createdAt: now, updatedAt: now });
      await ctx.db.insert("auditEvents", {
        strategyAccountId: strategyId, userId: user._id, actor: "mobile", kind: "strategy.provisioned",
        summary: "Magic-owned Arbitrum strategy account provisioned from Android", createdAt: now,
      });
    }
    if (!strategy) throw new Error("Strategy account could not be created.");

    const managedProgramEnrollment = await allowlistedManagedEnrollment(
      ctx, identity.subject, user._id, strategy._id, now);

    const profiles = await ctx.db.query("agentProfiles").withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategy!._id)).collect();
    if (profiles.length === 0) {
      const profileId = await ctx.db.insert("agentProfiles", {
        strategyAccountId: strategy._id, userId: user._id, name: "Moeazi AI",
        tier: "focus", authorityMode: "autopilot", lifecycleStatus: "draft", cadence: "15m",
        watchMarkets: DEFAULT_MARKETS, eventTriggers: [], dailyCreditLimit: DEFAULT_AUTOMATION_POLICY.dailyCreditBudget,
        paused: true, scheduleRevision: 1, version: 1, createdAt: now, updatedAt: now,
      });
      for (const marketId of DEFAULT_MARKETS) await ctx.db.insert("agentMarketSubscriptions", {
        profileId, strategyAccountId: strategy._id, userId: user._id, marketId, enabled: true, createdAt: now, updatedAt: now,
      });
    }
    let policy = await ctx.db.query("automationPolicies").withIndex("by_strategyAccountId_status", (q: any) => q.eq("strategyAccountId", strategy!._id).eq("status", "active")).first();
    if (!policy) {
      const policyId = await ctx.db.insert("automationPolicies", {
        strategyAccountId: strategy._id, userId: user._id, version: 1, status: "active",
        sourceText: "Moeazi conservative mobile defaults", policyJson: JSON.stringify(DEFAULT_AUTOMATION_POLICY),
        activatedAt: now, createdAt: now, updatedAt: now,
      });
      policy = await ctx.db.get(policyId);
    }
    let credit = await ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) => q.eq("userId", user._id)).first();
    if (!credit) {
      const creditId = await ctx.db.insert("creditAccounts", { userId: user._id, balance: 0, reserved: 0, version: 1, createdAt: now, updatedAt: now });
      credit = await ctx.db.get(creditId);
    }
    return {
      ownerAddress: owner, universalAccount: wallet.evmUaAddress, walletProvider: wallet.walletProvider ?? "magic",
      accountMode: wallet.accountMode ?? "eip7702", strategyReady: Boolean(strategy),
      delegationState: wallet.eip7702Delegated ? "active" as const : "required" as const,
      managedProgramEnrollment,
      recoveredExistingAccount: wallet.createdAt < now,
    };
  },
});
