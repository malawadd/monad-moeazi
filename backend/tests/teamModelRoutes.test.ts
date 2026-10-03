import assert from "node:assert/strict";
import { test } from "node:test";
import { parseModelRouting } from "../convex/helpers/modelRouting";
import { platformModels, presetRouting, type ProviderConnection } from "../lib/modelProviders";
import { chooseProviderSource, chooseRouteModel, routeProblems } from "../lib/teamModelRoutes";

const connection: ProviderConnection = {
  _id: "owned-deepseek", provider: "deepseek", label: "Research key", keyLast4: "1234", status: "verified",
  models: platformModels.deepseek, capabilities: { compatibleModels: ["deepseek-v4-flash"] }, version: 1,
};

test("new Balanced presets use priced terra while saved documents remain untouched", () => {
  const balanced = presetRouting("balanced");
  assert.equal(balanced.routes.find((route) => route.slot === "specialist_default")?.model, "gpt-5.6-terra");
  assert.equal(routeProblems(balanced, []).some((item) => item.includes("pricing is unknown")), false);
  const saved = presetRouting("balanced");
  saved.routes[0].model = "gpt-5.4-mini";
  saved.routes[0].inputPriceMicrousdPerMillion = 0;
  assert.ok(routeProblems(saved, []).some((item) => item.includes("gpt-5.4-mini")));
});

test("provider source changes every matching stage without replacing model IDs", () => {
  const original = presetRouting("economy");
  const before = original.routes.filter((route) => route.provider === "deepseek").map((route) => route.model);
  const changed = chooseProviderSource(original, "deepseek", connection._id, [connection]);
  const routes = changed.routes.filter((route) => route.provider === "deepseek");
  assert.deepEqual(routes.map((route) => route.model), before);
  assert.ok(routes.every((route) => route.credentialSource === "byok" && route.connectionId === connection._id));
  assert.ok(original.routes.every((route) => route.credentialSource === "platform"));
  assert.doesNotThrow(() => parseModelRouting(JSON.stringify(changed), true));
  assert.throws(() => chooseProviderSource(original, "deepseek", "another-account", [connection]), /verified/);
});

test("unknown your-key model is retained for review and identified precisely", () => {
  const changed = chooseProviderSource(presetRouting("economy"), "deepseek", connection._id, [connection]);
  const draft = chooseRouteModel(changed, "critic", "unpriced-test-model", [connection]);
  const critic = draft.routes.find((route) => route.slot === "critic")!;
  assert.equal(critic.model, "unpriced-test-model");
  assert.equal(critic.inputPriceMicrousdPerMillion, 0);
  assert.ok(routeProblems(draft, [connection]).some((item) => item.includes("Critic · unpriced-test-model")
    && item.includes("your provider account")));
  assert.doesNotThrow(() => parseModelRouting(JSON.stringify(draft), true));
  assert.throws(() => parseModelRouting(JSON.stringify(draft)), /confirmed model rates/);
});
