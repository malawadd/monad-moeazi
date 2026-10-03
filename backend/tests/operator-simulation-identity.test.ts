import assert from "node:assert/strict";
import { test } from "node:test";
import { assertOwnedSimulationReferences } from "../api-server/src/operator/operations.js";

const owner = { userId: "operator-user", strategyAccountId: "operator-account", experimentSpecIds: new Set(["operator-spec"]) };

test("simulation proxy accepts only fixed operator-owned identity references", () => {
  assert.doesNotThrow(() => assertOwnedSimulationReferences({
    experiment_spec_id: "operator-spec", manifest: { scope: { scope_id: "operator-spec", strategy_account_id: "operator-account" } },
  }, owner));
  assert.throws(() => assertOwnedSimulationReferences({ experiment_spec_id: "customer-spec" }, owner), /only an experiment spec owned/);
  assert.throws(() => assertOwnedSimulationReferences({ manifest: { scope: { strategy_account_id: "customer-account" } } }, owner), /only the local operator strategy account/);
  assert.throws(() => assertOwnedSimulationReferences({ userId: "customer-user" }, owner), /may not select another user/);
});
