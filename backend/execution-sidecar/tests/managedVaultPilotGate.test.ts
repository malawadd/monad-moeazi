import assert from "node:assert/strict";
import { test } from "node:test";
import { managedVaultBuyBroadcastEnabled, managedVaultTestStopAllowed } from "../src/managedVaultPilotGate.js";

const vault = "0x" + "a".repeat(40);
const other = "0x" + "b".repeat(40);
const internal = { NODE_ENV: "test", MAINNET_VENUE_SETUP_ENABLED: "true",
  MANAGED_VAULT_EXECUTION_ENABLED: "true", LIVE_EXECUTION_ENABLED: "false",
  CERTIFIED_VENUES: "", DEPENDENCY_SAFETY_MODE: "enforce",
  MANAGED_VAULT_INTERNAL_TEST_ADDRESS: vault,
  MANAGED_VAULT_AUTO_POLICY_MAX_USDC_UNITS: "500000" } as NodeJS.ProcessEnv;

test("the internal buy lane is restricted to one vault and exact capital cap", () => {
  assert.equal(managedVaultBuyBroadcastEnabled(internal, vault, "500000"), true);
  assert.equal(managedVaultBuyBroadcastEnabled(internal, vault, "500001"), false);
  assert.equal(managedVaultBuyBroadcastEnabled(internal, other, "1"), false);
  assert.equal(managedVaultBuyBroadcastEnabled({ ...internal,
    DEPENDENCY_SAFETY_MODE: "observe" }, vault, "1"), false);
  assert.equal(managedVaultTestStopAllowed(internal, vault), true);
  assert.equal(managedVaultTestStopAllowed(internal, other), false);
});
