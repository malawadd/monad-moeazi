import type { Address, Hex, PublicClient } from "viem";

type VaultTransaction = { account: Address; to: Address; data: Hex };

export function managedVaultGasCapConfigured(capText: string | undefined) {
  return !!capText && /^[1-9][0-9]*$/.test(capText);
}

/** Review the maximum payable gas before any managed-vault broadcast. */
export async function boundedManagedVaultGas(client: PublicClient,
  transaction: VaultTransaction, capText: string | undefined) {
  if (!capText || !managedVaultGasCapConfigured(capText)) {
    throw new Error("A positive MANAGED_VAULT_MAX_TX_GAS_COST_WEI is required");
  }
  const cap = BigInt(capText);
  const [estimate, fees, balance] = await Promise.all([
    client.estimateGas({ account: transaction.account, to: transaction.to,
      data: transaction.data, value: 0n }),
    client.estimateFeesPerGas(),
    client.getBalance({ address: transaction.account }),
  ]);
  if (!("maxFeePerGas" in fees) || !fees.maxFeePerGas
    || !("maxPriorityFeePerGas" in fees) || fees.maxPriorityFeePerGas === undefined) {
    throw new Error("An EIP-1559 Arbitrum fee quote is required");
  }
  const gas = estimate + estimate / 5n + 10_000n;
  const maxCost = gas * fees.maxFeePerGas;
  if (maxCost > cap) throw new Error("Managed vault transaction exceeds the operator gas cap");
  if (balance < maxCost) throw new Error("The restricted executor lacks ETH for this transaction");
  return { gas, maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}
