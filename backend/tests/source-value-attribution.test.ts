import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const registry=JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json","utf8"));
test("source-value attribution is a narrow, non-causal fixture surface",()=>{
 const feature=registry.features.find((item:{id:string})=>item.id==="specialist-source-value-attribution");
 assert.equal(feature.availability,"available"); assert.equal(feature.productAvailability,"unavailable");
 assert.equal(feature.defaultMode,"off");
 assert.equal(feature.effects.authority,false);
});
