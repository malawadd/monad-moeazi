import assert from "node:assert/strict";
import test from "node:test";
import { erc20TransferData, isTransactionHash, usdcFromRaw, usdcToRaw } from "../convex/helpers/mobileWithdrawal";

test("round-trips canonical six-decimal USDC", () => {
  assert.equal(usdcToRaw("12.345678"), 12_345_678n);
  assert.equal(usdcFromRaw(12_345_678n), "12.345678");
  assert.equal(usdcFromRaw(usdcToRaw("5")), "5");
});

test("rejects unsafe withdrawal amounts", () => {
  for (const value of ["0", "-1", "1.0000001", "1e2", ".5", "01"]) {
    assert.throws(() => usdcToRaw(value));
  }
});

test("builds an exact ERC-20 transfer call", () => {
  const destination = `0x${"2".repeat(40)}`;
  const data = erc20TransferData(destination, 1_500_000n);
  assert.equal(data.length, 138);
  assert.equal(data.startsWith("0xa9059cbb"), true);
  assert.equal(data.slice(10, 74), destination.slice(2).padStart(64, "0"));
  assert.equal(BigInt(`0x${data.slice(74)}`), 1_500_000n);
});

test("recognizes only 32-byte transaction hashes", () => {
  assert.equal(isTransactionHash(`0x${"a".repeat(64)}`), true);
  assert.equal(isTransactionHash(`0x${"a".repeat(63)}`), false);
});
