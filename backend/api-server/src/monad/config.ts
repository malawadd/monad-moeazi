import { getAddress } from "ethers";
import { MONAD_TESTNET_RPC_URL } from "./constants.js";

export type MonadVenue = "uniswap_v4_testnet" | "moeazi_test_amm";
export class MonadApiError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "invalid_request",
    readonly details?: unknown) { super(message); }
}

function enabled(name: string) { return process.env[name]?.trim().toLowerCase() === "true"; }

export function assertMonadActionsEnabled() {
  if (!enabled("MONAD_TESTNET_ACTIONS_ENABLED")) {
    throw new MonadApiError("Monad Testnet actions are disabled by the local testnet gate.", 503, "testnet_actions_disabled");
  }
}

export function assertMonadBroadcastEnabled(operator = false) {
  assertMonadActionsEnabled();
  const gate = operator ? "MONAD_TESTNET_OPERATOR_TRADES_ENABLED" : "MONAD_TESTNET_BROADCAST_ENABLED";
  if (!enabled("MONAD_TESTNET_BROADCAST_ENABLED") || operator && !enabled(gate)) {
    throw new MonadApiError("Monad Testnet broadcast is disabled by its separate local gate.", 503, "testnet_broadcast_disabled");
  }
}

export function assertMonadAutonomyEnabled(requireBroadcast = false) {
  assertMonadActionsEnabled();
  if (!enabled("MONAD_TESTNET_AUTONOMY_ENABLED")) {
    throw new MonadApiError("Monad Testnet autonomy is disabled by its separate local testnet gate.", 503, "autonomy_disabled");
  }
  if (requireBroadcast) assertMonadBroadcastEnabled(true);
}

export function rpcUrl() {
  const value = process.env.MONAD_TESTNET_RPC_URL?.trim() || MONAD_TESTNET_RPC_URL;
  let url: URL;
  try { url = new URL(value); } catch { throw new MonadApiError("Monad Testnet RPC URL is invalid.", 503, "rpc_unavailable"); }
  if (url.protocol !== "https:" || url.hostname !== "testnet-rpc.monad.xyz" || url.username || url.password) {
    throw new MonadApiError("Monad routes only accept the official Monad Testnet RPC endpoint.", 503, "rpc_network_rejected");
  }
  return url.toString();
}

export function configuredVault() { return configuredAddress("MONAD_TESTNET_VAULT_ADDRESS"); }

export function configuredAutonomyFactory() { return configuredAddress("MONAD_TESTNET_AUTONOMY_FACTORY_ADDRESS"); }

export function configuredAdapter(venue: MonadVenue): string | null {
  const name = venue === "uniswap_v4_testnet"
    ? "MONAD_TESTNET_UNISWAP_V4_ADAPTER_ADDRESS" : "MONAD_TESTNET_MOEAZI_ADAPTER_ADDRESS";
  return configuredAddress(name);
}

function configuredAddress(name: string): string | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  try { return getAddress(value); }
  catch { throw new MonadApiError(`${name} must be a checksummed EVM address.`, 503, "config_invalid"); }
}

export function venueData(venue: MonadVenue): string {
  void venue;
  return "0x";
}

export function finalityBlocks() {
  const value = Number(process.env.MONAD_TESTNET_FINALITY_BLOCKS ?? 3);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new MonadApiError("Monad Testnet finality depth is invalid.", 503, "config_invalid");
  return value;
}

export function maxSlippageBps(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 500) {
    throw new MonadApiError("Slippage must be between 1 and 500 basis points.");
  }
  return value;
}

export function chooseVenue(value: unknown): MonadVenue {
  if (value === "uniswap_v4_testnet" || value === "moeazi_test_amm") return value;
  throw new MonadApiError("Unsupported Monad Testnet venue.", 400, "venue_unsupported");
}

export function booleanGate(name: string) { return enabled(name); }
