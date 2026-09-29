import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import type { Address, Hex } from "viem";
import { requireDurableRedisWrite } from "./redisDurableWrite.js";

export type SwapScope = "buy" | "exit";
export type GrantState = "awaiting-owner" | "active" | "revoked";
export type OwnerApprovalTypedData = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type SessionGrantRecord = {
  grantId: string;
  scope: SwapScope;
  state: GrantState;
  owner: Address;
  strategyAccountId: string;
  assignmentId: string;
  frozenPolicyHash: Hex;
  policyHash: Hex;
  createdAt: number;
  expiresAt: number;
  maxInputUnits: string;
  minOutputUnits: string;
  privateKey: Hex;
  sessionAddress: Address;
  ownerApproval: OwnerApprovalTypedData;
  ownerApprovalSignature?: Hex;
};

export interface SessionSignerVault {
  /** True only when the backing store is operationally configured for durable encrypted persistence. */
  readonly durable: boolean;
  get(grantId: string, scope: SwapScope): Promise<SessionGrantRecord | null>;
  putIfAbsent(record: SessionGrantRecord): Promise<SessionGrantRecord>;
  put(record: SessionGrantRecord): Promise<void>;
  delete(grantId: string, scope: SwapScope): Promise<void>;
}

/** AES-GCM encrypted sidecar Redis vault. Never use the token-vault key for session signers. */
export class RedisEncryptedSessionSignerVault implements SessionSignerVault {
  readonly durable: boolean;
  private readonly redis: Redis;
  private readonly key: Buffer;

  constructor(url: string, secret: string, private readonly namespace: string, persistenceVerified = false) {
    if (secret.length < 32) throw new Error("Session signer vault secret must be at least 32 characters");
    if (!namespace.trim()) throw new Error("Session signer vault namespace is required");
    this.durable = persistenceVerified;
    this.redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on("error", () => undefined);
    this.key = createHash("sha256").update(secret).digest();
  }

  private async ready() { if (this.redis.status === "wait") await this.redis.connect(); }
  private redisKey(grantId: string, scope: SwapScope) {
    const digest = createHash("sha256").update(`${grantId}:${scope}`).digest("hex");
    return `${this.namespace}:session-signers:${digest}`;
  }
  private seal(record: SessionGrantRecord, key: string) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(key));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString("base64")).join(".");
  }
  private open(raw: string, key: string): SessionGrantRecord {
    const [iv, tag, ciphertext] = raw.split(".");
    if (!iv || !tag || !ciphertext) throw new Error("Invalid encrypted session signer record");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(key));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")), decipher.final(),
    ]).toString()) as SessionGrantRecord;
  }

  async get(grantId: string, scope: SwapScope) {
    await this.ready();
    const key = this.redisKey(grantId, scope), raw = await this.redis.get(key);
    return raw ? this.open(raw, key) : null;
  }

  async putIfAbsent(record: SessionGrantRecord) {
    await this.ready();
    const key = this.redisKey(record.grantId, record.scope);
    const ttl = Math.max(1, record.expiresAt * 1000 - Date.now());
    const created = await this.redis.set(key, this.seal(record, key), "PX", ttl, "NX");
    if (created === "OK") { await requireDurableRedisWrite(this.redis); return record; }
    const existing = await this.get(record.grantId, record.scope);
    if (!existing) throw new Error("Could not read existing session signer record");
    return existing;
  }

  async put(record: SessionGrantRecord) {
    await this.ready();
    const key = this.redisKey(record.grantId, record.scope);
    const ttl = Math.max(1, record.expiresAt * 1000 - Date.now());
    await this.redis.set(key, this.seal(record, key), "PX", ttl);
    await requireDurableRedisWrite(this.redis);
  }

  async delete(grantId: string, scope: SwapScope) {
    await this.ready();
    const removed = await this.redis.del(this.redisKey(grantId, scope));
    if (removed > 0) await requireDurableRedisWrite(this.redis);
  }

  close() { this.redis.disconnect(); }
}
