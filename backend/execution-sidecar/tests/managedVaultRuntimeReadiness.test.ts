import assert from "node:assert/strict";
import { test } from "node:test";
import { managedVaultRuntimeReadiness } from "../src/managedVaultRuntimeReadiness.js";

const executor = "0x1111111111111111111111111111111111111111";
const live = { NODE_ENV: "test", LIVE_EXECUTION_ENABLED: "true", MAINNET_VENUE_SETUP_ENABLED: "true",
  CERTIFIED_VENUES: "uniswap", MANAGED_VAULT_EXECUTION_ENABLED: "true",
  MANAGED_VAULT_STOP_ENABLED: "true", MANAGED_VAULT_EXECUTION_SECRET: "x".repeat(32),
  MANAGED_VAULT_EXECUTOR_ADDRESS: executor,
  MANAGED_VAULT_MAX_TX_GAS_COST_WEI: "1000" } as NodeJS.ProcessEnv;

test("Magic vault runtime requires a matching signer and gas for buy, Stop and close", async () => {
  const ready = await managedVaultRuntimeReadiness(live, executor, async () => 3000n);
  assert.equal(ready.ready, true);
  assert.equal(ready.minimumOperatorReserveWei, "3000");
  const lowGas = await managedVaultRuntimeReadiness(live, executor, async () => 2999n);
  assert.equal(lowGas.ready, false);
  assert.match(lowGas.blockers[0], /needs ETH/i);
  const wrongSigner = await managedVaultRuntimeReadiness(live,
    "0x2222222222222222222222222222222222222222", async () => 3000n);
  assert.equal(wrongSigner.ready, false);
  assert.equal(wrongSigner.operatorGasWei, null);
});

test("development defaults cannot be reported as live vault readiness", async () => {
  const result = await managedVaultRuntimeReadiness({ NODE_ENV: "test" }, null, null);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some((item) => /Live execution is disabled/.test(item)));
  assert.ok(result.blockers.some((item) => /Stop execution is disabled/.test(item)));
});

test("internal qualification only reports ready for its exact vault", async () => {
  const vault = "0x" + "a".repeat(40);
  const internal = { ...live, LIVE_EXECUTION_ENABLED: "false", CERTIFIED_VENUES: "",
    DEPENDENCY_SAFETY_MODE: "enforce", MANAGED_VAULT_INTERNAL_TEST_ADDRESS: vault,
    MANAGED_VAULT_AUTO_POLICY_MAX_USDC_UNITS: "500000" };
  assert.equal((await managedVaultRuntimeReadiness(internal, executor,
    async () => 3000n, vault)).ready, true);
  assert.equal((await managedVaultRuntimeReadiness(internal, executor,
    async () => 3000n, "0x" + "b".repeat(40))).ready, false);
});
