import test from "node:test";
import assert from "node:assert/strict";
import { applyCreditGrant, billableForReservation } from "../convex/agentCredits";

function context(initialBalance = 0) {
  const account: any = initialBalance ? {
    _id: "credit-1", userId: "user-1", balance: initialBalance, reserved: 0, version: 1,
  } : null;
  const accounts: any[] = account ? [account] : [];
  const entries: any[] = [];
  const db = {
    query(table: string) {
      return { withIndex(_index: string, predicate: (q: any) => any) {
        const condition = predicate({ eq: (_field: string, value: unknown) => value });
        return { first: async () => table === "creditLedger"
          ? entries.find((entry) => entry.reference === condition) ?? null
          : accounts.find((entry) => entry.userId === condition) ?? null };
      } };
    },
    async insert(table: string, value: any) {
      const id = table === "creditAccounts" ? `credit-${accounts.length + 1}` : `ledger-${entries.length + 1}`;
      (table === "creditAccounts" ? accounts : entries).push({ ...value, _id: id });
      return id;
    },
    async get(id: string) { return accounts.find((entry) => entry._id === id) ?? null; },
    async patch(id: string, value: any) {
      const row = accounts.find((entry) => entry._id === id);
      Object.assign(row, value);
    },
  };
  return { ctx: { db }, accounts, entries };
}

test("operator test grant is recorded once across a retry", async () => {
  const { ctx, accounts, entries } = context(20);
  const args = { userId: "user-1", amount: 1000, reference: "operator-test-credit:one" };
  const first = await applyCreditGrant(ctx as any, args);
  const retry = await applyCreditGrant(ctx as any, args);
  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.equal(accounts[0].balance, 1020);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "grant");
  assert.equal(entries[0].balanceAfter, 1020);
});

test("grant reference cannot be reused for another user or amount", async () => {
  const { ctx, entries } = context();
  const args = { userId: "user-1", amount: 7, reference: "operator-test-credit:two" };
  await applyCreditGrant(ctx as any, args);
  await assert.rejects(() => applyCreditGrant(ctx as any, { ...args, amount: 8 }), /already belongs/);
  await assert.rejects(() => applyCreditGrant(ctx as any, { ...args, userId: "user-2" }), /already belongs/);
  assert.equal(entries.length, 1);
});

test("grant rejects fractional values and balances outside safe integer range", async () => {
  const { ctx } = context(Number.MAX_SAFE_INTEGER - 1);
  const base = { userId: "user-1", reference: "operator-test-credit:three" };
  await assert.rejects(() => applyCreditGrant(ctx as any, { ...base, amount: 1.5 }), /safe integer/);
  await assert.rejects(() => applyCreditGrant(ctx as any, { ...base, amount: 2 }), /too large/);
});

test("a test run keeps its credit charging decision from reservation time", () => {
  assert.equal(billableForReservation({ amount: 25, billingPaused: true }, 18), 0);
  assert.equal(billableForReservation({ amount: 25, billingPaused: false }, 18), 18);
  assert.equal(billableForReservation({ amount: 25 }, 40), 25);
});
