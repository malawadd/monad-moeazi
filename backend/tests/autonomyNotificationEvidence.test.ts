import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { AUTONOMY_VAULT_ABI } from "../api-server/src/monad/autonomyChain";
import { decodeAutonomyReceiptEvidence } from "../api-server/src/monad/autonomyExecutionOrders";

const vault = new Interface(AUTONOMY_VAULT_ABI);
const orderId = `0x${"1".repeat(64)}`;
const otherOrderId = `0x${"2".repeat(64)}`;
const owner = `0x${"a".repeat(40)}`;
const vaultAddress = `0x${"b".repeat(40)}`;

function eventLog(name: string, values: unknown[]) {
  const encoded = vault.encodeEventLog(vault.getEvent(name)!, values as never[]);
  return { address: vaultAddress, topics: encoded.topics, data: encoded.data };
}

test("Spot close notification evidence uses matching sell output and exact CycleCompleted PnL", () => {
  const receipt = { logs: [
    eventLog("SellExecuted", [orderId, 1, 8, 11, 11, 11, 10]),
    eventLog("CycleCompleted", [1, 1, 8, 11, 3, 20]),
    eventLog("Settled", [owner, 2, 20, 0, 1]),
  ] };
  assert.deepEqual(decodeAutonomyReceiptEvidence(receipt, orderId, vaultAddress), {
    amountOutUnits: "11", realizedProfitLossUnits: "3", settlementStatus: 2,
  });
});

test("Spot receipt decoder ignores another order's fill and preserves incomplete settlement evidence", () => {
  const receipt = { logs: [
    eventLog("SellExecuted", [otherOrderId, 1, 8, 11, 11, 11, 10]),
    eventLog("Settled", [owner, 3, 10, 2, 0]),
  ] };
  assert.deepEqual(decodeAutonomyReceiptEvidence(receipt, orderId, vaultAddress), { settlementStatus: 3 });
});

test("Spot receipt decoder rejects matching signatures from another contract", () => {
  const receipt = { logs: [{ ...eventLog("BuyExecuted", [orderId, 0, 10, 12, 12, 12, 11]), address: owner }] };
  assert.deepEqual(decodeAutonomyReceiptEvidence(receipt, orderId, vaultAddress), {});
});
