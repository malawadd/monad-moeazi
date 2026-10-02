import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const registry=JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json","utf8"));
test("claim ledger is an isolated private research surface",()=>{
 const feature=registry.features.find((x:{id:string})=>x.id==="claim-disagreement-ledger");
 assert.equal(feature.availability,"available"); assert.equal(feature.productAvailability,"unavailable");
 assert.equal(feature.defaultMode,"off");
 assert.equal(feature.effects.authority,false);
});
