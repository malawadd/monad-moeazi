import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireProgramActor } from "./helpers/programScope";
import { controllerHash } from "../lib/programOwnership";
import { estimateModelRouting, parseModelRouting } from "./helpers/modelRouting";
import { platformModels, safeOpenRouterPreferences } from "../lib/modelProviders";
import { verifyFrozenProgramVersion } from "./mobile";
import { compatibleManagedAgentRelease } from "./helpers/managedAgentRelease";

const INTERNAL_PROGRAM_KEY = "internal:managed-spot-alpha-v1";
const INTERNAL_OWNER = "system:moeazi-managed-mobile";

/** Backend authorization for the local console's credential-presence read. */
export const assertOperator = query({
  args: {},
  handler: async (ctx) => {
    await requireProgramActor(ctx, "operator");
    return { authorized: true };
  },
});

function jsonObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function teamSummary(value: string) {
  const team = jsonObject(value);
  if (!team) return null;
  return {
    objective: team.objective, tier: team.tier, cadence: team.cadence,
    markets: team.markets,
    enabledRoles: Array.isArray(team.roles) ? team.roles.filter((role) =>
      role && typeof role === "object" && role.enabled === true).map((role) => role.id) : [],
  };
}

function modelSummary(value: string) {
  const frozen = jsonObject(value);
  const routing = typeof frozen?.routesJson === "string" ? jsonObject(frozen.routesJson) : null;
  return {
    pricingVersion: frozen?.pricingVersion ?? null,
    routes: Array.isArray(routing?.routes) ? routing.routes.filter((route) =>
      route && typeof route === "object" && typeof route.slot === "string"
      && typeof route.provider === "string" && typeof route.model === "string")
      .map((route) => ({ slot: route.slot, provider: route.provider, model: route.model,
        credentialSource: route.credentialSource })) : [],
  };
}

/** Read-only, owned program catalog for the loopback research console. */
export const listOwnedPrograms = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireProgramActor(ctx, "research");
    const owned = await ctx.db.query("tradingPrograms")
      .withIndex("by_createdBySubject", (q) => q.eq("createdBySubject", actor.subject))
      .order("desc").take(50);
    const internal = await ctx.db.query("tradingPrograms")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", INTERNAL_PROGRAM_KEY))
      .first();
    const programs = internal && internal.createdBySubject === INTERNAL_OWNER
      && !owned.some((program) => program._id === internal._id) ? [internal, ...owned] : owned;
    const result = [];
    for (const program of programs) {
      const versions = await ctx.db.query("tradingProgramVersions")
        .withIndex("by_programId", (q) => q.eq("programId", program._id))
        .order("desc").take(20);
      result.push({
        programId: program._id, name: program.name, createdAt: program.createdAt,
        releasedVersionId: program.releasedVersionId ?? (program.createdBySubject === INTERNAL_OWNER
          ? (versions.find((version) => version.version === 1)?._id ?? null) : null),
        ownership: program.createdBySubject === INTERNAL_OWNER
          ? "moeazi_mobile" : "operator",
        versions: versions.map((version) => ({
          programVersionId: version._id, version: version.version,
          contentHash: version.contentHash, strategyArtifactHash: version.strategyArtifactHash,
          adapterProfileHash: version.adapterProfileHash, runtimeCompatibility: version.runtimeCompatibility,
          policy: jsonObject(version.policyJson),
          team: teamSummary(version.teamConfigJson),
          model: modelSummary(version.modelConfigurationJson),
          createdAt: version.createdAt,
        })),
      });
    }
    return { programs: result, truncated: owned.length === 50 };
  },
});

