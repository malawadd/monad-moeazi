import type { Address } from "viem";
import { managedVaultGasCapConfigured } from "./managedVaultGasBudget.js";
import { managedVaultInternalTestEnabled } from "./managedVaultPilotGate.js";

const address = /^0x[a-fA-F0-9]{40}$/;

/** Readiness of the restricted operator lane, never authority for a particular owner. */
export async function managedVaultRuntimeReadiness(env: NodeJS.ProcessEnv,
  signerAddress: string | null, balanceOf: ((owner: Address) => Promise<bigint>) | null,
  vaultAddress = "") {
  const blockers: string[] = [];
  const internal = managedVaultInternalTestEnabled(env, vaultAddress);
  if (env.LIVE_EXECUTION_ENABLED !== "true" && !internal) blockers.push("Live execution is disabled in the sidecar.");
  if (env.MAINNET_VENUE_SETUP_ENABLED !== "true") blockers.push("Mainnet venue setup is disabled in the sidecar.");
  if (!(env.CERTIFIED_VENUES ?? "").split(",").some((venue) => venue.trim().toLowerCase() === "uniswap") && !internal) {
    blockers.push("Uniswap is not enabled for live execution in the sidecar.");
  }
  if (env.MANAGED_VAULT_EXECUTION_ENABLED !== "true") blockers.push("Magic vault buy execution is disabled.");
  if (env.MANAGED_VAULT_STOP_ENABLED !== "true") blockers.push("Magic vault Stop execution is disabled.");
  if ((env.MANAGED_VAULT_EXECUTION_SECRET ?? "").length < 32) blockers.push("The Magic vault execution channel is not configured.");
  const executor = env.MANAGED_VAULT_EXECUTOR_ADDRESS ?? "";
  if (!address.test(executor) || signerAddress?.toLowerCase() !== executor.toLowerCase()) {
    blockers.push("The restricted vault executor signer is unavailable or differs from its configured address.");
  }
  const capText = env.MANAGED_VAULT_MAX_TX_GAS_COST_WEI;
  if (!managedVaultGasCapConfigured(capText)) blockers.push("The operator transaction gas cap is not configured.");
  if (!balanceOf) blockers.push("The Arbitrum read connection is unavailable.");
  let operatorGasWei: string | null = null;
  const minimumOperatorReserveWei = managedVaultGasCapConfigured(capText)
    ? (3n * BigInt(capText!)).toString() : null;
  if (balanceOf && address.test(executor) && signerAddress?.toLowerCase() === executor.toLowerCase()) {
    try {
      const balance = await balanceOf(executor as Address);
      operatorGasWei = balance.toString();
      // Buy, Stop and close each need their own operator-paid transaction.
      if (minimumOperatorReserveWei && balance < BigInt(minimumOperatorReserveWei)) {
        blockers.push("The restricted executor needs ETH for buy, Stop and close transactions.");
      }
    } catch { blockers.push("The restricted executor ETH balance could not be verified."); }
  }
  return { ready: blockers.length === 0, blockers, operatorGasWei,
    minimumOperatorReserveWei };
}
