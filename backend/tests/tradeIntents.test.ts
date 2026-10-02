import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCanCancelTradeIntent,
  canCancelTradeIntent,
  normalizeOptionalHours,
} from "../lib/trade/intents";

test("trade intents can be cancelled before order submission starts", () => {
  assert.equal(canCancelTradeIntent("queued"), true);
  assert.equal(canCancelTradeIntent("quoted"), true);
  assert.equal(canCancelTradeIntent("funding_submitted"), true);
  assert.equal(canCancelTradeIntent("order_submitting"), false);
  assert.equal(canCancelTradeIntent("open"), false);
  assert.doesNotThrow(() => assertCanCancelTradeIntent("quoted"));
  assert.throws(() => assertCanCancelTradeIntent("order_submitting"), /quoted/i);
});

test("optional hold time normalizes empty values and rejects negative input", () => {
  assert.equal(normalizeOptionalHours(undefined), null);
  assert.equal(normalizeOptionalHours(null), null);
  assert.equal(normalizeOptionalHours(0), null);
  assert.equal(normalizeOptionalHours(12), 12);
  assert.throws(() => normalizeOptionalHours(-1), /negative/i);
});
