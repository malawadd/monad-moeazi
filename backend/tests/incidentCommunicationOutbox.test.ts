import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registry = JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json", "utf8"));

test("incident communication stays local, dependency-free, and authority-neutral", () => {
  const feature = registry.features.find((item: { id: string }) => item.id === "incident-communication-outbox");
  assert.deepEqual(feature.dependencies, []);
  assert.equal(feature.effects.authority, false);
  assert.equal(feature.effects.cost, false);
  assert.equal(feature.productAvailability, "unavailable");
  assert.equal(feature.defaultMode, "off");
  assert.deepEqual(feature.dependencies, []);
});
