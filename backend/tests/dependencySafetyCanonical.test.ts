import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { canonicalRequestValue, safetyRequestHash } from "../convex/helpers/dependencySafetyVerification";

type Vector = {
  name: string;
  operation: string;
  request: unknown;
  bindings: Record<string, string>;
  expectedHash: string;
};

const vectors = JSON.parse(readFileSync(
  "tests/fixtures/dependencySafetyRequestHashes.json", "utf8",
)) as Vector[];

for (const vector of vectors) {
  test(`request hash golden vector: ${vector.name}`, async () => {
    assert.equal(await safetyRequestHash(vector.operation, vector.request, vector.bindings),
      vector.expectedHash);
  });
}

test("canonical request numbers are tagged, finite, exponent-free, and preserve large safe integers", () => {
  assert.deepEqual(canonicalRequestValue([-0, 1e-7, 1e21, 9007199254740991]), ["array", [
    ["number", "0"], ["number", "0.0000001"],
    ["number", "1000000000000000000000"], ["number", "9007199254740991"],
  ]]);
  assert.throws(() => canonicalRequestValue(Number.POSITIVE_INFINITY), /finite/);
});
