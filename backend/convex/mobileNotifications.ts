import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { LOCAL_OPERATOR_SUBJECT } from "../lib/operatorIdentity";

export const defaultNotificationPreferences = {
  enabled: false, autonomousEntries: true, autonomousCloses: true,
  settlementProblems: true, manualFills: true, showAmounts: false,
};

const preferenceArgs = {
  enabled: v.boolean(), autonomousEntries: v.boolean(), autonomousCloses: v.boolean(),
  settlementProblems: v.boolean(), manualFills: v.boolean(), showAmounts: v.boolean(),
};
const eventKind = v.union(v.literal("autonomous_entry"), v.literal("autonomous_close"),
  v.literal("settlement_problem"), v.literal("manual_fill"));

async function requireMeraUser(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  const address = String(identity?.walletAddress ?? "").toLowerCase();
  if (!identity || identity.authProvider !== "mera" || !/^0x[a-f0-9]{40}$/.test(address)
      || identity.subject !== `mera:${address}`) throw new Error("A valid Mera mobile identity is required.");
  const user = await ctx.db.query("users").withIndex("by_authSubject", (q: any) => q.eq("authSubject", identity.subject)).first();
  if (!user || String(user.walletAddress ?? "").toLowerCase() !== address) throw new Error("Moeazi account is not provisioned.");
  return { identity, user, address };
}

async function requireLocalDispatcher(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  const issuer = process.env.PARTICLE_CONVEX_JWT_ISSUER ?? "";
  if (!identity || identity.authProvider !== "local_operator" || identity.subject !== LOCAL_OPERATOR_SUBJECT
      || !/^http:\/\/(127\.0\.0\.1|localhost):3102$/.test(issuer)
      || identity.issuer && identity.issuer !== issuer) throw new Error("The local notification dispatcher identity is required.");
}

export const getPreferences = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireMeraUser(ctx);
    const row = await ctx.db.query("mobileNotificationPreferences")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).first();
    if (!row) return defaultNotificationPreferences;
    const { _id, _creationTime, userId, updatedAt, ...preferences } = row;
    void _id; void _creationTime; void userId; void updatedAt;
    return preferences;
  },
});

export const updatePreferences = mutation({
  args: preferenceArgs,
  handler: async (ctx, args) => {
    const { user } = await requireMeraUser(ctx);
    const now = Date.now();
    const row = await ctx.db.query("mobileNotificationPreferences")
      .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).first();
    if (row) await ctx.db.patch(row._id, { ...args, updatedAt: now });
    else await ctx.db.insert("mobileNotificationPreferences", { userId: user._id, ...args, updatedAt: now });
    return { ...args, updatedAt: now };
  },
});

export const registerDevice = mutation({
  args: { deviceId: v.string(), provider: v.string(), platform: v.literal("android"), pushToken: v.string() },
  handler: async (ctx, args) => {
    const { identity, user } = await requireMeraUser(ctx);
    if (identity.deviceId !== args.deviceId || args.provider !== "fcm"
        || !/^[A-Za-z0-9._:-]{8,200}$/.test(args.deviceId) || !args.pushToken || args.pushToken.length > 4096) {
      throw new Error("Notification device registration is invalid.");
    }
    const existing = await ctx.db.query("mobileNotificationDevices")
      .withIndex("by_userId_provider_deviceId", (q: any) => q.eq("userId", user._id).eq("provider", args.provider).eq("deviceId", args.deviceId)).first();
    const now = Date.now();
    const values = { userId: user._id, deviceId: args.deviceId, provider: args.provider,
      platform: args.platform, pushToken: args.pushToken, status: "active" as const,
      createdAt: existing?.createdAt ?? now, updatedAt: now };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("mobileNotificationDevices", values);
    return { registered: true, provider: args.provider };
  },
});

export const unregisterDevice = mutation({
  args: {},
  handler: async (ctx) => {
    const { identity, user } = await requireMeraUser(ctx);
    const rows = await ctx.db.query("mobileNotificationDevices")
      .withIndex("by_userId_deviceId", (q: any) => q.eq("userId", user._id).eq("deviceId", identity.deviceId)).collect();
    const now = Date.now();
    for (const row of rows) await ctx.db.patch(row._id, { status: "disabled", pushToken: undefined, updatedAt: now });
    return { unregistered: rows.length };
  },
});

/** Called only from trusted finalization mutations after a receipt and exchange state agree. */
export const enqueueFinalizedEvent = internalMutation({
  args: { ownerAddress: v.string(), eventId: v.string(), eventKind,
    title: v.string(), summary: v.string(), redactedSummary: v.string(),
    finalityRef: v.string(), finalizedAt: v.number(), activityId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const ownerAddress = args.ownerAddress.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(ownerAddress) || !/^[A-Za-z0-9:._-]{8,200}$/.test(args.eventId)
        || !/^0x[a-f0-9]{64}:0x[a-f0-9]{64}:[0-9]+$/i.test(args.finalityRef)
        || !Number.isSafeInteger(args.finalizedAt) || args.finalizedAt <= 0
        || args.finalizedAt > Date.now() + 60_000) throw new Error("Finalized notification evidence is invalid.");
    const user = await ctx.db.query("users").withIndex("by_walletAddress", (q: any) => q.eq("walletAddress", ownerAddress)).first();
    if (!user || user.authProvider !== "mera") return { queued: false, reason: "owner_missing" as const };
    const existing = await ctx.db.query("mobileNotificationOutbox")
      .withIndex("by_userId_eventId", (q: any) => q.eq("userId", user._id).eq("eventId", args.eventId)).first();
    if (existing) return { queued: false, reason: "duplicate" as const, outboxId: existing._id };
    const now = Date.now();
    const outboxId = await ctx.db.insert("mobileNotificationOutbox", {
      userId: user._id, ownerAddress, eventId: args.eventId, eventKind: args.eventKind,
      title: args.title.slice(0, 120), summary: args.summary.slice(0, 400),
      redactedSummary: args.redactedSummary.slice(0, 400), activityId: args.activityId?.slice(0, 200),
      finalityRef: args.finalityRef, finalizedAt: args.finalizedAt, deliveredDeviceKeys: [],
      status: "pending", attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now,
    });
    return { queued: true, outboxId };
  },
});

