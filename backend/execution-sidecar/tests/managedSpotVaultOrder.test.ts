import assert from "node:assert/strict";
import test from "node:test";
import { buildManagedVaultBuyPayload } from "../src/managedSpotVaultOrder.js";

const input = {
  vaultAddress: "0xabcdef1234567890abcdef1234567890abcdef12",
  ownerAddress: "0x1234567890abcdef1234567890abcdef12345678",
  executorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  programHash: "11".repeat(32), policyHash: "22".repeat(32),
  codeHash: `0x${"33".repeat(32)}`,
  capitalUnits: "1000000", maxBuyUnits: "500000",
  expiresAt: 1_800_001_000_000, orderId: `0x${"44".repeat(32)}`,
  amountIn: "250000", amountOutMinimum: "100000000000000",
  deadline: 1_800_000_120,
};
const observed = { funded: true, stopped: false, vaultUsdcUnits: "700000",
  executionBlockTimestamp: "1800000000", codeHash: input.codeHash,
  executorAddress: input.executorAddress };

test("managed vault buy binds exact funded account and calldata", () => {
  const prepared = buildManagedVaultBuyPayload(input, observed);
  assert.equal(prepared.schemaVersion, "managed-vault-buy-v1");
  assert.equal(prepared.vaultAddress, input.vaultAddress);
  assert.match(prepared.calldata, /^0x/);
  assert.match(prepared.normalizedPayloadHash, /^[a-f0-9]{64}$/);
  assert.notEqual(buildManagedVaultBuyPayload({ ...input, amountIn: "250001" }, observed)
    .normalizedPayloadHash, prepared.normalizedPayloadHash);
});

test("managed vault cannot spend owner funds or exceed mandate", () => {
  for (const mutation of [
    { input: { ...input, amountIn: "700001" }, observed },
    { input, observed: { ...observed, vaultUsdcUnits: "100000" } },
    { input, observed: { ...observed, stopped: true } },
    { input, observed: { ...observed, funded: false } },
    { input, observed: { ...observed, executorAddress: input.ownerAddress } },
    { input: { ...input, deadline: 1_800_000_301 }, observed },
  ]) {
    assert.throws(() => buildManagedVaultBuyPayload(mutation.input, mutation.observed));
  }
});
