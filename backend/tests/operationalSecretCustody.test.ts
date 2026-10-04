import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const registry = JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json", "utf8"));
const policy = JSON.parse(readFileSync(
  "agent-service/src/moeazi_agent/operational_secret_registry.json", "utf8"));

test("Feature 04 remains local-only with the exact prerequisite closure", () => {
  const feature = registry.features[3];
  assert.equal(feature.id, "operational-secret-custody");
  assert.equal(feature.defaultMode, "off");
  assert.equal(feature.productAvailability, "unavailable");
  assert.deepEqual(feature.dependencies, ["cross-state-recovery-continuity",
    "dependency-safety-envelope", "evidence-lifecycle-boundary"]);
  assert.equal(feature.layers.enforce, "isolated-test-center");
});

test("class registry binds exact recovery modes and named local workloads", () => {
  const modes = Object.fromEntries(policy.classes.map((item: any) => [item.classId, item.recoveryMode]));
  assert.deepEqual(modes, { model_provider_byok: "reenter", platform_provider_credential: "reissue",
    external_data_credential: "reissue", restricted_venue_api_credential: "reissue",
    internal_service_auth: "reissue", infrastructure_credential: "reissue",
    restricted_venue_delegate_key: "replace", vault_data_key: "rewrap",
    vault_access_binding: "restore_access", owner_auth_material: "forbidden" });
  const consumers = policy.workloads.map((item: any) => `${item.consumerId}:${item.version}`);
  assert.ok(consumers.includes("provider_egress:v1"));
  assert.ok(consumers.includes("execution_credential_boundary:v1"));
  assert.ok(policy.deniedConsumers.includes("model") && policy.deniedConsumers.includes("browser"));
});

test("registry canonical dependency order has a stable vector", () => {
  const dependencies = [...registry.features[3].dependencies].sort();
  assert.equal(createHash("sha256").update(JSON.stringify(dependencies)).digest("hex"),
    "ef7b3f329daea19dbb56e231121559fb880e46efbd28682a38113653121d93c7");
});
