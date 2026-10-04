import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("product eligibility evaluator revalidates and cannot authorize execution", () => {
  const api = readFileSync("agent-service/src/moeazi_agent/test_center_product_eligibility.py", "utf8");
  assert.match(api, /requires_revalidation/);
  assert.doesNotMatch(api, /sign|broadcast|provider|wallet|venue\(/i);
});
