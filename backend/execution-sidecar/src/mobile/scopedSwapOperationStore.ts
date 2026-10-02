import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import type { Address, Hex } from "viem";
import type { SwapScope } from "./sessionSignerVault.js";
import { requireDurableRedisWrite } from "./redisDurableWrite.js";

export type ScopedSwapOperationState = "submitting" | "submitted" | "uncertain" | "confirmed" | "failed";
export type ScopedSwapOperation = {
  grantId: string; scope: SwapScope; state: ScopedSwapOperationState; owner: Address;
  strategyAccountId: string; assignmentId: string; intentId: string; idempotencyKey: string;
  payloadHash: string; userOperationHash: Hex; amountIn: string; amountOutMinimum: string;
  deadline: number; createdAt: number; expiresAt: number; attemptId: string; reservationId: string;
  transactionHash?: Hex; confirmedBlockNumber?: string; confirmedBlockHash?: Hex;
  actualInputUnits?: string; actualOutputUnits?: string; errorCode?: string;
};

export interface ScopedSwapOperationStore {
  readonly durable: boolean;
  get(grantId: string, scope: SwapScope): Promise<ScopedSwapOperation | null>;
  claim(record: ScopedSwapOperation): Promise<{ created: boolean; record: ScopedSwapOperation }>;
  transition(grantId: string, scope: SwapScope, expected: ScopedSwapOperationState[], patch: Partial<ScopedSwapOperation>): Promise<ScopedSwapOperation>;
}

/** Encrypted Redis ledger. Configure `persistenceVerified` only after Redis durability is operationally verified. */
export class RedisScopedSwapOperationStore implements ScopedSwapOperationStore {
  readonly durable: boolean;
  private readonly redis: Redis;
  private readonly key: Buffer;

  constructor(url: string, secret: string, private readonly namespace: string, persistenceVerified = false) {
    if (secret.length < 32) throw new Error("Scoped swap operation secret must be at least 32 characters");
    if (!namespace.trim()) throw new Error("Scoped swap operation namespace is required");
    this.durable = persistenceVerified;
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on("error", () => undefined);
    this.key = createHash("sha256").update(secret).digest();
  }

  private async ready() { if (this.redis.status === "wait") await this.redis.connect(); }
  private redisKey(grantId: string, scope: SwapScope) {
    const digest = createHash("sha256").update(`${grantId}:${scope}`).digest("hex");
    return `${this.namespace}:scoped-swap-operations:${digest}`;
  }
  private seal(record: ScopedSwapOperation, key: string) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(key));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString("base64")).join(".");
  }
  private open(raw: string, key: string): ScopedSwapOperation {
    const [iv, tag, ciphertext] = raw.split(".");
    if (!iv || !tag || !ciphertext) throw new Error("Invalid encrypted scoped swap operation");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString()) as ScopedSwapOperation;
  }
  async get(grantId: string, scope: SwapScope) {
    await this.ready();
    const key = this.redisKey(grantId, scope), raw = await this.redis.get(key);
    return raw ? this.open(raw, key) : null;
  }
  async claim(record: ScopedSwapOperation) {
    await this.ready();
    const key = this.redisKey(record.grantId, record.scope);
    const created = await this.redis.set(key, this.seal(record, key), "NX");
    if (created === "OK") { await requireDurableRedisWrite(this.redis); return { created: true, record }; }
    const existing = await this.get(record.grantId, record.scope);
    if (!existing) throw new Error("Could not read the prior scoped swap operation");
    if (existing.idempotencyKey !== record.idempotencyKey || existing.payloadHash !== record.payloadHash
      || existing.userOperationHash !== record.userOperationHash) throw new Error("One-use swap grant is already bound to another operation");
    return { created: false, record: existing };
  }
  async transition(grantId: string, scope: SwapScope, expected: ScopedSwapOperationState[], patch: Partial<ScopedSwapOperation>) {
    await this.ready();
    const key = this.redisKey(grantId, scope);
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.redis.watch(key);
      const raw = await this.redis.get(key);
      if (!raw) { await this.redis.unwatch(); throw new Error("Scoped swap operation is unavailable"); }
      const current = this.open(raw, key);
      if (!expected.includes(current.state)) { await this.redis.unwatch(); return current; }
      const next = { ...current, ...patch };
      const result = await this.redis.multi().set(key, this.seal(next, key)).exec();
      if (result) { await requireDurableRedisWrite(this.redis); return next; }
    }
    throw new Error("Scoped swap operation changed concurrently");
  }
  close() { this.redis.disconnect(); }
}
