import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const registry=JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json","utf8"));
const feature=registry.features.find((x:{id:string})=>x.id==="system-safety-assurance-corpus");
test("assurance registry is isolated",()=>{assert.equal(feature.availability,"available");assert.equal(feature.defaultMode,"off");assert.equal(feature.productAvailability,"unavailable");assert.equal(feature.layers.enforce,"isolated-test-center");assert.equal(feature.effects.authority,false);});
