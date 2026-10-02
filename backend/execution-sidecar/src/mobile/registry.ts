import { ConnectorError, type ProviderPin } from "./contracts.js";

export type Registration<T> = ProviderPin & { name?: string; validate(): string | null; create(): T };
export class AdapterRegistry<T> {
  private entries = new Map<string, Registration<T>>();
  register(entry: Registration<T>) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(entry.id) || !entry.version || this.entries.has(`${entry.id}@${entry.version}`)) {
      throw new Error("Invalid or duplicate adapter registration.");
    }
    this.entries.set(`${entry.id}@${entry.version}`, entry);
    return this;
  }
  reason(pin: ProviderPin) { return this.entry(pin).validate(); }
  list() { return [...this.entries.values()].map(({id, version, name}) => ({id, version, name: name ?? id})); }
  resolve(pin: ProviderPin): T {
    const entry = this.entry(pin);
    const reason = entry.validate();
    if (reason) throw new ConnectorError("UNAVAILABLE", reason);
    return entry.create();
  }
  private entry(pin: ProviderPin) {
    const entry = this.entries.get(`${pin.id}@${pin.version}`);
    if (!entry) throw new ConnectorError("UNSUPPORTED", "This integration version is not installed.");
    return entry;
  }
}
