import {
  internalMutation, internalQuery, mutation, query,
  type MutationCtx, type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { modelProvider } from "./agentValidators";
import { requireViewerStrategy } from "./model";
import {
  defaultModelRouting, estimateModelRouting, parseModelRouting,
  type ModelRoutingDocument,
} from "./helpers/modelRouting";

type ViewerContext = QueryCtx | MutationCtx;
type ViewerState = { user: Doc<"users">; strategyAccount: Doc<"strategyAccounts"> };

async function viewer(ctx: ViewerContext): Promise<ViewerState> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication is required.");
  const state = await requireViewerStrategy(ctx, identity.subject);
  if (!state.user || !state.strategyAccount) throw new Error("Strategy account is required.");
  return { user: state.user, strategyAccount: state.strategyAccount };
}

async function optionalViewer(ctx: ViewerContext): Promise<ViewerState | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const state = await requireViewerStrategy(ctx, identity.subject);
  return state.user && state.strategyAccount
    ? { user: state.user, strategyAccount: state.strategyAccount }
    : null;
}

function parse<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function publicConnection(row: Doc<"modelProviderConnections">) {
  return {
    _id: row._id, provider: row.provider, label: row.label, keyLast4: row.keyLast4,
    status: row.status, models: parse(row.modelsJson, []),
    capabilities: parse(row.capabilitiesJson, {}), failureReason: row.failureReason,
    verifiedAt: row.verifiedAt, lastUsedAt: row.lastUsedAt, version: row.version,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

export const getModelSettings = query({
  args: {},
  handler: async (ctx) => {
    const state = await optionalViewer(ctx);
    if (!state) return null;
    const [connections, configurations, profile] = await Promise.all([
      ctx.db.query("modelProviderConnections").withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", state.strategyAccount._id)).collect(),
      ctx.db.query("agentModelConfigurations").withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", state.strategyAccount._id)).order("desc").take(10),
      ctx.db.query("agentProfiles").withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", state.strategyAccount._id)).first(),
    ]);
    const active = configurations.find((row) => row.status === "active");
    const routing = active
      ? parse<ModelRoutingDocument>(active.routesJson, defaultModelRouting())
      : defaultModelRouting();
    const estimate = estimateModelRouting(routing, profile?.tier ?? "focus");
    return {
      connections: connections.map(publicConnection),
      configurations: configurations.map((row) => ({ ...row, routes: parse(row.routesJson, {}) })),
      active: active ? { ...active, routes: routing } : null,
      effective: active ? { ...active, routes: routing } : {
        version: 0, status: "legacy", preset: "balanced", routes: routing,
        pricingVersion: "model-routing-v2", ...estimate,
      },
      tier: profile?.tier ?? "focus",
    };
  },
});

export const saveModelConfigurationDraft = mutation({
  args: {
    preset: v.union(v.literal("economy"), v.literal("balanced"), v.literal("quality"), v.literal("custom")),
    routesJson: v.string(), providerDailyLimitMicrousd: v.number(), retries: v.number(),
    openRouterPrivacyConfirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const state = await viewer(ctx);
    const routing = parseModelRouting(args.routesJson);
    if (!Number.isInteger(args.providerDailyLimitMicrousd) || args.providerDailyLimitMicrousd < 0) {
      throw new Error("Provider daily limit must be a non-negative integer.");
    }
    if (!Number.isInteger(args.retries) || args.retries < 0 || args.retries > 2) throw new Error("Retries must be 0-2.");
    const relaxedOpenRouterPrivacy = routing.routes.some((route) =>
      route.provider === "openrouter"
      && (!route.openrouter?.zeroDataRetention || route.openrouter?.dataCollection === "allow"));
    if (relaxedOpenRouterPrivacy && !args.openRouterPrivacyConfirmed) {
      throw new Error("Confirm the OpenRouter data-retention warning before saving this route.");
    }
    const profile = await ctx.db.query("agentProfiles").withIndex("by_strategyAccountId", (q) =>
      q.eq("strategyAccountId", state.strategyAccount._id)).first();
    const estimate = estimateModelRouting(routing, profile?.tier ?? "focus");
    const referenced = [...new Set(routing.routes.filter((route) => route.credentialSource === "byok").map((route) => route.connectionId!))];
    for (const id of referenced) {
      const connection = await ctx.db.get(id as Id<"modelProviderConnections">);
      if (!connection || connection.strategyAccountId !== state.strategyAccount._id || connection.status !== "verified") {
        throw new Error("Every BYOK route requires a verified connection.");
      }
      const selectedRoutes = routing.routes.filter((route) => route.connectionId === id);
      if (selectedRoutes.some((route) => route.provider !== connection.provider)) {
        throw new Error(`Connection ${connection.label} does not match the selected provider.`);
      }
      const capabilities = parse<{
        compatibleModels?: string[];
        modelDetails?: Record<string, {
          inputPriceMicrousdPerMillion: number;
          outputPriceMicrousdPerMillion: number;
          maximumInputPriceMicrousdPerMillion: number;
          maximumOutputPriceMicrousdPerMillion: number;
        }>;
      }>(connection.capabilitiesJson, {});
      const compatible = new Set(capabilities.compatibleModels ?? []);
      const selected = selectedRoutes.map((route) => route.model);
      if (selected.some((model) => !compatible.has(model))) {
        throw new Error(`Run the typed-output probe for every model using ${connection.label}.`);
      }
      if (connection.provider === "openrouter" && selectedRoutes.some((route) => {
        const detail = capabilities.modelDetails?.[route.model];
        return !detail
          || route.inputPriceMicrousdPerMillion !== detail.maximumInputPriceMicrousdPerMillion
          || route.outputPriceMicrousdPerMillion !== detail.maximumOutputPriceMicrousdPerMillion
          || route.estimatedInputPriceMicrousdPerMillion !== detail.inputPriceMicrousdPerMillion
          || route.estimatedOutputPriceMicrousdPerMillion !== detail.outputPriceMicrousdPerMillion;
      })) {
        throw new Error(`OpenRouter prices changed or were edited. Probe the selected model again.`);
      }
    }
    const latest = await ctx.db.query("agentModelConfigurations").withIndex("by_strategyAccountId", (q) =>
      q.eq("strategyAccountId", state.strategyAccount._id)).order("desc").first();
    const now = Date.now();
    const id = await ctx.db.insert("agentModelConfigurations", {
      strategyAccountId: state.strategyAccount._id, userId: state.user._id,
      version: (latest?.version ?? 0) + 1, status: "draft", preset: args.preset,
      routesJson: JSON.stringify(routing), pricingVersion: "model-routing-v3",
      estimatedCredits: estimate.credits,
      estimatedProviderCostMicrousd: estimate.estimatedProviderCostMicrousd,
      maximumProviderCostMicrousd: estimate.maximumProviderCostMicrousd,
      providerDailyLimitMicrousd: args.providerDailyLimitMicrousd,
      retries: args.retries, createdAt: now, updatedAt: now,
    });
    return { configurationId: id, version: (latest?.version ?? 0) + 1, ...estimate };
  },
});

export const activateModelConfiguration = mutation({
  args: { configurationId: v.id("agentModelConfigurations"), confirmed: v.boolean() },
  handler: async (ctx, args) => {
    const state = await viewer(ctx);
    if (!args.confirmed) throw new Error("Confirm model costs before activation.");
    const config = await ctx.db.get(args.configurationId);
    if (!config || config.strategyAccountId !== state.strategyAccount._id || config.status !== "draft") {
      throw new Error("Model configuration draft not found.");
    }
    const routing = parseModelRouting(config.routesJson);
    const usesByok = routing.routes.some((route) => route.credentialSource === "byok");
    if (usesByok && config.providerDailyLimitMicrousd <= 0) throw new Error("BYOK schedules require a provider daily limit.");
    const active = await ctx.db.query("agentModelConfigurations").withIndex("by_strategyAccountId_status", (q) =>
      q.eq("strategyAccountId", state.strategyAccount._id).eq("status", "active")).collect();
    const now = Date.now();
    for (const row of active) await ctx.db.patch(row._id, { status: "superseded", updatedAt: now });
    await ctx.db.patch(config._id, { status: "active", activatedAt: now, updatedAt: now });
    const profile = await ctx.db.query("agentProfiles").withIndex("by_strategyAccountId", (q) =>
      q.eq("strategyAccountId", state.strategyAccount._id)).first();
    if (profile) await ctx.db.patch(profile._id, {
      activeModelConfigurationId: config._id, activeModelConfigurationVersion: config.version,
      scheduleRevision: (profile.scheduleRevision ?? 0) + 1, version: profile.version + 1, updatedAt: now,
    });
    return { configurationId: config._id, version: config.version, status: "active" as const };
  },
});

export const getProviderOwnerContext = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.query("users").withIndex("by_authSubject", (q) => q.eq("authSubject", args.subject)).first();
    if (!user) return null;
    const strategy = await ctx.db.query("strategyAccounts").withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
    return strategy ? { userId: user._id, strategyAccountId: strategy._id } : null;
  },
});

