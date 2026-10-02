import type { Redis } from "ioredis";

/** Fail the calling operation unless Redis and one replica fsynced its preceding writes. */
export async function requireDurableRedisWrite(redis: Redis) {
  const result: unknown = await redis.call("WAITAOF", "1", "1", "5000");
  if (!Array.isArray(result) || Number(result[0]) < 1 || Number(result[1]) < 1) {
    throw new Error("Scoped swap persistence did not receive local and replica AOF fsync acknowledgements");
  }
}
