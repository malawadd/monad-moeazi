import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Feature 21 is local-only and operation scoped", () => {
  const registry = JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json", "utf8"));
  const feature = registry.features.find((item: { id: string }) => item.id === "external-usage-rights");
  assert.equal(feature.availability, "available"); assert.equal(feature.defaultMode, "off");
  assert.equal(feature.layers.enforce, "isolated-test-center"); assert.equal(feature.productAvailability, "unavailable");
  assert.deepEqual(feature.dependencies, ["evidence-lifecycle-boundary"]);
});
