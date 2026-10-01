const ROLES = [
  "technical_trend", "liquidity", "derivatives", "on_chain", "news", "social",
  "cross_venue_basis", "volatility_liquidations", "whale_flow", "macro_correlation",
  "execution_quality", "portfolio_exposure", "short_horizon", "swing_horizon",
  "bull_case", "bear_case", "range_regime", "catalyst", "data_quality_skeptic",
  "market_integrity",
] as const;

const SYNTHESIS = {
  focus: ["synthesis"],
  pro: ["critic", "synthesis"],
  max: ["synthesis_primary", "synthesis_challenger", "arbiter"],
} as const;

export type OpenRouterPreferences = {
  sort: "price" | "latency" | "throughput";
  allowFallbacks: boolean;
  allowedProviders: string[];
  ignoredProviders: string[];
  dataCollection: "allow" | "deny";
  zeroDataRetention: boolean;
};

export type ModelRoute = {
  slot: string;
  provider: "openai" | "deepseek" | "openrouter";
  model: string;
  credentialSource: "platform" | "byok";
  connectionId?: string;
  maxOutputTokens: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  inputPriceMicrousdPerMillion: number;
  cachedInputPriceMicrousdPerMillion: number;
  outputPriceMicrousdPerMillion: number;
  estimatedInputPriceMicrousdPerMillion?: number;
  estimatedOutputPriceMicrousdPerMillion?: number;
  openrouter?: OpenRouterPreferences;
};

export type ModelRoutingDocument = {
  schemaVersion: 2;
  routes: ModelRoute[];
};

const platformRoute = (
  slot: string, provider: "openai" | "deepseek", model: string, maxOutputTokens: number,
): ModelRoute => ({
  slot, provider, model, credentialSource: "platform", maxOutputTokens,
  inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0,
  outputPriceMicrousdPerMillion: 0,
});

export function defaultModelRouting(): ModelRoutingDocument {
  return {
    schemaVersion: 2,
    routes: [
      platformRoute("specialist_default", "deepseek", "deepseek-v4-flash", 700),
      platformRoute("synthesis", "openai", "gpt-5.6-sol", 1_200),
      platformRoute("critic", "deepseek", "deepseek-v4-pro", 1_200),
      platformRoute("arbiter", "openai", "gpt-5.6-sol", 1_200),
      platformRoute("synthesis_primary", "openai", "gpt-5.6-sol", 1_200),
      platformRoute("synthesis_challenger", "deepseek", "deepseek-v4-pro", 1_200),
      platformRoute("policy_draft", "deepseek", "deepseek-v4-flash", 700),
    ],
  };
}

const ALLOWED_DEFAULTS = new Set([
  "specialist_default", "synthesis", "critic", "arbiter", "policy_draft",
  "synthesis_primary", "synthesis_challenger", "openai_synthesis", "deepseek_synthesis",
]);

function validSlot(slot: string) {
  return ALLOWED_DEFAULTS.has(slot)
    || (slot.startsWith("role:") && ROLES.includes(slot.slice(5) as typeof ROLES[number]));
}

export function parseModelRouting(value: string, allowUnknownByok = false): ModelRoutingDocument {
  const input = JSON.parse(value) as { schemaVersion: number; routes: ModelRoute[] };
  if (![1, 2].includes(input?.schemaVersion) || !Array.isArray(input.routes)) {
    throw new Error("Unsupported model-routing document.");
  }
  const parsed: ModelRoutingDocument = {
    schemaVersion: 2,
    routes: input.routes.map((route) => ({
      ...route,
      slot: route.slot === "openai_synthesis" ? "synthesis_primary"
        : route.slot === "deepseek_synthesis" ? "synthesis_challenger" : route.slot,
      openrouter: route.provider === "openrouter" ? {
        sort: route.openrouter?.sort ?? "price",
        allowFallbacks: route.openrouter?.allowFallbacks ?? true,
        allowedProviders: route.openrouter?.allowedProviders ?? [],
        ignoredProviders: route.openrouter?.ignoredProviders ?? [],
        dataCollection: route.openrouter?.dataCollection ?? "deny",
        zeroDataRetention: route.openrouter?.zeroDataRetention ?? true,
      } : undefined,
    })),
  };
  if (parsed.routes.length < 2 || parsed.routes.length > 32) {
    throw new Error("Model routing must contain 2-32 routes.");
  }
  const slots = new Set<string>();
  const credentials = new Map<string, string>();
  for (const route of parsed.routes) {
    if (!validSlot(route.slot) || slots.has(route.slot)) throw new Error(`Invalid or duplicate route: ${route.slot}`);
    slots.add(route.slot);
    if (!["openai", "deepseek", "openrouter"].includes(route.provider)) throw new Error("Unsupported model provider.");
    if (!["platform", "byok"].includes(route.credentialSource)) throw new Error("Unsupported credential source.");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(route.model)) throw new Error("Invalid model ID.");
    if (route.credentialSource === "byok" && !route.connectionId) throw new Error("BYOK routes require a connection.");
    if (route.provider !== "openrouter" && route.openrouter) {
      throw new Error("OpenRouter preferences require an OpenRouter route.");
    }
    if (route.openrouter) validateOpenRouter(route.openrouter);
    const credential = `${route.credentialSource}:${route.connectionId ?? "platform"}`;
    const current = credentials.get(route.provider);
    if (current && current !== credential) throw new Error("Each provider must use one credential source per configuration.");
    credentials.set(route.provider, credential);
    if (route.maxOutputTokens < 128 || route.maxOutputTokens > 8_192) throw new Error("Invalid output-token cap.");
    for (const price of [
      route.inputPriceMicrousdPerMillion, route.cachedInputPriceMicrousdPerMillion,
      route.outputPriceMicrousdPerMillion, route.estimatedInputPriceMicrousdPerMillion ?? 0,
      route.estimatedOutputPriceMicrousdPerMillion ?? 0,
    ]) {
      if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) throw new Error("Invalid model rate.");
    }
    if (!allowUnknownByok && route.credentialSource === "byok" && route.inputPriceMicrousdPerMillion === 0 && route.outputPriceMicrousdPerMillion === 0) {
      throw new Error(`BYOK route ${route.slot} requires confirmed model rates.`);
    }
  }
  if (!slots.has("specialist_default") || !slots.has("synthesis")) {
    throw new Error("Specialist and synthesis defaults are required.");
  }
  return parsed;
}