export const listDispatchCandidates = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireLocalDispatcher(ctx);
    const now = Date.now();
    const limit = Math.max(1, Math.min(40, Math.trunc(args.limit ?? 20)));
    const [pending, expiredClaims] = await Promise.all([
      ctx.db.query("mobileNotificationOutbox").withIndex("by_status_nextAttemptAt", (q: any) => q.eq("status", "pending").lte("nextAttemptAt", now)).take(limit),
      ctx.db.query("mobileNotificationOutbox").withIndex("by_status_nextAttemptAt", (q: any) => q.eq("status", "claimed").lte("nextAttemptAt", now)).take(limit),
    ]);
    const uniqueRows = [...new Map([...pending, ...expiredClaims].map((row) => [String(row._id), row])).values()].slice(0, limit);
    return await Promise.all(uniqueRows.map(async (row) => {
      const [preferencesRow, devices] = await Promise.all([
        ctx.db.query("mobileNotificationPreferences").withIndex("by_userId", (q: any) => q.eq("userId", row.userId)).first(),
        ctx.db.query("mobileNotificationDevices").withIndex("by_userId_provider", (q: any) => q.eq("userId", row.userId)).collect(),
      ]);
      const preferences = preferencesRow ? {
        enabled: preferencesRow.enabled, autonomousEntries: preferencesRow.autonomousEntries,
        autonomousCloses: preferencesRow.autonomousCloses, settlementProblems: preferencesRow.settlementProblems,
        manualFills: preferencesRow.manualFills, showAmounts: preferencesRow.showAmounts,
      } : defaultNotificationPreferences;
      return { ...row, preferences, devices: devices.filter((device: any) => device.status === "active" && device.pushToken)
        .map((device: any) => ({ deviceId: device.deviceId, provider: device.provider, pushToken: device.pushToken })) };
    }));
  },
});

export const claimDispatchEvent = mutation({
  args: { outboxId: v.id("mobileNotificationOutbox"), leaseToken: v.string() },
  handler: async (ctx, args) => {
    await requireLocalDispatcher(ctx);
    const row = await ctx.db.get(args.outboxId);
    const now = Date.now();
    if (!row || !["pending", "claimed"].includes(row.status) || row.nextAttemptAt > now
        || row.status === "claimed" && (row.leaseUntil ?? 0) > now) return { claimed: false };
    await ctx.db.patch(args.outboxId, { status: "claimed", leaseToken: args.leaseToken,
      leaseUntil: now + 60_000, nextAttemptAt: now + 60_000, attempts: row.attempts + 1, updatedAt: now });
    return { claimed: true };
  },
});

export const completeDispatchEvent = mutation({
  args: { outboxId: v.id("mobileNotificationOutbox"), leaseToken: v.string(),
    result: v.union(v.literal("delivered"), v.literal("suppressed"), v.literal("retry")),
    deliveredDeviceKeys: v.array(v.string()),
    invalidDevices: v.array(v.object({ provider: v.string(), deviceId: v.string(), pushToken: v.string() })),
    error: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireLocalDispatcher(ctx);
    const row = await ctx.db.get(args.outboxId);
    if (!row || row.status !== "claimed" || row.leaseToken !== args.leaseToken) return { completed: false };
    const devices = await ctx.db.query("mobileNotificationDevices")
      .withIndex("by_userId_provider", (q: any) => q.eq("userId", row.userId)).collect();
    const knownKeys = new Set(devices.map((device: any) => JSON.stringify([device.provider, device.deviceId])));
    const deliveredDeviceKeys = [...new Set([...(row.deliveredDeviceKeys ?? []), ...args.deliveredDeviceKeys])]
      .filter((key) => knownKeys.has(key));
    const now = Date.now();
    for (const invalid of args.invalidDevices) {
      const key = JSON.stringify([invalid.provider, invalid.deviceId]);
      const device = devices.find((item: any) => JSON.stringify([item.provider, item.deviceId]) === key);
      if (device?.pushToken === invalid.pushToken) await ctx.db.patch(device._id, { status: "disabled", pushToken: undefined, updatedAt: now });
    }
    if (args.result === "delivered" || args.result === "suppressed") {
      await ctx.db.patch(args.outboxId, { status: args.result, deliveredDeviceKeys,
        leaseToken: undefined, leaseUntil: undefined,
        deliveredAt: args.result === "delivered" ? now : undefined, lastError: undefined, updatedAt: now });
      return { completed: true, status: args.result };
    }
    const failed = row.attempts >= 8;
    const delay = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(row.attempts - 1, 8));
    await ctx.db.patch(args.outboxId, { status: failed ? "failed" : "pending", deliveredDeviceKeys, leaseToken: undefined,
      leaseUntil: undefined, nextAttemptAt: now + delay, lastError: args.error?.slice(0, 200) ?? "Push delivery failed.", updatedAt: now });
    return { completed: true, status: failed ? "failed" : "pending" };
  },
});
