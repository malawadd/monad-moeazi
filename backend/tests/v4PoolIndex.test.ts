import test from "node:test";
import assert from "node:assert/strict";
import { USDC_ADDRESS, WMON_ADDRESS } from "../api-server/src/monad/constants.js";
import { findV4Pool, isNoHook, isTargetPool, normalizePoolId, poolKeysEqual,
  seedV4Pool, toPoolRecord, v4MarketId, v4PoolId } from "../api-server/src/monad/v4PoolIndex.js";

test("seeded WMON/USDC keeps its legacy link and exact PoolKey", async () => {
  const seed = seedV4Pool();
  assert.equal(v4MarketId(seed.poolId), "WMON_USDC");
  assert.equal(v4PoolId(seed), seed.poolId);
  assert.equal((await findV4Pool(seed.poolId))?.poolId, seed.poolId);
  assert.equal(seed.verified, true);
  assert.equal(isNoHook(seed), true);
  assert.equal(isTargetPool(seed), true);
  assert.equal(poolKeysEqual({ ...seed, fee: seed.fee + 1 }, seed), false);
  assert.equal(poolKeysEqual(seed, seed), true);
});

test("indexed pool IDs and verification labels remain distinct from the seed", () => {
  const otherId = `0x${"1".repeat(64)}`;
  const row = toPoolRecord({ poolId: otherId, currency0: USDC_ADDRESS,
    currency1: WMON_ADDRESS, fee: 500, tickSpacing: 10,
    hooks: "0x0000000000000000000000000000000000000000", initializedBlock: 69_000_000 });
  assert.equal(row.verified, false);
  assert.equal(row.verificationSource, "community_poolmanager_index");
  assert.equal(v4MarketId(otherId), `v4_${otherId}`);
  assert.equal(normalizePoolId(otherId.toUpperCase().replace("0X", "0x")), otherId);
  assert.throws(() => normalizePoolId("0x1234"), /PoolId/);
});