/** Freeze a new mobile candidate without changing any existing assignment or mandate. */
export const createMobileModelCandidate = mutation({
  args: {
    baseVersionId: v.id("tradingProgramVersions"),
    choices: v.array(v.object({ slot: v.string(), provider: v.union(
      v.literal("openai"), v.literal("deepseek"), v.literal("openrouter")), model: v.string(),
      pricing: v.optional(v.object({ input: v.number(), cachedInput: v.number(), output: v.number() })) })),
  },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "operator");
    const program = await ctx.db.query("tradingPrograms")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", INTERNAL_PROGRAM_KEY)).first();
    if (!program || program.createdBySubject !== INTERNAL_OWNER) throw new Error("Internal mobile program is unavailable.");
    const latest = await ctx.db.query("tradingProgramVersions")
      .withIndex("by_programId", (q) => q.eq("programId", program._id)).order("desc").first();
    if (!latest || latest._id !== args.baseVersionId) throw new Error("Mobile program version changed. Refresh before editing.");
    const sourceAccount = await ctx.db.get(latest.sourceStrategyAccountId);
    const team = jsonObject(latest.teamConfigJson);
    const frozenModel = jsonObject(latest.modelConfigurationJson);
    if (!sourceAccount || !team || typeof frozenModel?.routesJson !== "string") {
      throw new Error("Frozen mobile program is incomplete.");
    }
    const routing = parseModelRouting(frozenModel.routesJson, true);
    if (args.choices.length !== routing.routes.length || args.choices.length > 32) {
      throw new Error("Submit exactly one choice for every frozen agent route.");
    }
    const bySlot = new Map(args.choices.map((choice) => [choice.slot, choice]));
    if (bySlot.size !== args.choices.length) throw new Error("Duplicate agent route choice.");
    if (routing.routes.every((route) => {
      const choice = bySlot.get(route.slot);
      return choice?.provider === route.provider && choice.model === route.model
        && route.credentialSource === "platform"
        && (route.provider !== "openrouter" || (choice.pricing?.input === route.inputPriceMicrousdPerMillion
          && choice.pricing?.cachedInput === route.cachedInputPriceMicrousdPerMillion
          && choice.pricing?.output === route.outputPriceMicrousdPerMillion));
    })) return { programVersionId: latest._id, version: latest.version, duplicate: true };
    const updated = routing.routes.map((route) => {
      const choice = bySlot.get(route.slot);
      if (!choice) throw new Error(`Missing choice for ${route.slot}.`);
      const model = choice.provider === "openrouter" ? null
        : platformModels[choice.provider].find((item) => item.id === choice.model && item.pricingKnown);
      const price = choice.provider === "openrouter" ? choice.pricing
        : model ? { input: model.inputPriceMicrousdPerMillion,
          cachedInput: model.cachedInputPriceMicrousdPerMillion,
          output: model.outputPriceMicrousdPerMillion } : null;
      if (!price || [price.input, price.cachedInput, price.output].some((rate) =>
        !Number.isSafeInteger(rate) || rate < 0 || rate > 100_000_000)
        || (choice.provider === "openrouter" && (price.input === 0 || price.output === 0))) {
        throw new Error(`Unsupported or unpriced ${choice.provider} model.`);
      }
      return { ...route, provider: choice.provider, model: choice.model,
        credentialSource: "platform" as const, connectionId: undefined,
        openrouter: choice.provider === "openrouter" ? safeOpenRouterPreferences() : undefined,
        inputPriceMicrousdPerMillion: price.input,
        cachedInputPriceMicrousdPerMillion: price.cachedInput,
        outputPriceMicrousdPerMillion: price.output };
    });
    const routesJson = JSON.stringify(parseModelRouting(JSON.stringify({ schemaVersion: 2, routes: updated })));
    const estimate = estimateModelRouting(JSON.parse(routesJson), team.tier as "focus" | "pro" | "max", team.roles as any);
    const models = await ctx.db.query("agentModelConfigurations")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", sourceAccount._id)).collect();
    const now = Date.now();
    const modelConfigurationId = await ctx.db.insert("agentModelConfigurations", {
      strategyAccountId: sourceAccount._id, userId: sourceAccount.userId,
      version: Math.max(0, ...models.map((row) => row.version)) + 1,
      status: "draft", preset: "custom", routesJson,
      pricingVersion: "model-routing-v3", estimatedCredits: estimate.credits,
      estimatedProviderCostMicrousd: estimate.estimatedProviderCostMicrousd,
      maximumProviderCostMicrousd: estimate.maximumProviderCostMicrousd,
      providerDailyLimitMicrousd: 100_000, retries: 0,
      createdAt: now, updatedAt: now,
    });
    const modelConfigurationJson = JSON.stringify({ routesJson,
      pricingVersion: "model-routing-v3", preset: "custom" });
    const modelConfigurationHash = await controllerHash({ content: modelConfigurationJson });
    const version = latest.version + 1;
    const manifest = { schemaVersion: 1, controllerKind: "managed_program", programId: String(program._id),
      version, sourceStrategyAccountId: String(sourceAccount._id),
      teamVersionId: String(latest.teamVersionId), modelConfigurationId: String(modelConfigurationId),
      policyId: String(latest.policyId), strategyArtifactHash: latest.strategyArtifactHash,
      adapterProfileHash: latest.adapterProfileHash, runtimeCompatibility: latest.runtimeCompatibility,
      teamConfigHash: latest.teamConfigHash, modelConfigurationHash, policyHash: latest.policyHash };
    const contentHash = await controllerHash(manifest);
    const programVersionId = await ctx.db.insert("tradingProgramVersions", {
      programId: program._id, version, sourceStrategyAccountId: sourceAccount._id,
      teamVersionId: latest.teamVersionId, modelConfigurationId, policyId: latest.policyId,
      strategyArtifactHash: latest.strategyArtifactHash, adapterProfileHash: latest.adapterProfileHash,
      runtimeCompatibility: latest.runtimeCompatibility, teamConfigJson: latest.teamConfigJson,
      modelConfigurationJson, policyJson: latest.policyJson, teamConfigHash: latest.teamConfigHash,
      modelConfigurationHash, policyHash: latest.policyHash, contentHash,
      frozenBySubject: actor.subject, createdAt: now,
    });
    return { programVersionId, version, duplicate: false };
  },
});

/** Select research models for new runs. Customer assignments and vaults stay pinned. */
export const releaseMobileVersion = mutation({
  args: { programVersionId: v.id("tradingProgramVersions") },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "operator");
    const version = await ctx.db.get(args.programVersionId);
    const program = version ? await ctx.db.get(version.programId) : null;
    if (!version || !program || program.createdBySubject !== INTERNAL_OWNER
        || program.idempotencyKey !== INTERNAL_PROGRAM_KEY
        || !await verifyFrozenProgramVersion(version)) {
      throw new Error("Qualified internal mobile version is unavailable.");
    }
    const authority = await ctx.db.query("tradingProgramVersions")
      .withIndex("by_programId_version", (q) => q.eq("programId", program._id).eq("version", 1)).first();
    if (!await compatibleManagedAgentRelease(authority, version)) {
      throw new Error("An agent release cannot change the customer trading authority.");
    }
    if (program.releasedVersionId === version._id) return { releasedVersionId: version._id, duplicate: true };
    await ctx.db.patch(program._id, { releasedVersionId: version._id, updatedAt: Date.now() });
    return { releasedVersionId: version._id, duplicate: false, releasedBySubject: actor.subject };
  },
});
