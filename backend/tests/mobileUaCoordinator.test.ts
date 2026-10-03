import test from "node:test";
import assert from "node:assert/strict";
import { universalAccountAdapter, UaCoordinatorError } from "../lib/mobileUaCoordinator";

test("mobile UA coordinator rejects unstable idempotency keys", async () => {
  await assert.rejects(
    universalAccountAdapter.prepare({ owner: `0x${"1".repeat(40)}`, idempotencyKey: "short", intent: { kind: "trade" } }),
    (error: unknown) => error instanceof UaCoordinatorError && error.code === "INVALID_IDEMPOTENCY_KEY",
  );
});

test("mobile UA coordinator keeps uncertified submission disabled", async () => {
  await assert.rejects(
    universalAccountAdapter.prepare({ owner: `0x${"1".repeat(40)}`, idempotencyKey: "mobile:1234567890abcdef", intent: { kind: "trade" } }),
    (error: unknown) => error instanceof UaCoordinatorError && error.code === "MOBILE_UA_NOT_CERTIFIED",
  );
});
