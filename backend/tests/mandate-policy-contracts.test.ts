import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
test("strict mandate policy contracts enumerate typed causal fields", () => {
  const compiled = readFileSync("agent-service/src/moeazi_agent/mandate_policy_compilation_contracts.py", "utf8");
  const consent = readFileSync("agent-service/src/moeazi_agent/mandate_policy_consent_contracts.py", "utf8");
  for (const field of ["max_order_usd", "require_stop_loss", "daily_credit_budget", "effective_at", "scope_hash"]) assert.match(compiled, new RegExp(field));
  for (const field of ["tenant_fingerprint", "prior_activation_hash", "test_hash", "idempotency_hash", "history_append_hash"]) assert.match(consent, new RegExp(field));
  assert.doesNotMatch(compiled, /values:\s*dict/);
});
