import assert from "node:assert/strict";
import test from "node:test";
import { scopedAllowanceReadiness } from "../app/api/mobile/autopilot/scoped-grant/allowanceReadiness";

const owner = "0x1111111111111111111111111111111111111111";
const grantId = "managed-grant-12345678";
const hash = `0x${"a".repeat(64)}`;
const usdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const weth = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const routerCap = "10000000000000000";

function read(scope: "buy" | "exit", balanceUnits: string, allowanceUnits: string) {
  const requiredUnits = routerCap;
  const balanceReady = BigInt(balanceUnits) >= BigInt(requiredUnits);
  const allowanceReady = BigInt(allowanceUnits) >= BigInt(requiredUnits);
  return {grantId, scope, owner, blockNumber: "123", blockHash: hash,
    token: scope === "buy" ? usdc : weth, requiredUnits, balanceUnits, allowanceUnits,
    balanceReady, allowanceReady, ready: balanceReady && allowanceReady};
}

test("buy activation requires both finalized USDC balance and exact router allowance", () => {
  const context = {grantId, owner, scope: "buy" as const, requiredUnits: routerCap};
  assert.deepEqual(scopedAllowanceReadiness(read("buy", routerCap, routerCap), context), {
    balanceReady: true, allowanceReady: true, spendReady: true, activationReady: true,
  });
  const unfunded = scopedAllowanceReadiness(read("buy", "0", routerCap), context);
  assert.equal(unfunded?.balanceReady, false);
  assert.equal(unfunded?.allowanceReady, true);
  assert.equal(unfunded?.activationReady, false);
});

test("exit activation needs exact WETH allowance but not a pre-existing WETH position", () => {
  const context = {grantId, owner, scope: "exit" as const, requiredUnits: routerCap};
  const readiness = scopedAllowanceReadiness(read("exit", "0", routerCap), context);
  assert.deepEqual(readiness, {
    balanceReady: false, allowanceReady: true, spendReady: false, activationReady: true,
  });
  assert.equal(scopedAllowanceReadiness(read("exit", routerCap, "0"), context)?.activationReady, false);
});

test("unbound or internally inconsistent finalized reads fail closed", () => {
  const context = {grantId, owner, scope: "exit" as const, requiredUnits: routerCap};
  assert.equal(scopedAllowanceReadiness({...read("exit", "0", routerCap), owner: "0x2222222222222222222222222222222222222222"}, context), null);
  assert.equal(scopedAllowanceReadiness({...read("exit", "0", routerCap), ready: true}, context), null);
  assert.equal(scopedAllowanceReadiness({...read("exit", "0", routerCap), allowanceReady: false}, context), null);
});
