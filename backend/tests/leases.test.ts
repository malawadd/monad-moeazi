import test from "node:test";
import assert from "node:assert/strict";
import { canAcquireLease, isLeaseActive } from "../convex/helpers/leases";

const baseLease = {
  holderId: "worker-a",
  status: "active" as const,
  acquiredAt: 1_000,
  heartbeatAt: 1_000,
  expiresAt: 10_000,
  releasedAt: undefined,
};

test("isLeaseActive returns true only for active, unexpired leases", () => {
  assert.equal(isLeaseActive(baseLease, 5_000), true);
  assert.equal(isLeaseActive(baseLease, 10_001), false);
  assert.equal(isLeaseActive({ ...baseLease, releasedAt: 6_000 }, 5_000), false);
});

test("canAcquireLease blocks a different holder while the lease is still active", () => {
  assert.equal(canAcquireLease(baseLease, 5_000, "worker-b"), false);
});

test("canAcquireLease allows renewal by the current holder", () => {
  assert.equal(canAcquireLease(baseLease, 5_000, "worker-a"), true);
});

test("canAcquireLease allows takeover when the lease has expired or been released", () => {
  assert.equal(canAcquireLease(baseLease, 11_000, "worker-b"), true);
  assert.equal(
    canAcquireLease({ ...baseLease, releasedAt: 6_000 }, 6_001, "worker-b"),
    true,
  );
});
