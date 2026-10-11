import { test } from "node:test";
import assert from "node:assert/strict";
import { verifiedManualLedgerPnl } from "../convex/monadTradeSummaryLifecycle.ts";

const owner = "0xbb66e7bc26d8a81c36a2f900d141a1fa786a98d8";
const userId = "user-1";
const accountAddress = owner;
const marketId = 16;
const entry = { operationId: "entry-id", userId, ownerAddress: owner, accountAddress, marketId,
  action: "market_entry", status: "finalized", nonce: 36,
  resultJson: JSON.stringify({ verified: true, balanceBeforeUnits: "100000000", balanceUnits: "91697027" }) };
const close = { operationId: "close-id", userId, ownerAddress: owner, accountAddress, marketId,
  action: "close_position", status: "submitted", nonce: 37 };
const prior = { summaryId: `manual:${owner}:16:long:entry-id` };
const details = { balanceUnits: "99989406" };

function context(operations: any[]) {
  return { db: { query: (table: string) => {
    assert.equal(table, "monadManualOperations");
    return { withIndex: (index: string, callback: (q: any) => any) => {
      let operationId: string | undefined;
      let lower = 0; let upper = 0;
      const q = { eq: (field: string, value: any) => {
        if (field === "operationId") operationId = value;
        return { gte: (_field: string, value: number) => {
          lower = value; return { lte: (_next: string, value2: number) => { upper = value2; } };
        } };
      } };
      callback(q);
      if (index === "by_operationId") return { first: async () => operations.find(item => item.operationId === operationId) };
      return { collect: async () => operations.filter(item => item.nonce >= lower && item.nonce <= upper)
        .sort((a, b) => a.nonce - b.nonce) };
    } };
  } } };
}

test("manual cycle net PnL uses finalized opening balance and flat closing balance", async () => {
  assert.equal(await verifiedManualLedgerPnl(context([entry, close]), close, prior, details), "-10594");
});

test("manual cycle net PnL stays unknown if another account action intervened", async () => {
  const laterClose = { ...close, nonce: 38 };
  const withdrawal = { ...close, operationId: "withdraw-id", nonce: 37, action: "withdraw_collateral", status: "finalized" };
  assert.equal(await verifiedManualLedgerPnl(context([entry, withdrawal, laterClose]), laterClose, prior, details), null);
});

test("manual cycle net PnL stays unknown without finalized entry evidence", async () => {
  assert.equal(await verifiedManualLedgerPnl(context([{ ...entry, status: "uncertain" }, close]), close, prior, details), null);
});
