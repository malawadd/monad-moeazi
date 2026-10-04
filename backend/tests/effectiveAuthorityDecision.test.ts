import assert from "node:assert/strict";
import test from "node:test";
import registry from "../docs/agentic-system-research/FEATURE-REGISTRY.json" with { type: "json" };
test("Feature 19 remains local, non-authorizing and default off", () => {
  const feature=registry.features.find((item) => item.id === "effective-authority-decision");
  assert.ok(feature); assert.equal(feature.defaultMode,"off"); assert.equal(feature.productAvailability,"unavailable");
  assert.equal(feature.layers.enforce,"isolated-test-center"); assert.equal(feature.effects.authority,true);
  assert.match(feature.remainingGate,/Authoritative owner integration/);
});