async function ownerForSubject(ctx: ViewerContext, subject: string) {
  const user = await ctx.db.query("users").withIndex("by_authSubject", (q) => q.eq("authSubject", subject)).first();
  if (!user) return null;
  const strategy = await ctx.db.query("strategyAccounts").withIndex("by_userId", (q) => q.eq("userId", user._id)).first();
  return strategy ? { userId: user._id, strategyAccountId: strategy._id } : null;
}

export const recordProviderConnection = internalMutation({
  args: {
    subject: v.string(), provider: modelProvider, label: v.string(), secretRef: v.string(),
    keyFingerprint: v.string(), keyLast4: v.string(), modelsJson: v.string(), capabilitiesJson: v.string(),
    status: v.union(v.literal("pending"), v.literal("verified"), v.literal("invalid")),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owner = await ownerForSubject(ctx, args.subject);
    if (!owner) throw new Error("Strategy account not found.");
    const now = Date.now();
    const { subject: _subject, ...connection } = args;
    return await ctx.db.insert("modelProviderConnections", {
      ...connection, userId: owner.userId, strategyAccountId: owner.strategyAccountId,
      version: 1, verifiedAt: args.status === "verified" ? now : undefined, createdAt: now, updatedAt: now,
    });
  },
});

export const updateProviderConnection = internalMutation({
  args: {
    subject: v.string(), connectionId: v.id("modelProviderConnections"),
    status: v.union(v.literal("verified"), v.literal("invalid"), v.literal("revoked")),
    modelsJson: v.optional(v.string()), capabilitiesJson: v.optional(v.string()),
    failureReason: v.optional(v.string()), secretRef: v.optional(v.string()),
    keyFingerprint: v.optional(v.string()), keyLast4: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owner = await ownerForSubject(ctx, args.subject);
    const row = await ctx.db.get(args.connectionId);
    if (!owner || !row || row.strategyAccountId !== owner.strategyAccountId) throw new Error("Provider connection not found.");
    const now = Date.now();
    const { connectionId } = args;
    await ctx.db.patch(connectionId, {
      status: args.status,
      ...(args.modelsJson !== undefined ? { modelsJson: args.modelsJson } : {}),
      ...(args.capabilitiesJson !== undefined ? { capabilitiesJson: args.capabilitiesJson } : {}),
      ...(args.secretRef !== undefined ? { secretRef: args.secretRef } : {}),
      ...(args.keyFingerprint !== undefined ? { keyFingerprint: args.keyFingerprint } : {}),
      ...(args.keyLast4 !== undefined ? { keyLast4: args.keyLast4 } : {}),
      ...(args.status === "verified"
        ? { failureReason: undefined }
        : args.failureReason !== undefined ? { failureReason: args.failureReason } : {}),
      version: row.version + 1, updatedAt: now,
      verifiedAt: args.status === "verified" ? now : row.verifiedAt,
      revokedAt: args.status === "revoked" ? now : undefined,
    });
    if (args.status === "revoked") {
      const profile = await ctx.db.query("agentProfiles").withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", row.strategyAccountId)).first();
      const active = await ctx.db.query("agentModelConfigurations").withIndex("by_strategyAccountId_status", (q) =>
        q.eq("strategyAccountId", row.strategyAccountId).eq("status", "active")).first();
      const isDependency = active
        ? parseModelRouting(active.routesJson).routes.some((route) => route.connectionId === String(row._id))
        : false;
      if (profile && isDependency) await ctx.db.patch(profile._id, {
        paused: true, lifecycleStatus: "blocked", nextRunAt: undefined, updatedAt: now,
      });
    }
    return { connectionId, status: args.status };
  },
});

