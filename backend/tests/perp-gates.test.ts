import test from "node:test";
import assert from "node:assert/strict";
import { canBroadcastPerpKind, perpRecoveryBroadcastOpen, perpRoutineGateOpen } from "../api-server/src/monad/perpGates.js";

const gateNames = ["MONAD_TESTNET_ACTIONS_ENABLED", "MONAD_TESTNET_BROADCAST_ENABLED",
  "MONAD_TESTNET_OPERATOR_TRADES_ENABLED", "MONAD_TESTNET_PERP_AUTONOMY_ENABLED"];
function withGates(values: Record<string, string | undefined>, action: () => void) {
  const previous = Object.fromEntries(gateNames.map((name) => [name, process.env[name]]));
  for (const name of gateNames) values[name] === undefined ? delete process.env[name] : process.env[name] = values[name]!;
  try { action(); } finally {
    for (const name of gateNames) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name]!;
  }
}

test("routine perp actions need every separate action, broadcast, operator, and perp gate", () => {
  withGates(Object.fromEntries(gateNames.map((name) => [name, "true"])), () => {
    assert.equal(perpRoutineGateOpen(), true);
    assert.equal(canBroadcastPerpKind("market_entry"), true);
  });
  withGates({ MONAD_TESTNET_ACTIONS_ENABLED: "true", MONAD_TESTNET_BROADCAST_ENABLED: "true",
    MONAD_TESTNET_OPERATOR_TRADES_ENABLED: "true", MONAD_TESTNET_PERP_AUTONOMY_ENABLED: "false" }, () => {
    assert.equal(perpRoutineGateOpen(), false);
    assert.equal(canBroadcastPerpKind("market_entry"), false);
  });
});

test("recovery broadcasts remain available when the autonomy or action gate is off", () => {
  withGates({ MONAD_TESTNET_ACTIONS_ENABLED: "false", MONAD_TESTNET_BROADCAST_ENABLED: "true",
    MONAD_TESTNET_OPERATOR_TRADES_ENABLED: "true", MONAD_TESTNET_PERP_AUTONOMY_ENABLED: "false" }, () => {
    assert.equal(perpRecoveryBroadcastOpen(), true);
    assert.equal(canBroadcastPerpKind("settle_expired"), true);
    assert.equal(canBroadcastPerpKind("close_position"), true);
    assert.equal(canBroadcastPerpKind("stop"), true);
    assert.equal(canBroadcastPerpKind("market_entry"), false);
  });
});