function validateOpenRouter(value: OpenRouterPreferences) {
  if (!["price", "latency", "throughput"].includes(value.sort)) throw new Error("Invalid OpenRouter sort.");
  if (!["allow", "deny"].includes(value.dataCollection)) throw new Error("Invalid OpenRouter data policy.");
  const overlap = value.allowedProviders.filter((item) => value.ignoredProviders.includes(item));
  if (overlap.length) throw new Error("An upstream provider cannot be both allowed and ignored.");
  const providers = [...value.allowedProviders, ...value.ignoredProviders];
  if (providers.length > 40 || providers.some((item) => !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$/.test(item))) {
    throw new Error("Invalid OpenRouter upstream provider.");
  }
}

function routeFor(routes: ModelRoute[], slot: string) {
  return routes.find((item) => item.slot === slot)
    ?? routes.find((item) => item.slot === (slot.startsWith("role:") ? "specialist_default" : "synthesis"))!;
}

export function estimateModelRouting(
  document: ModelRoutingDocument, tier: "focus" | "pro" | "max",
  roleConfiguration?: Array<{ id: string; enabled: boolean }>,
) {
  const base = roleConfiguration
    ? roleConfiguration.filter((role) => role.enabled).map((role) => role.id)
    : ROLES.slice(0, { focus: 6, pro: 12, max: 20 }[tier]);
  const expected = { focus: 6, pro: 12, max: 20 }[tier];
  const critical = tier === "focus" ? ["liquidity", "derivatives"]
    : ["liquidity", "derivatives", "cross_venue_basis", "volatility_liquidations"];
  if (base.length !== expected || new Set(base).size !== base.length
      || base.some((role) => !ROLES.includes(role as typeof ROLES[number]))
      || critical.some((role) => !base.includes(role))) {
    throw new Error("Saved specialist composition is invalid.");
  }
  const roles = tier === "pro"
    ? [...base, ...critical]
    : tier === "max" ? [...base, ...base.filter((role) => [
      "technical_trend", "liquidity", "derivatives", "cross_venue_basis", "volatility_liquidations",
      "whale_flow", "portfolio_exposure", "short_horizon", "swing_horizon", "bull_case", "bear_case",
    ].includes(role)).slice(0, 10)] : base;
  const calls = [
    ...roles.map((role) => ({ route: routeFor(document.routes, `role:${role}`), kind: "specialist" })),
    ...SYNTHESIS[tier].map((step) => ({ route: routeFor(document.routes, step), kind: step === "arbiter" ? "arbiter" : "synthesis" })),
  ];
  const credits = calls.reduce((sum, call) => {
    if (call.route.credentialSource === "platform") return sum + (call.kind === "specialist" ? 3 : call.kind === "arbiter" ? 9 : 7);
    return sum + (call.kind === "specialist" ? 1 : call.kind === "arbiter" ? 3 : 2);
  }, 0);
  const cost = (route: ModelRoute, maximum: boolean) => {
    if (route.credentialSource !== "byok" && route.provider !== "openrouter") return 0;
    const input = maximum ? route.inputPriceMicrousdPerMillion
      : route.estimatedInputPriceMicrousdPerMillion ?? route.inputPriceMicrousdPerMillion;
    const output = maximum ? route.outputPriceMicrousdPerMillion
      : route.estimatedOutputPriceMicrousdPerMillion ?? route.outputPriceMicrousdPerMillion;
    return Math.round(input * 2_500 / 1_000_000)
      + Math.round(output * route.maxOutputTokens / 1_000_000);
  };
  return {
    calls: calls.length, credits,
    estimatedProviderCostMicrousd: calls.reduce((sum, call) => sum + cost(call.route, false), 0),
    maximumProviderCostMicrousd: calls.reduce((sum, call) => sum + cost(call.route, true), 0),
  };
}
