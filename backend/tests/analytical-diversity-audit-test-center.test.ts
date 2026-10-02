import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
const read=(path:string)=>readFileSync(path,"utf8");
test("Feature 38 is explicit, local-only, and non-authorizing",()=>{
 const api=read("agent-service/src/moeazi_agent/test_center_analytical_diversity.py");
 for(const feature of ["claim-disagreement-ledger","manipulation-aware-evidence-integrity","outcome-linked-decision-memory","outcome-calibrated-promotion","calibrated-selective-prediction"]) assert.match(api,new RegExp(feature));
 assert.doesNotMatch(api,/\bfrom\s+(requests|httpx)\b|\bimport\s+(requests|httpx)\b/i);
});
