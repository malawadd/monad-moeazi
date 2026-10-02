import {test} from "node:test";
import assert from "node:assert/strict";
import {applyEstimate, applySponsorship} from "../src/mobile/sponsorship.js";
import {networkFeeCeiling} from "../src/mobile/gas.js";
import {PimlicoPaymaster, PimlicoTransport} from "../src/mobile/providers/pimlico.js";
import type {UserOperation} from "../src/mobile/contracts.js";

const operation: UserOperation = {
  sender: "0x1111111111111111111111111111111111111111", nonce: "0x0", callData: "0x1234",
  callGasLimit: "0x1", verificationGasLimit: "0x1", preVerificationGas: "0x1", maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1",
};
const gas = {callGasLimit: "0x20", verificationGasLimit: "0x30", preVerificationGas: "0x40"} as const;
const sponsored = {...operation, paymaster: "0x2222222222222222222222222222222222222222", paymasterData: "0x1234",
  paymasterVerificationGasLimit: "0x1", paymasterPostOpGasLimit: "0x1"} as UserOperation;

test("estimates may change only bounded gas quantities, not the reviewed call", () => {
  assert.deepEqual(applyEstimate(operation, gas), {...operation, ...gas});
  for (const patch of [{sender: sponsored.paymaster}, {nonce: "0x1"}, {callData: "0x4321"}, {maxFeePerGas: "0x2"}]) {
    assert.throws(() => applyEstimate(operation, {...gas, ...patch} as Partial<UserOperation>), /changed/);
  }
  assert.throws(() => applyEstimate(operation, {...gas, callGasLimit: "0x"}), /invalid/);
  assert.throws(() => applyEstimate(operation, {...gas, callGasLimit: `0x${"f".repeat(65)}`}), /invalid/);
});

test("sponsorship fails closed for expired quotes, altered calls and malformed data", () => {
  const quote = {operation: sponsored, expiresAt: Date.now() + 60000};
  assert.equal(applySponsorship(operation, quote).paymaster, sponsored.paymaster);
  assert.throws(() => applySponsorship(operation, {...quote, expiresAt: Date.now() - 1}), /expired/);
  assert.throws(() => applySponsorship(operation, {...quote, operation: {...sponsored, callData: "0xabcd"}}), /altered/);
  assert.throws(() => applySponsorship(operation, {...quote, operation: {...sponsored, paymasterData: "0xa"}}), /invalid/);
  assert.throws(() => applySponsorship(operation, {...quote, operation: {...sponsored, paymaster: `0x${"0".repeat(40)}`}}), /invalid/);
});

test("provider pricing rounds upward without leaking into core and strips extra fields", () => {
  assert.equal(networkFeeCeiling(operation), 3n);
  assert.equal(new PimlicoPaymaster(new PimlicoTransport("synthetic")).settlementCostWei("3"), "4");
  const quote = {operation: {...sponsored, factory: operation.sender, signature: "unsafe-extra"}, expiresAt: Date.now() + 60000};
  const normalized = applySponsorship(operation, quote);
  assert.equal("factory" in normalized, false);
  assert.equal("signature" in normalized, false);
});
