import { mutation, query } from "./_generated/server";
import { DEFAULT_AUTOMATION_POLICY } from "./helpers/agentPolicy";
import { LOCAL_OPERATOR_SUBJECT } from "../lib/operatorIdentity";
import { hasProgramActorScope } from "./helpers/programScope";
import { presetRouting } from "../lib/modelProviders";

function assertLocalOperatorEnabled() {
  if (process.env.MONAD_LOCAL_OPERATOR_BOOTSTRAP_ENABLED !== "true") {
    throw new Error("Local operator bootstrap is disabled for this deployment.");
  }
}

async function requireLocalOperator(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  const issuer = process.env.PARTICLE_CONVEX_JWT_ISSUER ?? "";
  if (!/^http:\/\/(127\.0\.0\.1|localhost):3102$/.test(issuer)) {
    throw new Error("Local operator actions require the local Moeazi Monad API issuer.");
  }
  // Convex validates the JWT issuer against auth.config.ts; additionally require
  // that this deployment itself is the loopback Monad API instance.
  if (!identity || identity.subject !== LOCAL_OPERATOR_SUBJECT
      || (identity.issuer && identity.issuer !== issuer)) {
    throw new Error("The local operator identity is required.");
  }
  assertLocalOperatorEnabled();
  if (!hasProgramActorScope(identity.subject, "operator")) {
    throw new Error("The local operator subject is not in the operator allowlist.");
  }
  return identity.subject;
}

