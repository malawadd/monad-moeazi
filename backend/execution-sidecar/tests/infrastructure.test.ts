import {test} from "node:test";
import assert from "node:assert/strict";
import {PimlicoBundler, PimlicoPaymaster, PimlicoTransport} from "../src/mobile/providers/pimlico.js";
import {CHAIN, ENTRY_POINT, type BundlerAdapter, type PaymasterAdapter, type UserOperation} from "../src/mobile/contracts.js";
import {networkFeeCeiling} from "../src/mobile/gas.js";
const hash = `0x${"a".repeat(64)}` as const, owner = "0x1111111111111111111111111111111111111111";
const operation: UserOperation = {sender: owner, nonce: "0x0", callData: "0x1234", callGasLimit: "0x64", verificationGasLimit: "0x64", preVerificationGas: "0x64", maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1"};
const calls: string[] = [];
const transport = new PimlicoTransport("synthetic", async (_url, init) => {
  const body = JSON.parse(String(init?.body)); calls.push(body.method);
  if (body.method === "eth_estimateUserOperationGas") return {result: {callGasLimit: "0x64", verificationGasLimit: "0x64", preVerificationGas: "0x64"}};
  if (body.method === "eth_sendUserOperation") return {result: hash};
  if (body.method === "eth_getUserOperationReceipt") return {result: {receipt: {transactionHash: hash}}};
  if (body.method === "pm_sponsorUserOperation") return {result: {paymaster: owner, paymasterData: "0x1234", paymasterVerificationGasLimit: "0x64", paymasterPostOpGasLimit: "0x64"}};
  throw new Error("Unexpected fixture RPC");
}, "synthetic-policy");
const cap = {chainId: CHAIN, entryPoint: ENTRY_POINT, accountId: "kernel-033", eip7702: true};
function fakeBundler(id: string): BundlerAdapter {return {pin: {id, version: "1"}, capabilities: () => cap, estimate: async () => ({callGasLimit: "0x64", verificationGasLimit: "0x64", preVerificationGas: "0x64"}), submit: async () => hash, locate: async () => ({transactionHash: hash})};}
function fakePaymaster(id: string): PaymasterAdapter {return {pin: {id, version: "1"}, capabilities: () => cap, settlementCostWei: value => value,
  sponsor: async op => ({operation: {...op, paymaster: owner, paymasterData: "0x1234"}, expiresAt: Date.now()+60000, feeCeilingWei: networkFeeCeiling(op).toString()})};}
for (const adapter of [new PimlicoBundler(transport), fakeBundler("fake-alpha"), fakeBundler("fake-beta")]) {
  test(`${adapter.pin.id}: bundler contract conformance`, async () => {
    assert.deepEqual(adapter.capabilities(), cap);
    assert.ok((await adapter.estimate(operation)).callGasLimit);
    assert.equal(await adapter.submit(operation, `0x${"1".repeat(130)}`), hash);
    assert.equal((await adapter.locate(hash))?.transactionHash, hash);
  });
}
for (const adapter of [new PimlicoPaymaster(transport), fakePaymaster("fake-alpha"), fakePaymaster("fake-beta")]) {
  test(`${adapter.pin.id}: paymaster contract conformance`, async () => {
    const result = await adapter.sponsor(operation);
    assert.deepEqual(adapter.capabilities(), cap); assert.ok(result.expiresAt > Date.now()); assert.ok(result.operation.paymaster);
    assert.ok(BigInt(result.feeCeilingWei) >= networkFeeCeiling(result.operation));
    assert.ok(BigInt(adapter.settlementCostWei("101")) >= 101n);
    for (const key of ["sender", "nonce", "callData", "maxFeePerGas", "maxPriorityFeePerGas"] as const) assert.equal(result.operation[key], operation[key]);
  });
}
test("provider errors are normalized without secret-bearing responses", async () => {
  const invalid = new PimlicoBundler(new PimlicoTransport("synthetic", async () => ({error: {message: "DO_NOT_LOG_SYNTHETIC_SECRET"}})));
  await assert.rejects(invalid.submit(operation, "0x12"), error => !String(error).includes("DO_NOT_LOG") && String(error).includes("service"));
});
