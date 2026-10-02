import type {QuoteRecord, QuoteStore} from "../src/mobile/quoteStore.js";
export class MemoryQuoteStore implements QuoteStore {
  references = new Map<string, QuoteRecord>(); caches = new Map<string, QuoteRecord>();
  locks = new Map<string, string>(); counts = new Map<string, number>();
  async cached(binding: string) {return this.caches.get(binding) ?? null;}
  async reference(id: string) {return this.references.get(id) ?? null;}
  async put(id: string, record: QuoteRecord, cacheMs: number) {this.references.set(id, record); if (cacheMs > 0) this.caches.set(record.binding, record);}
  async claim(binding: string, rateKey: string) {
    if (this.locks.has(binding) || (this.counts.get(rateKey) ?? 0) >= 12) return null;
    this.counts.set(rateKey, (this.counts.get(rateKey) ?? 0) + 1); this.locks.set(binding, 'lease'); return 'lease';
  }
  async release(binding: string, lease: string) {if (this.locks.get(binding) === lease) this.locks.delete(binding);}
}
