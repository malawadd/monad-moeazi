import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
test("Feature 20 registry remains isolated and non-product",()=>{
 const registry=JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json","utf8")); const item=registry.features.find((row:any)=>row.id==="risk-tiered-approval-consent");
 assert.equal(item.implementation,"Implemented"); assert.equal(item.productAvailability,"unavailable"); assert.equal(item.testCenter,"Isolated enforce"); assert.equal(item.effects.cost,false);
});