export const getProviderConnectionForWorker = internalQuery({
  args: { subject: v.string(), connectionId: v.id("modelProviderConnections") },
  handler: async (ctx, args) => {
    const owner = await ownerForSubject(ctx, args.subject);
    const row = await ctx.db.get(args.connectionId);
    if (!owner || !row || row.strategyAccountId !== owner.strategyAccountId) return null;
    return {
      id: String(row._id), provider: row.provider, secretRef: row.secretRef,
      status: row.status, modelsJson: row.modelsJson, capabilitiesJson: row.capabilitiesJson,
    };
  },
});

export const getModelRunConfiguration = internalQuery({
  args: { strategyAccountId: v.id("strategyAccounts"), version: v.optional(v.number()),
    teamVersionId: v.optional(v.id("agentTeamVersions")) },
  handler: async (ctx, args) => {
    const teamVersion = args.teamVersionId ? await ctx.db.get(args.teamVersionId) : null;
    if (args.teamVersionId && (!teamVersion || teamVersion.strategyAccountId !== args.strategyAccountId)) return null;
    const teamConfig = teamVersion ? JSON.parse(teamVersion.configJson) : null;
    const config = teamVersion ? null : args.version === undefined
      ? await ctx.db.query("agentModelConfigurations").withIndex("by_strategyAccountId_status", (q) =>
        q.eq("strategyAccountId", args.strategyAccountId).eq("status", "active")).first()
      : (await ctx.db.query("agentModelConfigurations").withIndex("by_strategyAccountId", (q) =>
        q.eq("strategyAccountId", args.strategyAccountId)).collect()).find((row) => row.version === args.version);
    if (!teamVersion && (!config || config.status === "draft")) return null;
    const routing = parseModelRouting(teamConfig?.modelRoutingJson ?? config!.routesJson);
    const connectionIds = [...new Set(routing.routes.filter((route) => route.connectionId).map((route) => route.connectionId!))];
    const connections: Array<{
      id: string; provider: "openai" | "deepseek" | "openrouter"; status: string; secretRef: string;
    }> = [];
    for (const id of connectionIds) {
      const row = await ctx.db.get(id as Id<"modelProviderConnections">);
      if (row && row.strategyAccountId === args.strategyAccountId) connections.push({
        id: String(row._id), provider: row.provider, status: row.status, secretRef: row.secretRef,
      });
    }
    return teamVersion ? {
      version: teamVersion.version, status: "active", routes: routing, connections,
      providerDailyLimitMicrousd: teamConfig.dailyProviderBudgetMicrousd,
      retries: 0, teamConfig,
    } : { ...config!, routes: routing, connections };
  },
});
