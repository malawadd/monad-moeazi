export type FinanceBalance = {
  assetUnitId: string; locationId: string; book: string; units: string; registryHash: string;
};
export type FinanceHold = {
  reservationId: string; capacityKey: string; assetUnitId: string; locationId: string;
  units: string; status: string;
};
export type FinanceCapacity = {
  capacityKey: string; assetUnitId: string; locationId: string;
  availableUnits: string; heldUnits: string;
};
export type FinanceProjection = {
  schemaVersion: 1;
  environment: "live" | "experiment";
  scopeId: string;
  strategyAccountId: string;
  accountRevision: string;
  writerEpoch: string;
  authorityEpoch: string;
  reconciliationState: "unknown" | "clean" | "quarantined";
  reconciliationReason: string;
  observationSnapshotHash: string | null;
  observedAt: string | null;
  asOf: string;
  balances: FinanceBalance[];
  holds: FinanceHold[];
  capacity: FinanceCapacity[];
};

const HEX = /^[0-9a-f]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;
const INT = /^(?:0|-?[1-9][0-9]*)$/;
const UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function codePointLess(left: string, right: string): boolean {
  const a = Array.from(left, (char) => char.codePointAt(0)!);
  const b = Array.from(right, (char) => char.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index];
  }
  return a.length < b.length;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)) return value;
  throw new Error("Finance projection contains an unsupported value.");
}

export async function financeProjectionHash(projection: FinanceProjection): Promise<string> {
  const bytes = new TextEncoder().encode(`moeazi-finance-projection-v1\n${JSON.stringify(canonical(projection))}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function financeEventId(projection: FinanceProjection): Promise<string> {
  const identity = `finance:${projection.environment}:${projection.scopeId}:` +
    `${projection.strategyAccountId}:${projection.accountRevision}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function financeAuthorityHash(context: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`moeazi-finance-authority-v1\n${JSON.stringify(canonical(context))}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validFinanceProjection(projection: FinanceProjection): void {
  if (projection.schemaVersion !== 1 || !["live", "experiment"].includes(projection.environment)
      || (projection.environment === "live") !== (projection.scopeId === "live")
      || !projection.strategyAccountId || !projection.scopeId) throw new Error("Finance scope is invalid.");
  for (const value of [projection.accountRevision, projection.writerEpoch, projection.authorityEpoch]) {
    if (!UINT.test(value)) throw new Error("Finance revision must be a canonical integer string.");
  }
  if (!["unknown", "clean", "quarantined"].includes(projection.reconciliationState)
      || projection.reconciliationReason.length > 240
      || (projection.observationSnapshotHash !== null && !HEX.test(projection.observationSnapshotHash))
      || (projection.observedAt !== null && (!UTC_MILLIS.test(projection.observedAt)
        || Number.isNaN(Date.parse(projection.observedAt))))
      || !UTC_MILLIS.test(projection.asOf)
      || Number.isNaN(Date.parse(projection.asOf))) throw new Error("Finance status metadata is invalid.");
  for (const balance of projection.balances) {
    if (!balance.assetUnitId || !balance.locationId || !balance.book || !HEX.test(balance.registryHash)
        || !INT.test(balance.units)) throw new Error("Finance balance is invalid.");
  }
  for (const hold of projection.holds) {
    if (!hold.reservationId || !hold.capacityKey || !hold.assetUnitId || !hold.locationId
        || !UINT.test(hold.units) || !hold.status) throw new Error("Finance hold is invalid.");
  }
  for (const bucket of projection.capacity) {
    if (!bucket.capacityKey || !bucket.assetUnitId || !bucket.locationId
        || !INT.test(bucket.availableUnits) || !UINT.test(bucket.heldUnits)) {
      throw new Error("Finance capacity is invalid.");
    }
  }
  if (projection.reconciliationState === "clean"
      && projection.capacity.some((bucket) => bucket.availableUnits.startsWith("-"))) {
    throw new Error("A capacity deficit cannot be projected as clean.");
  }
  const sorted = <T>(rows: T[], key: (row: T) => string) => rows.every((row, index) =>
    index === 0 || codePointLess(key(rows[index - 1]), key(row)));
  if (!sorted(projection.balances, (row) => `${row.assetUnitId}\0${row.locationId}\0${row.book}`)
      || !sorted(projection.holds, (row) => `${row.reservationId}\0${row.capacityKey}\0${row.assetUnitId}\0${row.locationId}`)
      || !sorted(projection.capacity, (row) => `${row.capacityKey}\0${row.assetUnitId}\0${row.locationId}`)) {
    throw new Error("Finance arrays must have deterministic unique order.");
  }
}
