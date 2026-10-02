import assert from "node:assert/strict";
import test from "node:test";
import { assessScopedSwapStorage, SCOPED_SWAP_DURABILITY_ACK, type RedisDurabilityProbe } from "../src/mobile/scopedSwapStorageReadiness.js";
import { requireDurableRedisWrite } from "../src/mobile/redisDurableWrite.js";

const config = { redisUrl: "rediss://redis.example.test:6380", signerSecret: "s".repeat(48),
  operationSecret: "o".repeat(48), workerSecret: "w".repeat(48), durabilityAck: SCOPED_SWAP_DURABILITY_ACK };
const verifiedProbe: RedisDurabilityProbe = { appendOnly: true, appendFsyncAlways: true,
  lastAofWriteHealthy: true, localAofFsync: true, replicaAofFsync: true, roundTrip: true };

test("scoped swap storage is ready only with independent keys, operator ack and Redis fsync quorum", async () => {
  let probeCalls = 0;
  const result = await assessScopedSwapStorage(config, async () => { probeCalls++; return verifiedProbe; }, () => 1234);
  assert.equal(probeCalls, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.ready, true);
  assert.equal(result.redisPersistence, "verified");
  assert.equal(result.checkedAt, 1234);
  assert.deepEqual(result.blockerCodes, []);
});

test("legacy persistence booleans cannot replace the explicit durable storage acknowledgement", async () => {
  let probeCalls = 0;
  const result = await assessScopedSwapStorage({ ...config, durabilityAck: "" }, async () => {
    probeCalls++; return verifiedProbe;
  });
  assert.equal(probeCalls, 0);
  assert.equal(result.ready, false);
  assert.ok(result.blockerCodes.includes("durable_storage_operator_ack_required"));
});

test("shared encryption secrets and worker bearer cannot qualify for session-key custody", async () => {
  const result = await assessScopedSwapStorage({ ...config, operationSecret: config.signerSecret });
  assert.equal(result.ready, false);
  assert.equal(result.encryptionConfigured, false);
  assert.ok(result.blockerCodes.includes("independent_encryption_secrets_required"));
});

test("missing Redis AOF, fsync, replica acknowledgement or round trip keeps readiness blocked", async () => {
  for (const [field, code] of [
    ["appendOnly", "redis_aof_disabled"], ["appendFsyncAlways", "redis_appendfsync_must_be_always"],
    ["localAofFsync", "redis_local_aof_fsync_not_acknowledged"],
    ["replicaAofFsync", "redis_replica_aof_fsync_not_acknowledged"], ["roundTrip", "redis_round_trip_failed"],
  ] as const) {
    const result = await assessScopedSwapStorage(config, async () => ({ ...verifiedProbe, [field]: false }));
    assert.equal(result.ready, false, field);
    assert.ok(result.blockerCodes.includes(code), field);
  }
});

test("grant and operation writes require WAITAOF local and replica confirmations", async () => {
  await requireDurableRedisWrite({ call: async () => [1, 1] } as any);
  await assert.rejects(requireDurableRedisWrite({ call: async () => [1, 0] } as any), /local and replica/);
});
