import test from "node:test";
import assert from "node:assert/strict";
import { buildMobileNotification, mobileNotificationDelivery } from "../lib/mobileNotifications";

test("mobile safety notifications are high priority and redact wallet-like values", () => {
  const notification = buildMobileNotification({ category: "safety", title: "Safety review", summary: `Wallet 0x${"a".repeat(40)} needs attention`, activityId: "activity-1" });
  assert.equal(notification.priority, "high");
  assert.doesNotMatch(notification.body, /0x[a-f0-9]{40}/);
  assert.equal(notification.deepLink, "moeazi-monad://activity/activity-1");
});

test("unconfigured notification delivery never contacts a provider", async () => {
  assert.deepEqual(await mobileNotificationDelivery.deliver(["one", "two"], buildMobileNotification({ category: "ai", title: "AI", summary: "No action" })), { delivered: 0, skipped: 2 });
});
