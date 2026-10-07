import assert from "node:assert/strict";
import test from "node:test";
import { retryMissingRevertData } from "../api-server/src/monad/autonomyRpcRead.js";

test("read-only RPC retries only missing-revert-data failures, with a fixed bound", async () => {
  let attempts = 0;
  const result = await retryMissingRevertData(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("missing revert data");
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(attempts, 3);

  attempts = 0;
  await assert.rejects(retryMissingRevertData(async () => {
    attempts += 1;
    throw new Error("execution reverted: invalid signature");
  }), /execution reverted/);
  assert.equal(attempts, 1);

  attempts = 0;
  await assert.rejects(retryMissingRevertData(async () => {
    attempts += 1;
    throw new Error("missing revert data");
  }), /missing revert data/);
  assert.equal(attempts, 3);
});
