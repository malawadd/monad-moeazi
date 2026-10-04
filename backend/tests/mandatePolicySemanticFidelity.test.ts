import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("mandate policy registry is isolated and closed", () => {
  const registry = JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json", "utf8"));
  const feature = registry.features[17];
  assert.equal(feature.id, "mandate-policy-semantic-fidelity"); assert.equal(feature.productAvailability, "unavailable");
  assert.equal(feature.ownerService, "convex"); assert.equal(feature.effects.authority, true);
  const source = readFileSync("agent-service/src/moeazi_agent/mandate_policy_registry.json", "utf8");
  assert.match(source, /"maxOrderUsd"/); assert.match(source, /"selfHash"/);
  assert.doesNotMatch(readFileSync("convex/helpers/agentPolicy.ts", "utf8"), /mandate_policy/);
});
