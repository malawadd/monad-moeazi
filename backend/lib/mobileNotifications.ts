export type MobileNotificationCategory = "ai" | "trades" | "money" | "credits" | "venues" | "safety";
export type MobileNotificationEventKind = "autonomous_entry" | "autonomous_close" | "settlement_problem" | "manual_fill";
export type MobileNotificationPreferences = {
  enabled: boolean; autonomousEntries: boolean; autonomousCloses: boolean;
  settlementProblems: boolean; manualFills: boolean; showAmounts: boolean;
};

export const defaultMobileNotificationPreferences: MobileNotificationPreferences = {
  enabled: false, autonomousEntries: true, autonomousCloses: true,
  settlementProblems: true, manualFills: true, showAmounts: false,
};

export function notificationAllowed(preferences: MobileNotificationPreferences, eventKind: MobileNotificationEventKind) {
  if (!preferences.enabled) return false;
  if (eventKind === "autonomous_entry") return preferences.autonomousEntries;
  if (eventKind === "autonomous_close") return preferences.autonomousCloses;
  if (eventKind === "settlement_problem") return preferences.settlementProblems;
  return preferences.manualFills;
}

export function notificationDeviceKey(provider: string, deviceId: string) {
  return JSON.stringify([provider, deviceId]);
}

export function undeliveredNotificationDevices<T extends {provider: string; deviceId: string}>(
  devices: T[], deliveredDeviceKeys: string[],
) {
  const delivered = new Set(deliveredDeviceKeys);
  return devices.filter((device) => !delivered.has(notificationDeviceKey(device.provider, device.deviceId)));
}

export type MobileNotificationEvent = {
  id?: string;
  category: MobileNotificationCategory;
  title: string;
  summary: string;
  redactedSummary?: string;
  activityId?: string;
  failedExecution?: boolean;
};

function clean(value: string) {
  return value.replace(/0x[a-fA-F0-9]{16,}/g, "wallet")
    .replace(/[A-Za-z0-9_-]{32,}/g, "reference").slice(0, 160);
}

export function buildMobileNotification(event: MobileNotificationEvent, showAmounts = true) {
  const privateTitle = event.category === "safety" ? "Safety update"
    : event.category === "trades" ? "Trade update" : "Moeazi update";
  const activityPathId = event.activityId && /^[A-Za-z0-9_-]{1,100}$/.test(event.activityId)
    ? `/${encodeURIComponent(event.activityId)}` : "";
  return {
    id: event.id,
    category: event.category,
    title: clean(showAmounts ? event.title : privateTitle),
    body: clean(showAmounts ? event.summary : event.redactedSummary ?? "Open Moeazi Activity for details."),
    priority: event.category === "safety" || event.failedExecution ? "high" as const : "normal" as const,
    deepLink: `moeazi-monad://${activityPathId ? "activity" : event.category === "safety" ? "safety" : "activity"}${activityPathId}`,
  };
}

export type PushTransportResult = {
  delivered: number; skipped: number; invalidTokens: string[];
  deliveredTokens: string[]; failedTokens: string[];
};

/** Provider-neutral delivery contract; device tokens remain opaque strings. */
export interface PushTransport {
  deliver(pushTokens: string[], event: ReturnType<typeof buildMobileNotification>): Promise<PushTransportResult>;
}

export class DisabledPushTransport implements PushTransport {
  async deliver(pushTokens: string[]): Promise<PushTransportResult> {
    return { delivered: 0, skipped: pushTokens.length, invalidTokens: [], deliveredTokens: [], failedTokens: [] };
  }
}

export interface MobileNotificationDeliveryAdapter {
  deliver(pushTokens: string[], event: ReturnType<typeof buildMobileNotification>): Promise<{ delivered: number; skipped: number }>;
}

export class UnconfiguredMobileNotificationDelivery implements MobileNotificationDeliveryAdapter {
  async deliver(pushTokens: string[], event: ReturnType<typeof buildMobileNotification>) {
    void event;
    return { delivered: 0, skipped: pushTokens.length };
  }
}

export const mobileNotificationDelivery = new UnconfiguredMobileNotificationDelivery();