/** Create the dedicated walletless account used only by the local operator console. */
export const ensureLocalOperator = mutation({
  args: {},
  handler: async (ctx) => {
    await requireLocalOperator(ctx);

    const user = await ctx.db.query("users")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", LOCAL_OPERATOR_SUBJECT)).first();
    const now = Date.now();
    const userId = user?._id ?? await ctx.db.insert("users", {
      authSubject: LOCAL_OPERATOR_SUBJECT,
      authProvider: "local_operator",
      displayName: "Monad local operator",
      createdAt: now,
      updatedAt: now,
    });
    const account = await ctx.db.query("strategyAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", userId)).first();
    const strategyAccountId = account?._id ?? await ctx.db.insert("strategyAccounts", {
      userId,
      strategyType: "operator_workspace",
      label: "Monad operator workspace",
      status: "paused",
      emergencyStop: true,
      controlRevision: 0,
      healthStatus: "paused",
      healthReason: "Local operator workspace has no owner wallet or trading authority.",
      healthUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const model = await ctx.db.query("agentModelConfigurations")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", strategyAccountId)).first();
    if (!model) await ctx.db.insert("agentModelConfigurations", {
      strategyAccountId, userId, version: 1, status: "draft", preset: "economy",
      routesJson: JSON.stringify(presetRouting("economy")), pricingVersion: "model-routing-v3",
      estimatedCredits: 0, estimatedProviderCostMicrousd: 0, maximumProviderCostMicrousd: 0,
      providerDailyLimitMicrousd: 0, retries: 0, createdAt: now, updatedAt: now,
    });
    const policy = await ctx.db.query("automationPolicies")
      .withIndex("by_strategyAccountId_status", (q) =>
        q.eq("strategyAccountId", strategyAccountId).eq("status", "draft")).first();
    if (!policy) await ctx.db.insert("automationPolicies", {
      strategyAccountId, userId, version: 1, status: "draft",
      sourceText: "Local operator workspace safe default draft",
      policyJson: JSON.stringify(DEFAULT_AUTOMATION_POLICY), createdAt: now, updatedAt: now,
    });

    return {
      subject: LOCAL_OPERATOR_SUBJECT,
      userId,
      strategyAccountId,
      created: !user || !account,
      walletless: true,
      paused: true,
    };
  },
});

/** Read only the local operator workspace, its versions, models, and policy drafts. */
export const workspace = query({
  args: {},
  handler: async (ctx) => {
    await requireLocalOperator(ctx);
    const user = await ctx.db.query("users")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", LOCAL_OPERATOR_SUBJECT)).first();
    const account = user && await ctx.db.query("strategyAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
    if (!user || !account) throw new Error("Local operator workspace is not bootstrapped.");
    const [teams, models, policies] = await Promise.all([
      ctx.db.query("agentProfiles").withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", account._id)).order("desc").take(50),
      ctx.db.query("agentModelConfigurations").withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", account._id)).order("desc").take(50),
      ctx.db.query("automationPolicies").withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", account._id)).order("desc").take(50),
    ]);
    const teamVersions = await Promise.all(teams.map((team) => ctx.db.query("agentTeamVersions")
      .withIndex("by_teamId", (q) => q.eq("teamId", team._id)).order("desc").take(20)));
    return {
      account: { userId: user._id, strategyAccountId: account._id, status: account.status,
        emergencyStop: account.emergencyStop, walletless: !account.accountWalletId },
      teams: teams.map((team, index) => ({
        teamId: team._id, name: team.name ?? "Unnamed team", tier: team.tier,
        lifecycleStatus: team.lifecycleStatus ?? "draft", paused: team.paused,
        allocationUsd: team.allocationUsd ?? 0, archived: Boolean(team.archivedAt),
        versions: teamVersions[index].map((version) => ({ versionId: version._id,
          version: version.version, status: version.status, configJson: version.configJson,
          createdAt: version.createdAt })),
      })),
      models: models.map((model) => ({ modelConfigurationId: model._id, version: model.version,
        status: model.status, preset: model.preset, createdAt: model.createdAt,
        routes: safeRoutes(model.routesJson) })),
      policies: policies.map((policy) => ({ policyId: policy._id, version: policy.version,
        status: policy.status, policyJson: policy.policyJson, createdAt: policy.createdAt })),
    };
  },
});

async function magicMobileRows(ctx: any) {
  const users = (await ctx.db.query("users").collect()).filter((user: any) =>
    user.authProvider === "magic" && typeof user.authSubject === "string"
      && user.authSubject.startsWith("magic:"));
  return await Promise.all(users.map(async (user: any) => ({user, records: {
    mobileSessions: await ctx.db.query("mobileSessions")
      .withIndex("by_userId_status", (q: any) => q.eq("userId", user._id)).collect(),
    mobileAuthChallenges: await ctx.db.query("mobileAuthChallenges")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect(),
    mobileSigningProofs: await ctx.db.query("mobileSigningProofs")
      .withIndex("by_userId_status", (q: any) => q.eq("userId", user._id)).collect(),
    mobileUaOperations: await ctx.db.query("mobileUaOperations")
      .withIndex("by_userId_operationId", (q: any) => q.eq("userId", user._id)).collect(),
    mobileWalletWithdrawals: await ctx.db.query("mobileWalletWithdrawals")
      .withIndex("by_userId_operationId", (q: any) => q.eq("userId", user._id)).collect(),
    mobileNotificationDevices: await ctx.db.query("mobileNotificationDevices")
      .withIndex("by_userId_deviceId", (q: any) => q.eq("userId", user._id)).collect(),
    mobileConnectorOperations: await ctx.db.query("mobileConnectorOperations")
      .withIndex("by_subject", (q: any) => q.eq("subject", user.authSubject)).collect(),
    accountWallets: await ctx.db.query("accountWallets")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect(),
    strategyAccounts: await ctx.db.query("strategyAccounts")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect(),
  }})));
}

function magicMobileCleanupCounts(rows: any[]) {
  const counts: Record<string, number> = {users: rows.length};
  for (const table of ["mobileSessions", "mobileAuthChallenges", "mobileSigningProofs",
    "mobileUaOperations", "mobileWalletWithdrawals", "mobileNotificationDevices", "mobileConnectorOperations",
    "accountWallets", "strategyAccounts"]) {
    counts[table] = rows.reduce((total, row) => total + row.records[table].length, 0);
  }
  return counts;
}

/** Local Monad operator report for the legacy Magic mobile identity purge. */
export const magicMobileCleanupReport = query({
  args: {},
  handler: async (ctx) => {
    await requireLocalOperator(ctx);
    return magicMobileCleanupCounts(await magicMobileRows(ctx));
  },
});

/** Deletes legacy Magic mobile identities and only their mobile-owned rows. */
export const cleanupMagicMobileRecords = mutation({
  args: {},
  handler: async (ctx) => {
    await requireLocalOperator(ctx);
    const rows = await magicMobileRows(ctx);
    const deleted = magicMobileCleanupCounts(rows);
    if (deleted.accountWallets || deleted.strategyAccounts) {
      throw new Error("Magic user cleanup is blocked while account wallets or strategy accounts are linked. Review and remove chain state through its dedicated migration first.");
    }
    for (const {user, records} of rows) {
      const mobileRecords = Object.entries(records).filter(([table]) =>
        table.startsWith("mobile")).map(([, values]) => values) as any[][];
      for (const values of mobileRecords) {
        for (const record of values) await ctx.db.delete(record._id);
      }
      await ctx.db.delete(user._id);
    }
    return {deleted};
  },
});

function safeRoutes(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.routes) ? parsed.routes.filter((route: any) =>
      route && typeof route.slot === "string" && typeof route.provider === "string"
        && typeof route.model === "string").map((route: any) => ({ slot: route.slot,
          provider: route.provider, model: route.model, credentialSource: route.credentialSource })) : [];
  } catch { return []; }
}
