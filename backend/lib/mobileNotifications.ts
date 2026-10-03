export type MobileNotificationCategory = "ai" | "trades" | "money" | "credits" | "venues" | "safety";

export type MobileNotificationEvent = {
  category: MobileNotificationCategory;
  title: string;
  summary: string;
  activityId?: string;
  failedExecution?: boolean;
};

export function buildMobileNotification(event: MobileNotificationEvent) {
  const clean = (value: string) => value.replace(/0x[a-fA-F0-9]{16,}/g, "wallet").replace(/[A-Za-z0-9_-]{32,}/g, "reference").slice(0, 160);
  return {
    category: event.category,
    title: clean(event.title),
    body: clean(event.summary),
    priority: event.category === "safety" || event.failedExecution ? "high" as const : "normal" as const,
    deepLink: event.activityId ? `moeazi-monad://activity/${encodeURIComponent(event.activityId)}` : `moeazi-monad://${event.category === "safety" ? "safety" : "activity"}`,
  };
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
