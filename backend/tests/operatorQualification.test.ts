import assert from "node:assert/strict";
import test from "node:test";
import registry from "../docs/agentic-system-research/FEATURE-REGISTRY.json";

test("Feature 17 is local-only and has no authority or dependencies", () => {
  const feature = registry.features.find((item) => item.id === "operator-qualification");
  assert.ok(feature);
  assert.deepEqual(feature.dependencies, []);
  assert.deepEqual(feature.effects, { authority: false, cost: false, persistence: true, sideEffects: false });
  assert.equal(feature.productAvailability, "unavailable");
  assert.equal(feature.audit, "Reviewed — archived privately");
  assert.equal(feature.testCenter, "Isolated enforce");
});
