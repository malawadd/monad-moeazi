import {Redis} from "ioredis";
import {randomUUID} from "node:crypto";
import type {AdapterQuote, QuoteResult} from "./quoteContracts.js";
import type {ProviderPin} from "./contracts.js";

export type QuoteRecord = {binding: string; subjectHash: string; provider: ProviderPin; environment: "sandbox" | "production"; quote: AdapterQuote; result: QuoteResult};
export interface QuoteStore {
  cached(binding: string): Promise<QuoteRecord | null>;
  reference(id: string): Promise<QuoteRecord | null>;
  put(id: string, record: QuoteRecord, cacheMs: number): Promise<void>;
  claim(binding: string, rateKey: string): Promise<string | null>;
  release(binding: string, lease: string): Promise<void>;
}
export class RedisQuoteStore implements QuoteStore {
  private redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url, {lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false});
    this.redis.on("error", () => undefined);
  }
  private key(kind: string, id: string) {return `moeazi:funding-quotes:v1:${kind}:${id}`;}
  private async ready() {if (this.redis.status === "wait") await this.redis.connect();}
  private async read(kind: string, id: string) {await this.ready(); const data = await this.redis.get(this.key(kind, id)); return data ? JSON.parse(data) as QuoteRecord : null;}
  cached(binding: string) {return this.read("cache", binding);}
  reference(id: string) {return this.read("reference", id);}
  async put(id: string, record: QuoteRecord, cacheMs: number) {
    await this.ready(); const ttl = record.quote.estimate.expiresAt - Date.now();
    if (ttl <= 0) return;
    const data = JSON.stringify(record);
    await this.redis.set(this.key("reference", id), data, "PX", ttl);
    if (cacheMs > 0) await this.redis.set(this.key("cache", record.binding), data, "PX", Math.min(cacheMs, ttl, 30_000));
  }
  async claim(binding: string, rateKey: string) {
    await this.ready(); const lease = randomUUID();
    const result = await this.redis.eval(`
      if redis.call('exists',KEYS[1]) == 1 then return 0 end
      local n=tonumber(redis.call('get',KEYS[2]) or '0')
      if n >= 12 then return 0 end
      redis.call('incr',KEYS[2]); if n == 0 then redis.call('pexpire',KEYS[2],60000) end
      redis.call('set',KEYS[1],ARGV[1],'PX',15000); return 1`, 2, this.key("lock", binding), this.key("rate", rateKey), lease);
    return result === 1 ? lease : null;
  }
  async release(binding: string, lease: string) {
    await this.ready(); await this.redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", 1, this.key("lock", binding), lease);
  }
}
