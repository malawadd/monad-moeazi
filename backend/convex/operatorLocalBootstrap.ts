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
  if (!identity || identity.subject !== LOCAL_OPERATOR_SUBJECT) {
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

function safeRoutes(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.routes) ? parsed.routes.filter((route: any) =>
      route && typeof route.slot === "string" && typeof route.provider === "string"
        && typeof route.model === "string").map((route: any) => ({ slot: route.slot,
          provider: route.provider, model: route.model, credentialSource: route.credentialSource })) : [];
  } catch { return []; }
}
