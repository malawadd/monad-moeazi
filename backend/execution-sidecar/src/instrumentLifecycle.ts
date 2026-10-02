/** Pure local fixture identity helper.  server.ts must not import this module. */
export type NativeInstrument = { venue: "hyperliquid" | "gmx" | "uniswap"; environment: "hyperliquid-mainnet" | "arbitrum-mainnet";
  chainId?: number; namespace: string; kind: "spot" | "perpetual" | "future" | "amm_pool";
  nativeId: string; universeRevision: string; metadataRevision: string };
export function isExactInstrument(value: NativeInstrument): boolean {
  const arbitrum = value.environment === "arbitrum-mainnet";
  return (arbitrum === (value.chainId === 42161)) && /^[a-z0-9_-]{2,64}$/.test(value.venue) && /^[a-z0-9_-]{2,64}$/.test(value.namespace)
    && /^[A-Za-z0-9:._-]{1,120}$/.test(value.nativeId) && value.universeRevision.length >= 3
    && value.metadataRevision.length >= 3 && (!arbitrum || value.kind !== "amm_pool" || /^0x[a-f0-9]{40}$/.test(value.nativeId));
}
export function safeLifecycleLane(operation: string, state: string): boolean {
  const lanes: Record<string, string[]> = { active: ["cancel", "reduce", "settle", "reconcile"],
    paused: ["cancel", "reduce", "reconcile"], settled: ["settle", "reconcile"], delisted: ["settle", "reconcile"],
    unknown: ["reconcile"], disputed: ["reconcile"] };
  return (lanes[state] ?? []).includes(operation);
}
