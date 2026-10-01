import { defineTable } from "convex/server";
import { v } from "convex/values";

export const financeProjectionValidator = v.object({
  schemaVersion: v.literal(1),
  environment: v.union(v.literal("live"), v.literal("experiment")),
  scopeId: v.string(), strategyAccountId: v.string(),
  accountRevision: v.string(), writerEpoch: v.string(), authorityEpoch: v.string(),
  reconciliationState: v.union(v.literal("unknown"), v.literal("clean"), v.literal("quarantined")),
  reconciliationReason: v.string(),
  observationSnapshotHash: v.union(v.string(), v.null()),
  observedAt: v.union(v.string(), v.null()), asOf: v.string(),
  balances: v.array(v.object({ assetUnitId: v.string(), locationId: v.string(),
    book: v.string(), units: v.string(), registryHash: v.string() })),
  holds: v.array(v.object({ reservationId: v.string(), capacityKey: v.string(),
    assetUnitId: v.string(), locationId: v.string(), units: v.string(), status: v.string() })),
  capacity: v.array(v.object({ capacityKey: v.string(), assetUnitId: v.string(),
    locationId: v.string(), availableUnits: v.string(), heldUnits: v.string() })),
});

export const financeProjectionTables = {
  currentFinanceProjections: defineTable({
    strategyAccountId: v.id("strategyAccounts"),
    environment: v.union(v.literal("live"), v.literal("experiment")),
    scopeId: v.string(), accountRevision: v.string(), writerEpoch: v.string(),
    eventId: v.string(), payloadHash: v.string(),
    projection: financeProjectionValidator, projectedAt: v.number(),
  }).index("by_scope", ["environment", "scopeId", "strategyAccountId"]),
};
