const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const UNITS = /^(?:0|[1-9][0-9]*)$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export type ScopedAllowanceScope = "buy" | "exit";
export type ScopedAllowanceReadiness = {
  balanceReady: boolean;
  allowanceReady: boolean;
  spendReady: boolean;
  activationReady: boolean;
};

/** Binds the finalized sidecar read and separates setup authority from later spend readiness. */
export function scopedAllowanceReadiness(value: unknown, expected: {
  grantId: string; owner: string; scope: ScopedAllowanceScope; requiredUnits: string;
}): ScopedAllowanceReadiness | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !UNITS.test(expected.requiredUnits)) return null;
  const row = value as Record<string, unknown>;
  const token = expected.scope === "buy" ? USDC : WETH;
  const balance = row.balanceUnits, allowance = row.allowanceUnits;
  if (row.grantId !== expected.grantId || row.scope !== expected.scope
      || typeof row.owner !== "string" || row.owner.toLowerCase() !== expected.owner.toLowerCase()
      || typeof row.token !== "string" || row.token.toLowerCase() !== token
      || row.requiredUnits !== expected.requiredUnits || typeof row.blockNumber !== "string"
      || !UNITS.test(row.blockNumber) || typeof row.blockHash !== "string" || !HASH.test(row.blockHash)
      || typeof balance !== "string" || !UNITS.test(balance)
      || typeof allowance !== "string" || !UNITS.test(allowance)
      || typeof row.ready !== "boolean" || typeof row.balanceReady !== "boolean"
      || typeof row.allowanceReady !== "boolean") return null;

  const balanceReady = BigInt(balance) >= BigInt(expected.requiredUnits);
  const allowanceReady = BigInt(allowance) >= BigInt(expected.requiredUnits);
  const spendReady = balanceReady && allowanceReady;
  if (row.balanceReady !== balanceReady || row.allowanceReady !== allowanceReady || row.ready !== spendReady) return null;
  return {balanceReady, allowanceReady, spendReady,
    activationReady: expected.scope === "buy" ? spendReady : allowanceReady};
}
