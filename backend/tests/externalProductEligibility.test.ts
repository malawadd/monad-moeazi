import assert from "node:assert/strict";
import test from "node:test";
import registry from "../docs/agentic-system-research/FEATURE-REGISTRY.json";

test("external product eligibility is isolated, default-off, and non-authorizing", () => {
  const feature = registry.features.find((item: { id: string }) => item.id === "external-product-eligibility");
  assert.ok(feature);
  assert.equal(feature.availability, "available");
  assert.equal(feature.defaultMode, "off");
  assert.equal(feature.activation, "Local only");
  assert.equal(feature.productAvailability, "unavailable");
  assert.deepEqual(feature.prerequisites, ["external-usage-rights"]);
});
