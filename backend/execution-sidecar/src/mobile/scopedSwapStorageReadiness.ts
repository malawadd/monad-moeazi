import { randomBytes } from "node:crypto";
import { Redis } from "ioredis";

export const SCOPED_SWAP_DURABILITY_ACK = "redis-aof-fsync-always-one-durable-replica-v1";

export type ScopedSwapStorageConfig = {
  redisUrl: string;
  signerSecret: string;
  operationSecret: string;
  workerSecret: string;
  durabilityAck: string;
};
export type ScopedSwapStorageReadiness = {
  status: "checking" | "ready" | "blocked";
  ready: boolean;
  backend: "redis" | "unconfigured";
  encryptionConfigured: boolean;
  durabilityAcknowledged: boolean;
  redisPersistence: "verified" | "unverified" | "unknown";
  roundTripVerified: boolean;
  checkedAt: number | null;
  blockerCodes: string[];
};
export type RedisDurabilityProbe = {
  appendOnly: boolean;
  appendFsyncAlways: boolean;
  lastAofWriteHealthy: boolean;
  localAofFsync: boolean;
  replicaAofFsync: boolean;
  roundTrip: boolean;
};

export function scopedSwapStorageConfig(env: Record<string, string | undefined>): ScopedSwapStorageConfig {
  return { redisUrl: env.REDIS_URL ?? "", signerSecret: env.SCOPED_SWAP_SIGNER_VAULT_SECRET ?? "",
    operationSecret: env.SCOPED_SWAP_OPERATION_STORE_SECRET ?? "", workerSecret: env.WORKER_SHARED_SECRET ?? "",
    durabilityAck: env.SCOPED_SWAP_STORAGE_DURABILITY_ACK ?? "" };
}

function redisConfigValue(reply: unknown, key: string): string | undefined {
  if (Array.isArray(reply)) {
    for (let i = 0; i < reply.length - 1; i += 2) if (String(reply[i]).toLowerCase() === key) return String(reply[i + 1]);
  }
  if (reply && typeof reply === "object" && key in reply) return String((reply as Record<string, unknown>)[key]);
  return undefined;
}
function infoValue(info: string, key: string) {
  const line = info.split(/\r?\n/).find((row) => row.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim();
}
function aofAck(value: unknown) {
  const local = Array.isArray(value) && Number(value[0]) >= 1;
  const replica = Array.isArray(value) && Number(value[1]) >= 1;
  return { local, replica };
}

/** Requires Redis 7.2+ WAITAOF and a durable replica before session grants can be activated. */
export async function probeRedisDurability(redisUrl: string): Promise<RedisDurabilityProbe> {
  const redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1,
    enableOfflineQueue: false, connectTimeout: 3000, commandTimeout: 6000 });
  redis.on("error", () => undefined);
  const key = `moeazi:scoped-uniswap:readiness:${randomBytes(16).toString("hex")}`;
  const marker = randomBytes(24).toString("hex");
  try {
    await redis.connect();
    if (await redis.ping() !== "PONG") throw new Error("redis_ping_failed");
    const appendOnly = redisConfigValue(await redis.config("GET", "appendonly"), "appendonly")?.toLowerCase() === "yes";
    const appendFsyncAlways = redisConfigValue(await redis.config("GET", "appendfsync"), "appendfsync")?.toLowerCase() === "always";
    const persistence = await redis.info("persistence");
    const lastAofWriteHealthy = infoValue(persistence, "aof_last_write_status") === "ok"
      && infoValue(persistence, "aof_enabled") === "1" && infoValue(persistence, "loading") !== "1";
    const created = await redis.set(key, marker, "PX", 10_000, "NX");
    const roundTrip = created === "OK" && await redis.get(key) === marker;
    const ack = aofAck(await redis.call("WAITAOF", "1", "1", "5000"));
    const removed = await redis.del(key);
    if (removed > 0) await redis.call("WAITAOF", "1", "1", "5000");
    return { appendOnly, appendFsyncAlways, lastAofWriteHealthy, localAofFsync: ack.local,
      replicaAofFsync: ack.replica, roundTrip };
  } finally {
    await redis.quit().catch(() => redis.disconnect());
  }
}

export async function assessScopedSwapStorage(
  config: ScopedSwapStorageConfig,
  probe: (redisUrl: string) => Promise<RedisDurabilityProbe> = probeRedisDurability,
  now: () => number = Date.now,
): Promise<ScopedSwapStorageReadiness> {
  const blockers: string[] = [];
  const urlOk = (() => { try { const url = new URL(config.redisUrl); return url.protocol === "redis:" || url.protocol === "rediss:"; } catch { return false; } })();
  const encryptionConfigured = config.signerSecret.length >= 32 && config.operationSecret.length >= 32
    && config.signerSecret !== config.operationSecret && config.signerSecret !== config.workerSecret
    && config.operationSecret !== config.workerSecret;
  const durabilityAcknowledged = config.durabilityAck === SCOPED_SWAP_DURABILITY_ACK;
  if (!urlOk) blockers.push("redis_url_missing_or_invalid");
  if (!encryptionConfigured) blockers.push("independent_encryption_secrets_required");
  if (!durabilityAcknowledged) blockers.push("durable_storage_operator_ack_required");

  let redisPersistence: ScopedSwapStorageReadiness["redisPersistence"] = "unknown";
  let roundTripVerified = false;
  if (urlOk && encryptionConfigured && durabilityAcknowledged) {
    try {
      const result = await probe(config.redisUrl);
      const persistenceOk = result.appendOnly && result.appendFsyncAlways && result.lastAofWriteHealthy
        && result.localAofFsync && result.replicaAofFsync;
      redisPersistence = persistenceOk ? "verified" : "unverified";
      roundTripVerified = result.roundTrip;
      if (!result.appendOnly) blockers.push("redis_aof_disabled");
      if (!result.appendFsyncAlways) blockers.push("redis_appendfsync_must_be_always");
      if (!result.lastAofWriteHealthy) blockers.push("redis_aof_health_not_verified");
      if (!result.localAofFsync) blockers.push("redis_local_aof_fsync_not_acknowledged");
      if (!result.replicaAofFsync) blockers.push("redis_replica_aof_fsync_not_acknowledged");
      if (!result.roundTrip) blockers.push("redis_round_trip_failed");
    } catch {
      redisPersistence = "unverified";
      blockers.push("redis_persistence_probe_failed");
    }
  }
  const ready = blockers.length === 0 && redisPersistence === "verified" && roundTripVerified;
  return { status: ready ? "ready" : "blocked", ready,
    backend: urlOk ? "redis" : "unconfigured", encryptionConfigured, durabilityAcknowledged,
    redisPersistence, roundTripVerified, checkedAt: now(), blockerCodes: [...new Set(blockers)] };
}

export function scopedSwapStorageChecking(): ScopedSwapStorageReadiness {
  return { status: "checking", ready: false, backend: "unconfigured", encryptionConfigured: false,
    durabilityAcknowledged: false, redisPersistence: "unknown", roundTripVerified: false,
    checkedAt: null, blockerCodes: ["startup_probe_pending"] };
}
