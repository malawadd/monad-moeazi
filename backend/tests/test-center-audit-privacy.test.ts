import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertExactFeatureContract, expectedFeatureContracts } from "../scripts/feature-registry-contract.mjs";

const forbidden = ["findingCounts", "auditTraceId", "auditPackageHash"];
function includesForbidden(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(includesForbidden);
  if (value && typeof value === "object") return Object.entries(value).some(([key, item]) => forbidden.includes(key) || includesForbidden(item));
  return false;
}

test("tracked public registries contain no detailed audit metadata", () => {
  for (const path of ["agent-service/src/moeazi_agent/feature_registry.json", "docs/agentic-system-research/FEATURE-REGISTRY.json"]) {
    const registry = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(includesForbidden(registry), false);
    assert.equal(registry.features.length, 38);
  }
});

test("production boundary sources do not name private public-audit fields", () => {
  const paths = ["agent-service/src/moeazi_agent/test_center.py", "agent-service/src/moeazi_agent/test_center_fixtures.py", "agent-service/src/moeazi_agent/test_center_api.py", "agent-service/src/moeazi_agent/test_center_public.py", "scripts/check-feature-registry.mjs", "scripts/feature-registry-contract.mjs", "agent-service/src/moeazi_agent/feature_registry.json", "docs/agentic-system-research/FEATURE-REGISTRY.json"];
  for (const path of paths) assert.equal(forbidden.some((key) => readFileSync(path, "utf8").includes(key)), false, path);
});

test("every exact feature contract is executable and rejects feature-specific drift", () => {
  const registry = JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json", "utf8"));
  const checker = readFileSync("scripts/check-feature-registry.mjs", "utf8");
  assert.equal(expectedFeatureContracts.length, registry.features.length);
  assert.match(checker, /assertExactFeatureContract\(item, index, fail\)/);
  for (const [index, feature] of registry.features.entries())
    assert.doesNotThrow(() => assertExactFeatureContract(feature, index, (message: string) => { throw new Error(message); }));
  for (const key of ["ownerService", "dependencies", "supportedOperations", "effects"] as const) {
    const feature = structuredClone(registry.features[0]);
    if (key === "dependencies") feature[key] = ["drift"];
    else if (key === "supportedOperations") feature[key] = ["drift"];
    else if (key === "effects") feature[key] = { ...feature[key], authority: false };
    else feature[key] = "drift";
    assert.throws(() => assertExactFeatureContract(feature, 0, (message: string) => { throw new Error(message); }));
  }
  const layerDrift = structuredClone(registry.features[0]);
  layerDrift.layers.enforce = "available";
  assert.throws(() => assertExactFeatureContract(layerDrift, 0, (message: string) => { throw new Error(message); }));
});
