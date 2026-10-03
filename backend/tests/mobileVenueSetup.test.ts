import assert from "node:assert/strict";
import { test } from "node:test";
import { getHyperliquidBindingAttempt } from "../convex/mobileVenueSetup";

const handler = (getHyperliquidBindingAttempt as unknown as {
  _handler: (ctx: unknown, args: { attemptId: string }) => Promise<unknown>;
})._handler;

function context(subject: string, owner: string, attemptState = "verifying") {
  const rows: Record<string, Record<string, unknown>> = {
    "attempt-a": { _id: "attempt-a", venue: "hyperliquid", state: attemptState,
      authorityMode: "approval", strategyAccountId: "strategy-a", accountWalletId: "wallet-a" },
    "strategy-a": { _id: "strategy-a", userId: "user-a" },
    "wallet-a": { _id: "wallet-a", userId: "user-a", strategyAccountId: "strategy-a",
      ownerAddress: "0x1111111111111111111111111111111111111111" },
  };
  const users = [{ _id: "user-a", authSubject: "subject-a" }];
  const integrations = [{ _id: "integration-a", strategyAccountId: "strategy-a", venue: "hyperliquid",
    activeSetupAttemptId: "attempt-a", authorityMode: "approval" }];
  return {
    auth: { getUserIdentity: async () => ({ subject, walletAddress: owner }) },
    db: {
      get: async (id: string) => rows[id] ?? null,
      query: (table: string) => {
        const equals: Array<[string, unknown]> = [];
        const chain = {
          withIndex: (_index: string, fn: (q: unknown) => void) => {
            const q = { eq: (key: string, value: unknown) => { equals.push([key, value]); return q; } };
            fn(q); return chain;
          },
          first: async () => (table === "users" ? users : integrations)
            .find((row) => equals.every(([key, value]) => (row as Record<string, unknown>)[key] === value)) ?? null,
        };
        return chain;
      },
    },
  };
}

test("mobile binding identifies only the current owned verifying setup", async () => {
  const owner = "0x1111111111111111111111111111111111111111";
  assert.deepEqual(await handler(context("subject-a", owner), { attemptId: "attempt-a" }), {
    attemptId: "attempt-a", ownerAddress: owner, authorityMode: "approval",
  });
  assert.equal(await handler(context("subject-b", owner), { attemptId: "attempt-a" }), null);
  assert.equal(await handler(context("subject-a", "0x2222222222222222222222222222222222222222"),
    { attemptId: "attempt-a" }), null);
  assert.equal(await handler(context("subject-a", owner, "ready"), { attemptId: "attempt-a" }), null);
});
