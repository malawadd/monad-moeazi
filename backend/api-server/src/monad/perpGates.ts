const recoveryActions = new Set(["stop", "settle_expired", "liquidate", "close_position", "execute_trigger",
  "cancel_limit", "reduce_size", "add_margin", "set_triggers", "accrue_funding"]);

export function perpRoutineGateOpen() {
  return ["MONAD_TESTNET_ACTIONS_ENABLED", "MONAD_TESTNET_BROADCAST_ENABLED",
    "MONAD_TESTNET_OPERATOR_TRADES_ENABLED", "MONAD_TESTNET_PERP_AUTONOMY_ENABLED"]
    .every((key) => process.env[key]?.trim().toLowerCase() === "true");
}

export function perpRecoveryBroadcastOpen() {
  return ["MONAD_TESTNET_BROADCAST_ENABLED", "MONAD_TESTNET_OPERATOR_TRADES_ENABLED"]
    .every((key) => process.env[key]?.trim().toLowerCase() === "true");
}

export function canBroadcastPerpKind(kind: string) {
  return recoveryActions.has(kind) ? perpRecoveryBroadcastOpen() : perpRoutineGateOpen();
}

export function isPerpRecoveryAction(kind: string) { return recoveryActions.has(kind); }
