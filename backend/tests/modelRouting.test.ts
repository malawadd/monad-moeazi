import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultModelRouting,
  estimateModelRouting,
  parseModelRouting,
} from "../convex/helpers/modelRouting";

test("BYOK routes reduce credits while exposing provider cost", () => {
  const platform = defaultModelRouting();
  const byok = {
    ...platform,
    routes: platform.routes.map((route) => ({
      ...route,
      credentialSource: "byok" as const,
      connectionId: `connection-${route.provider}`,
      inputPriceMicrousdPerMillion: 1_000_000,
      cachedInputPriceMicrousdPerMillion: 100_000,
      outputPriceMicrousdPerMillion: 2_000_000,
    })),
  };

  const platformEstimate = estimateModelRouting(platform, "focus");
  const byokEstimate = estimateModelRouting(byok, "focus");
  assert.equal(platformEstimate.calls, 7);
  assert.ok(byokEstimate.credits < platformEstimate.credits);
  assert.equal(platformEstimate.estimatedProviderCostMicrousd, 0);
  assert.ok(byokEstimate.estimatedProviderCostMicrousd > 0);
});

test("model routing rejects missing BYOK credentials and zero rates", () => {
  const document = defaultModelRouting();
  document.routes[0] = {
    ...document.routes[0],
    credentialSource: "byok",
    connectionId: undefined,
  };
  assert.throws(() => parseModelRouting(JSON.stringify(document)), /require a connection/);

  document.routes[0].connectionId = "connection-openai";
  assert.throws(() => parseModelRouting(JSON.stringify(document)), /confirmed model rates/);
});

test("OpenRouter accepts platform or BYOK with safe defaults", () => {
  const document = defaultModelRouting();
  document.routes[0] = {
    ...document.routes[0],
    provider: "openrouter",
    model: "anthropic/claude-sonnet",
    credentialSource: "byok",
    connectionId: "connection-openrouter",
    inputPriceMicrousdPerMillion: 3_000_000,
    cachedInputPriceMicrousdPerMillion: 3_000_000,
    outputPriceMicrousdPerMillion: 15_000_000,
  };
  const parsed = parseModelRouting(JSON.stringify(document));
  assert.equal(parsed.routes[0].openrouter?.sort, "price");
  assert.equal(parsed.routes[0].openrouter?.dataCollection, "deny");
  assert.equal(parsed.routes[0].openrouter?.zeroDataRetention, true);

  document.routes[0].credentialSource = "platform";
  document.routes[0].connectionId = undefined;
  const platformOpenRouter = parseModelRouting(JSON.stringify(document));
  assert.equal(platformOpenRouter.routes[0].credentialSource, "platform");
  assert.ok(estimateModelRouting(platformOpenRouter, "focus").maximumProviderCostMicrousd > 0);
});

test("legacy Max synthesis slots normalize to provider-neutral names", () => {
  const legacy = {
    ...defaultModelRouting(),
    schemaVersion: 1,
    routes: defaultModelRouting().routes.map((route) => ({
      ...route,
      slot: route.slot === "synthesis_primary" ? "openai_synthesis"
        : route.slot === "synthesis_challenger" ? "deepseek_synthesis" : route.slot,
    })),
  };
  const parsed = parseModelRouting(JSON.stringify(legacy));
  assert.equal(parsed.schemaVersion, 2);
  assert.ok(parsed.routes.some((route) => route.slot === "synthesis_primary"));
  assert.ok(parsed.routes.some((route) => route.slot === "synthesis_challenger"));
});
