import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync("agent-service/src/moeazi_agent/test_center_api.py", "utf8");
const contract = readFileSync("agent-service/src/moeazi_agent/intent_equivalence_contracts.py", "utf8");

assert.match(api, /intent-execution-equivalence/);
assert.match(contract, /product_outcome: Literal\["unavailable"\]/);
assert.match(contract, /status: Literal\["requires_revalidation"\]/);
