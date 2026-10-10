import { randomUUID } from "node:crypto";
import { buildMobileNotification, notificationAllowed, notificationDeviceKey, undeliveredNotificationDevices,
  type MobileNotificationEventKind } from "../../../lib/mobileNotifications.js";
import { operatorMutation, operatorQuery } from "../monad/convex.js";
import { pushTransportEnabled, pushTransportFor } from "./transport.js";

let running = false;

type Candidate = {
  _id: string; eventId: string; eventKind: MobileNotificationEventKind; title: string;
  summary: string; redactedSummary: string; activityId?: string;
  preferences: { enabled: boolean; autonomousEntries: boolean; autonomousCloses: boolean;
    settlementProblems: boolean; manualFills: boolean; showAmounts: boolean };
  devices: Array<{ deviceId: string; provider: string; pushToken: string }>;
  deliveredDeviceKeys: string[];
};

async function dispatchCandidate(candidate: Candidate) {
  const leaseToken = randomUUID();
  const claim = await operatorMutation("mobileNotifications", "claimDispatchEvent", {
    outboxId: candidate._id, leaseToken,
  }) as { claimed: boolean };
  if (!claim.claimed) return;

  const finish = async (result: "delivered" | "suppressed" | "retry", deliveredDeviceKeys: string[],
    invalidDevices: Array<{ provider: string; deviceId: string; pushToken: string }>, error?: string) => operatorMutation("mobileNotifications", "completeDispatchEvent", {
    outboxId: candidate._id, leaseToken, result,
    deliveredDeviceKeys, invalidDevices, ...(error ? { error } : {}),
  });

  if (!notificationAllowed(candidate.preferences, candidate.eventKind)) {
    await finish("suppressed", [], []);
    return;
  }
  const pendingDevices = undeliveredNotificationDevices(candidate.devices, candidate.deliveredDeviceKeys ?? []);
  if (!pendingDevices.length) {
    await finish(candidate.deliveredDeviceKeys?.length ? "delivered" : "suppressed", [], []);
    return;
  }

  const event = buildMobileNotification({
    id: candidate.eventId,
    category: candidate.eventKind === "settlement_problem" ? "safety" : "trades",
    title: candidate.title,
    summary: candidate.summary,
    redactedSummary: candidate.redactedSummary,
    activityId: candidate.activityId,
    failedExecution: candidate.eventKind === "settlement_problem",
  }, candidate.preferences.showAmounts);
  const groups = new Map<string, Array<{ deviceId: string; provider: string; pushToken: string }>>();
  for (const device of pendingDevices) groups.set(device.provider, [...(groups.get(device.provider) ?? []), device]);
  const deliveredDeviceKeys: string[] = [];
  let attemptedProvider = false;
  let transientFailure = false;
  const invalidDevices = new Map<string, { provider: string; deviceId: string; pushToken: string }>();
  for (const [provider, devices] of groups) {
    if (provider === "fcm") attemptedProvider = true;
    try {
      const result = await pushTransportFor(provider).deliver(devices.map((device) => device.pushToken), event);
      for (const device of devices) {
        if (result.deliveredTokens.includes(device.pushToken)) deliveredDeviceKeys.push(notificationDeviceKey(device.provider, device.deviceId));
        if (result.invalidTokens.includes(device.pushToken)) {
          invalidDevices.set(notificationDeviceKey(device.provider, device.deviceId), device);
        }
      }
      if (result.failedTokens.length) transientFailure = true;
    } catch {
      transientFailure = true;
    }
  }
  const invalidRows = [...invalidDevices.values()];
  if (transientFailure) await finish("retry", deliveredDeviceKeys, invalidRows, "Push provider request failed.");
  else if (deliveredDeviceKeys.length || candidate.deliveredDeviceKeys?.length) await finish("delivered", deliveredDeviceKeys, invalidRows);
  else await finish("suppressed", [], invalidRows, attemptedProvider ? undefined : "No enabled transport supports this provider.");
}

export async function drainPushOutboxOnce() {
  if (running || !pushTransportEnabled()) return;
  running = true;
  try {
    const candidates = await operatorQuery("mobileNotifications", "listDispatchCandidates", { limit: 25 }) as Candidate[];
    for (const candidate of candidates) await dispatchCandidate(candidate);
  } finally {
    running = false;
  }
}

export function startPushOutboxDispatcher() {
  if (!pushTransportEnabled()) return () => undefined;
  const timer = setInterval(() => {
    void drainPushOutboxOnce().catch(() => process.stderr.write("[notifications] outbox delivery pass failed.\n"));
  }, 15_000);
  timer.unref();
  void drainPushOutboxOnce().catch(() => process.stderr.write("[notifications] initial outbox delivery pass failed.\n"));
  return () => clearInterval(timer);
}
