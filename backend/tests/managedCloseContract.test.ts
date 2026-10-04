import assert from "node:assert/strict";
import test from "node:test";
import { parseManagedCloseReply } from "../lib/managedCloseContract";

const hash = `0x${"a".repeat(64)}`;
const flat = { status: "confirmed_flat", code: "FINALIZED_EXIT_RECONCILED", message: "Finalized WETH exit and financial account reconciled.",
  operationId: "attempt-1", admissionStopped: true, submittedOperationMayStillSettle: false,
  unsettledOperationCount: 0, positionClosure: "confirmed_flat", exitGrant: { verified: true, expiresAt: 1_900_000_000 },
  position: { wethUnits: "0", blockNumber: "123", blockHash: hash },
  closure: { confirmed: true, zeroExposure: true, allOperationsSettled: true,
    finalizedBlock: "123", finalizedBlockHash: hash, receiptId: "receipt-1" } };

test("accepts flat proof only when finalized position, settlement, and projection proof agree", () => {
  const result = parseManagedCloseReply(200, flat);
  assert.equal(result?.status, "confirmed_flat");
  assert.equal(result?.closure?.receiptId, "receipt-1");
  assert.equal(parseManagedCloseReply(200, { ...flat, position: { ...flat.position, wethUnits: "1" } }), null);
  assert.equal(parseManagedCloseReply(200, { ...flat, unsettledOperationCount: 1 }), null);
  assert.equal(parseManagedCloseReply(200, { ...flat, closure: { ...flat.closure, finalizedBlockHash: `0x${"b".repeat(64)}` } }), null);
  assert.equal(parseManagedCloseReply(200, { ...flat, positionClosure: "unconfirmed" }), null);
});

test("accepts a finalized no-trade flat proof without claiming an exit trade", () => {
  const noTrade = { ...flat, code: "FINALIZED_NO_TRADE_FLAT",
    operationId: null, exitGrant: { verified: false, expiresAt: null } };
  const result = parseManagedCloseReply(200, noTrade);
  assert.equal(result?.status, "confirmed_flat");
  assert.deepEqual(result?.exitGrant, { verified: false, expiresAt: null });
  assert.equal(result?.operationId, undefined);
  assert.equal(parseManagedCloseReply(200, { ...noTrade, operationId: "attempt-1" }), null);
  assert.equal(parseManagedCloseReply(200, { ...noTrade, exitGrant: flat.exitGrant }), null);
});

test("preserves pending and normalizes backend blockers without claiming closure", () => {
  const pending = parseManagedCloseReply(202, { status: "pending", code: "EXIT_UNCERTAIN", message: "Awaiting settlement",
    operationId: "attempt-1", admissionStopped: true, submittedOperationMayStillSettle: true,
    positionClosure: "unconfirmed" });
  assert.equal(pending?.status, "pending");
  assert.equal(pending?.positionClosure, "unconfirmed");
  assert.equal(parseManagedCloseReply(202, { ...flat, status: "confirmed_flat" }), null);
  const blocked = parseManagedCloseReply(409, { detail: { status: "blocked", code: "EXIT_GRANT_EXPIRED",
    message: "exit grant expired", positionClosure: "unconfirmed" } });
  assert.equal(blocked?.status, "blocked");
  assert.equal(blocked?.code, "EXIT_GRANT_EXPIRED");
  assert.equal(blocked?.positionClosure, "unconfirmed");
});
