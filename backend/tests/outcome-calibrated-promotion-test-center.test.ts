import test from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs";
const read=(path:string)=>readFileSync(path,"utf8");
test("Feature 36 stays fixture-only and has no activation surface",()=>{
 const api=read("agent-service/src/moeazi_agent/test_center_promotion.py");
 assert.match(api,/calibrated-shadow-execution-tca/); assert.match(api,/outcome-linked-decision-memory/);
 assert.doesNotMatch(api,/activate\(|rollback\(|broadcast\(/i);
});
