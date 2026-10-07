import { assertVenueAdapterContract, type AnyVenueAdapter } from "./venueAdapterContract.js";

const adapters = new Map<string, AnyVenueAdapter>();

export function registerVenueAdapter(adapter: AnyVenueAdapter) {
  assertVenueAdapterContract(adapter);
  const key = adapter.venueId;
  if (adapters.has(key)) throw new Error("Venue adapter id must be unique and normalized.");
  adapters.set(key, adapter);
  return adapter;
}

export function getVenueAdapter(venueId: string): AnyVenueAdapter {
  const adapter = adapters.get(String(venueId).trim().toLowerCase());
  if (!adapter) throw new Error("Unsupported perpetual venue.");
  return adapter;
}

export function listVenueAdapters(): AnyVenueAdapter[] { return [...adapters.values()]; }
export function hasVenueAdapter(venueId: string) { return adapters.has(venueId.trim().toLowerCase()); }

export function replaceVenueAdaptersForTests(next: AnyVenueAdapter[]) {
  adapters.clear();
  for (const item of next) registerVenueAdapter(item);
}

export function venueAdapterSummary(adapter: AnyVenueAdapter) {
  return { venueId: adapter.venueId, displayName: adapter.displayName, chainId: adapter.chainId,
    executionModel: adapter.executionModel, testOnly: adapter.testOnly, capabilities: adapter.capabilities };
}
