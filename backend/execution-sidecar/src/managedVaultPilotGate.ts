/** An internal funded qualification can permit exactly one vault, without opening other routes. */
const address = /^0x[a-f0-9]{40}$/;
const units = /^[1-9][0-9]*$/;

export function managedVaultInternalTestEnabled(env: NodeJS.ProcessEnv, vaultAddress: string,
  amountIn?: string): boolean {
  const selected = env.MANAGED_VAULT_INTERNAL_TEST_ADDRESS ?? "";
  const cap = env.MANAGED_VAULT_AUTO_POLICY_MAX_USDC_UNITS ?? "";
  if (!address.test(selected) || vaultAddress.toLowerCase() !== selected
    || env.DEPENDENCY_SAFETY_MODE !== "enforce" || !units.test(cap)) return false;
  return amountIn === undefined || units.test(amountIn) && BigInt(amountIn) <= BigInt(cap);
}

export function managedVaultBuyBroadcastEnabled(env: NodeJS.ProcessEnv,
  vaultAddress: string, amountIn: string): boolean {
  if (env.MAINNET_VENUE_SETUP_ENABLED !== "true"
    || env.MANAGED_VAULT_EXECUTION_ENABLED !== "true") return false;
  const certified = (env.CERTIFIED_VENUES ?? "").split(",")
    .some((venue) => venue.trim().toLowerCase() === "uniswap");
  return env.LIVE_EXECUTION_ENABLED === "true" && certified
    || managedVaultInternalTestEnabled(env, vaultAddress, amountIn);
}

export function managedVaultTestStopAllowed(env: NodeJS.ProcessEnv,
  vaultAddress: string): boolean {
  const selected = env.MANAGED_VAULT_INTERNAL_TEST_ADDRESS ?? "";
  return !selected || address.test(selected) && vaultAddress.toLowerCase() === selected;
}
