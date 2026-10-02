import {createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID} from "node:crypto";
import {Redis} from "ioredis";
import {ConnectorError} from "../contracts.js";
export type CachedToken = {value: string; expiresAt: number};
export interface TokenVault {read(): Promise<CachedToken[]>; refresh(create: () => Promise<CachedToken>): Promise<CachedToken>}

export class RedisTokenVault implements TokenVault {
  private redis: Redis;
  private key: Buffer;
  constructor(url: string, secret: string, private namespace: string) {
    this.redis = new Redis(url, {lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false});
    this.redis.on("error", () => undefined); // Never log connection URLs or credential-bearing errors.
    this.key = createHash("sha256").update(secret).digest();
  }
  private async ready() {if (this.redis.status === "wait") await this.redis.connect();}
  async read() {
    await this.ready();
    const raw = await this.redis.get(`${this.namespace}:tokens`);
    if (!raw) return [];
    const [iv, tag, encrypted] = raw.split(".");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const tokens = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString()) as CachedToken[];
    return tokens.filter(token => token.expiresAt > Date.now());
  }
  async refresh(create: () => Promise<CachedToken>) {
    await this.ready();
    const lease = randomUUID(), lock = `${this.namespace}:refresh-lock`;
    if (!await this.redis.set(lock, lease, "EX", 30, "NX")) throw new ConnectorError("RATE_LIMITED", "Payment service is refreshing. Try again shortly.");
    try {
      const tokens = await this.read();
      if (tokens[0] && tokens[0].expiresAt > Date.now() + 30_000) return tokens[0];
      const token = await create(), iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      const sealed = Buffer.concat([cipher.update(JSON.stringify([token, ...tokens].slice(0, 3))), cipher.final()]);
      await this.redis.set(`${this.namespace}:tokens`, [iv, cipher.getAuthTag(), sealed].map(part => part.toString("base64")).join("."), "PX", Math.max(1, token.expiresAt - Date.now()));
      return token;
    } finally {await this.redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, lock, lease);}
  }
}
