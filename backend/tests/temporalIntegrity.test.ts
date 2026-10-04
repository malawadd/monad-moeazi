import assert from "node:assert/strict";
import test from "node:test";
import { intervalDefinitelyValid, nonceBinding } from "../execution-sidecar/src/temporalIntegrity";
import { isExactInstrument } from "../execution-sidecar/src/instrumentLifecycle";

test("temporal interval is half-open and requires complete containment", () => {
  assert.equal(intervalDefinitelyValid({ earliestUs: 2n, latestUs: 4n, validFromUs: 1n, validUntilUs: 5n }), true);
  assert.equal(intervalDefinitelyValid({ earliestUs: 2n, latestUs: 5n, validFromUs: 1n, validUntilUs: 5n }), false);
});
test("nonce binding has no clock fallback", () => {
  assert.equal(JSON.parse(nonceBinding("fixture-evm", "a".repeat(16), "account:fixture", "c".repeat(64), 7n, "b".repeat(64)))[4], "7");
  assert.throws(() => nonceBinding("fixture-evm", "a".repeat(16), "account:fixture", "c".repeat(64), 7n, "d".repeat(63)));
});

test("instrument identity requires chain, kind, and metadata revision", () => {
  assert.equal(isExactInstrument({ venue: "uniswap", environment: "arbitrum-mainnet", chainId: 42161,
    namespace: "uni_v4", kind: "amm_pool", nativeId: "0x1111111111111111111111111111111111111111",
    universeRevision: "u-1", metadataRevision: "m-1" }), true);
  assert.equal(isExactInstrument({ venue: "uniswap", environment: "arbitrum-mainnet", chainId: 1,
    namespace: "uni_v4", kind: "amm_pool", nativeId: "0x1111111111111111111111111111111111111111",
    universeRevision: "u-1", metadataRevision: "m-1" }), false);
});
