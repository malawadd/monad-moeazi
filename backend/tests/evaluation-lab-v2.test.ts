import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_BUILDER, buildV2Spec, builderComplete, preciseUsd,
  type BuilderState, type EvaluationCatalogV2,
} from "../lib/evaluationLabV2";
import { EVALUATION_PRESETS } from "../lib/evaluationPresets";

const catalog = {
  markets: [
    { market: "BTC-USD", venues: ["hyperliquid"], readiness: "ready" },
    { market: "ETH-USD", venues: ["hyperliquid"], readiness: "ready" },
  ],
  configurations: [], roles: [{
    id: "technical_trend", horizon: "hours", critical: false,
    directionalOrRisk: true, purpose: "Technical trend",
  }],
  horizons: ["5m", "1h", "4h", "24h"],
  builtInSafetyCases: [], globalDailyLimitMicrousd: 100_000,
  systemBoundary: "shadow only",
  defaultPromptBundle: { prompts: {}, schemas: {} },
} satisfies EvaluationCatalogV2;

function complete(): BuilderState {
  return {
    ...EMPTY_BUILDER, name: "Finite BTC replay", mode: "replay",
    markets: ["BTC-USD"], safetyCases: ["prompt_injection"],
    repetitions: "2", confirmed: true,
    subjects: [{
      id: "champion", label: "Champion", kind: "champion", tier: "focus",
      configuration: "platform", roles: ["technical_trend"],
      quorum: "1", promptBundle: "agent-v2", routeOverrides: {},
    }],
  };
}

test("evaluation builder begins with no implicit scope", () => {
  assert.deepEqual(EMPTY_BUILDER.markets, []);
  assert.deepEqual(EMPTY_BUILDER.subjects, []);
  assert.deepEqual(EMPTY_BUILDER.horizons, []);
  assert.equal(EMPTY_BUILDER.mode, "");
  assert.equal(builderComplete(EMPTY_BUILDER), false);
});

test("preview can be complete before final shadow confirmation", () => {
  const value = { ...complete(), confirmed: false };
  assert.equal(builderComplete(value, false), true);
  assert.equal(builderComplete(value), false);
});

test("v2 spec carries only explicit selections", () => {
  const spec = buildV2Spec(complete(), catalog);
  assert.deepEqual(spec.markets, ["BTC-USD"]);
  assert.deepEqual(spec.safety_cases, ["prompt_injection"]);
  assert.deepEqual(spec.subjects[0].selected_roles, ["technical_trend"]);
  assert.equal(spec.subjects[0].configuration_version, undefined);
});

test("sub-cent observation costs keep useful precision", () => {
  assert.equal(preciseUsd(13_191), "$0.013191");
  assert.equal(preciseUsd(5_843), "$0.005843");
});

test("ETH guarded preset freezes ETH-only scope and a five-dollar cap", () => {
  const preset = EVALUATION_PRESETS.find((item) => item.id === "eth-guarded-30d-v1");
  const state = preset?.create(catalog);
  assert.ok(state);
  assert.deepEqual(state.markets, ["ETH-USD"]);
  assert.equal(state.presetCostCapMicrousd, 5_000_000);
  const spec = buildV2Spec(state, catalog);
  assert.equal(spec.preset_id, "eth-guarded-30d-v1");
  assert.equal(spec.preset_cost_cap_microusd, 5_000_000);
  assert.equal(spec.replay_repetitions, 1);
  assert.equal(state.confirmed, false);
});

test("starter presets are opt-in and leave the empty builder untouched", () => {
  assert.equal(EMPTY_BUILDER.presetId, "");
  assert.equal(EMPTY_BUILDER.presetCostCapMicrousd, null);
  assert.deepEqual(EMPTY_BUILDER.markets, []);
});
