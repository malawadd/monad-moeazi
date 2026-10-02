import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";
import { magicVaultReleaseTransaction } from "../lib/managedVaultRelease";

const magic = "0x56B6c8eF6E04Fa995F835f56C009f01623Af5963";
const vault = "0x000000000000000000000000000000000000fa02";

test("vault return is exactly the Magic owner's no-value withdrawUsdc call", () => {
  const tx = magicVaultReleaseTransaction(magic, vault);
  assert.equal(tx.from, magic.toLowerCase());
  assert.equal(tx.to, vault);
  assert.equal(tx.value, "0x0");
  assert.equal(decodeFunctionData({ abi: [{ type: "function", name: "withdrawUsdc",
    inputs: [], outputs: [{ type: "uint256" }] }], data: tx.data }).functionName,
    "withdrawUsdc");
  assert.throws(() => magicVaultReleaseTransaction(magic, magic));
  assert.throws(() => magicVaultReleaseTransaction("0xwrong", vault));
});
