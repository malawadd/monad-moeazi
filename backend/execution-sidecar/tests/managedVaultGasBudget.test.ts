import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicClient } from "viem";
import { boundedManagedVaultGas, managedVaultGasCapConfigured } from "../src/managedVaultGasBudget.js";

const transaction = { account: "0x1111111111111111111111111111111111111111" as const,
  to: "0x2222222222222222222222222222222222222222" as const,
  data: "0x12345678" as const };

function client(balance: bigint) {
  return { estimateGas: async () => 100_000n,
    estimateFeesPerGas: async () => ({ maxFeePerGas: 20_000_000n,
      maxPriorityFeePerGas: 1_000_000n }),
    getBalance: async () => balance } as unknown as PublicClient;
}

test("vault gas must fit both the explicit operator cap and executor balance", async () => {
  assert.equal(managedVaultGasCapConfigured(undefined), false);
  assert.equal(managedVaultGasCapConfigured("0"), false);
  assert.equal(managedVaultGasCapConfigured("3000000000000"), true);
  const enough = client(3_000_000_000_000n);
  await assert.rejects(boundedManagedVaultGas(enough, transaction, undefined), /gas_cost_wei/i);
  await assert.rejects(boundedManagedVaultGas(enough, transaction, "1"), /operator gas cap/i);
  await assert.rejects(boundedManagedVaultGas(client(1n), transaction,
    "3000000000000"), /lacks ETH/i);
  const bounded = await boundedManagedVaultGas(enough, transaction, "3000000000000");
  assert.deepEqual(bounded, { gas: 130_000n, maxFeePerGas: 20_000_000n,
    maxPriorityFeePerGas: 1_000_000n });
});
