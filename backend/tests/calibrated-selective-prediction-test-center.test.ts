import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
const read=(path:string)=>readFileSync(path,"utf8");
test("Feature 37 is narrow, explicitly selected, and fixture-only",()=>{
 const api=read("agent-service/src/moeazi_agent/test_center_selective_prediction.py");
 assert.match(api,/manipulation-aware-evidence-integrity/); assert.match(api,/portfolio-aware-sizing/); assert.match(api,/outcome-calibrated-promotion/);
 assert.doesNotMatch(api,/multi-venue-execution-quality-routing/);
 assert.doesNotMatch(api,/\bfrom\s+(requests|httpx)\b|\bimport\s+(requests|httpx)\b/i);
});
