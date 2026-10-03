import assert from "node:assert/strict";
import { test } from "node:test";
import { localMonadServiceUrl } from "../api-server/src/operator/local-service.js";

test("operator credentials are pinned to exact Monad loopback ports", () => {
  assert.equal(localMonadServiceUrl("http://127.0.0.1:3310", 3310, "Convex"), "http://127.0.0.1:3310");
  assert.equal(localMonadServiceUrl("http://localhost:9100", 9100, "Agent API"), "http://localhost:9100");
  for (const value of ["http://127.0.0.1:7233", "http://192.168.1.4:9100", "https://127.0.0.1:9100",
    "http://user:secret@127.0.0.1:9100", "http://127.0.0.1:9100/path", "http://127.0.0.1:9100/?q=1"]) {
    assert.throws(() => localMonadServiceUrl(value, 9100, "Agent API"));
  }
  assert.throws(() => localMonadServiceUrl("http://127.0.0.1:3311", 3310, "Convex"));
  assert.throws(() => localMonadServiceUrl("http://127.0.0.1:9111", 9110, "Test Center"));
});
