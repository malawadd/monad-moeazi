import { defineTable } from "convex/server";
import { v } from "convex/values";

export const mobileNotificationTables = {
  mobileNotificationDevices: defineTable({
    userId: v.id("users"), deviceId: v.string(), provider: v.string(),
    platform: v.literal("android"), pushToken: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_userId_deviceId", ["userId", "deviceId"])
    .index("by_userId_provider_deviceId", ["userId", "provider", "deviceId"])
    .index("by_userId_provider", ["userId", "provider"])
    .index("by_status", ["status"]),

  mobileNotificationPreferences: defineTable({
    userId: v.id("users"), enabled: v.boolean(), autonomousEntries: v.boolean(),
    autonomousCloses: v.boolean(), settlementProblems: v.boolean(), manualFills: v.boolean(),
    showAmounts: v.boolean(), updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  mobileNotificationOutbox: defineTable({
    userId: v.id("users"), ownerAddress: v.string(), eventId: v.string(),
    eventKind: v.union(v.literal("autonomous_entry"), v.literal("autonomous_close"),
      v.literal("settlement_problem"), v.literal("manual_fill")),
    title: v.string(), summary: v.string(), redactedSummary: v.string(),
    activityId: v.optional(v.string()), finalityRef: v.string(), finalizedAt: v.number(),
    deliveredDeviceKeys: v.array(v.string()),
    status: v.union(v.literal("pending"), v.literal("claimed"), v.literal("delivered"),
      v.literal("suppressed"), v.literal("failed")),
    attempts: v.number(), nextAttemptAt: v.number(), leaseToken: v.optional(v.string()),
    leaseUntil: v.optional(v.number()), lastError: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(), deliveredAt: v.optional(v.number()),
  })
    .index("by_userId_eventId", ["userId", "eventId"])
    .index("by_status_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_userId_createdAt", ["userId", "createdAt"]),
};
