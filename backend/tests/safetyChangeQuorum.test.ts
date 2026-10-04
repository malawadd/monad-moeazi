import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const registry=JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json","utf8"));
const packaged=JSON.parse(readFileSync("agent-service/src/moeazi_agent/feature_registry.json","utf8"));
test("Feature 16 registry remains local-only and Feature 17 stays unavailable",()=>{
  const feature=registry.features.find((item:{id:string})=>item.id === "safety-change-quorum");
  assert.deepEqual(feature.dependencies, []); assert.deepEqual(feature.prerequisites, []);
  assert.equal(feature.productAvailability,"unavailable"); assert.equal(feature.testCenter,"Isolated enforce");
  assert.deepEqual(packaged.features.find((item:{id:string})=>item.id===feature.id),feature);
  assert.equal(registry.features[16].id,"operator-qualification"); assert.equal(registry.features[16].availability,"available");
});
