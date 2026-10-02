import {test} from "node:test";
import assert from "node:assert/strict";
import {createPublicClient, custom, keccak256, stringToHex, encodeEventTopics, encodeAbiParameters, type Hex, type Address} from "viem";
import {arbitrum} from "viem/chains";
import {Kernel033Adapter, operationEvent, transferEvent} from "../src/mobile/kernel.js";
import {ENTRY_POINT, KERNEL, USDC, type PreparedSponsoredOperation} from "../src/mobile/contracts.js";
import {budgetCharge, canTransition} from "../../convex/helpers/mobileConnector.js";

const owner = "0x1111111111111111111111111111111111111111", destination = "0x2222222222222222222222222222222222222222";
const client = createPublicClient({chain: arbitrum, transport: custom({request: async ({method}) => {
  if (method === "eth_getCode") return "0x";
  if (method === "eth_chainId") return "0xa4b1";
  throw new Error("Only recorded fixture RPC is available.");
}}, {retryCount: 0})});
const adapter = new Kernel033Adapter(client);
const hash = `0x${"1".repeat(64)}` as Hex;
const prepared = {owner, implementation: KERNEL, userOperationHash: hash, intent: {kind: "withdrawal", destination, amountRaw: "1000000"}, userOperation: {nonce: "0x0", paymaster: destination}} as unknown as PreparedSponsoredOperation;
const before = {address: ENTRY_POINT, topics: [keccak256(stringToHex("BeforeExecution()"))], data: "0x"};
function transfer(to: Address = destination) {return {address: USDC, topics: encodeEventTopics({abi: transferEvent, eventName: "Transfer", args: {from: owner, to}}), data: encodeAbiParameters([{type: "uint256"}], [1000000n])};}
function event(success = true, userOpHash = hash) {return {address: ENTRY_POINT, topics: encodeEventTopics({abi: operationEvent, eventName: "UserOperationEvent", args: {userOpHash, sender: owner, paymaster: destination}}), data: encodeAbiParameters([{type: "uint256"}, {type: "bool"}, {type: "uint256"}, {type: "uint256"}], [0n, success, 10n, 20n])};}
function receipt(logs: unknown[], status = "success") {return {logs, status, transactionHash: hash};}
test("outer receipt success is not inner operation success", () => {
  assert.equal(adapter.verifyReceipt(prepared, receipt([before, transfer(), event(false)])).state, "failed");
  assert.equal(adapter.verifyReceipt(prepared, receipt([before, transfer(), event()])).state, "completed");
  assert.equal(adapter.verifyReceipt(prepared, receipt([before, transfer(), event()], "reverted")).state, "failed");
});
test("unrelated transfer segments, pre-validation logs and wrong recipients are rejected", () => {
  const other = `0x${"2".repeat(64)}` as Hex;
  assert.equal(adapter.verifyReceipt(prepared, receipt([before, transfer(), event(true, other), event()])).state, "failed");
  assert.equal(adapter.verifyReceipt(prepared, receipt([transfer(), before, event()])).state, "failed");
  assert.equal(adapter.verifyReceipt(prepared, receipt([before, transfer(owner), event()])).state, "failed");
  assert.equal(adapter.verifyReceipt(prepared, receipt([before, transfer(), event(true, other)])).state, "pending");
});
test("Kernel codec has only the requested transfer and cannot sign", async () => {
  const callData = await adapter.build({kind: "withdrawal", owner, destination, amountRaw: "1000000"}, 0n, false);
  assert.ok(callData.includes(USDC.slice(2)));
  assert.ok(callData.includes("a9059cbb"));
  const account = await adapter.account(owner);
  assert.equal(account.address.toLowerCase(), owner);
  assert.equal((await account.getFactoryArgs()).factory, undefined);
  await assert.rejects(account.signMessage({message: "no server signing"}));
});
test("uncertain budget reservations never expire; failed and expired preparations release", () => {
  const row = {status: "uncertain", reservedWei: "100", expiresAt: 1};
  assert.equal(budgetCharge(row, Date.now()), 100n);
  assert.equal(budgetCharge({...row, status: "needs_attention"}, Date.now()), 100n);
  assert.equal(budgetCharge({...row, status: "prepared"}, Date.now()), 0n);
  assert.equal(budgetCharge({...row, status: "failed", actualGasCost: "9"}, Date.now()), 100n);
  assert.equal(budgetCharge({...row, status: "failed", actualGasCost: "9", actualCoverageCostWei: "10"}, Date.now()), 10n);
  assert.equal(canTransition("uncertain", "prepared"), false);
  assert.equal(canTransition("completed", "submitted"), false);
  assert.equal(canTransition("needs_attention", "completed"), true);
});
