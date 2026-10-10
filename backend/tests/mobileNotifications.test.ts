import test from "node:test";
import assert from "node:assert/strict";
import { buildMobileNotification, defaultMobileNotificationPreferences, mobileNotificationDelivery, notificationAllowed,
  notificationDeviceKey, undeliveredNotificationDevices } from "../lib/mobileNotifications";
import { DisabledPushTransport } from "../lib/mobileNotifications";
import { FcmPushTransport } from "../api-server/src/notifications/transport";

test("mobile safety notifications are high priority and redact wallet-like values", () => {
  const notification = buildMobileNotification({ category: "safety", title: "Safety review", summary: `Wallet 0x${"a".repeat(40)} needs attention`, activityId: "activity-1" });
  assert.equal(notification.priority, "high");
  assert.doesNotMatch(notification.body, /0x[a-f0-9]{40}/);
  assert.equal(notification.deepLink, "moeazi-monad://activity/activity-1");
  const privateActivity = buildMobileNotification({ category: "trades", title: "Trade", summary: "Confirmed", activityId: "manual:order:fill" });
  assert.equal(privateActivity.deepLink, "moeazi-monad://activity");
});

test("unconfigured notification delivery never contacts a provider", async () => {
  assert.deepEqual(await mobileNotificationDelivery.deliver(["one", "two"], buildMobileNotification({ category: "ai", title: "AI", summary: "No action" })), { delivered: 0, skipped: 2 });
});

test("trade preferences are opt-in and keep lock-screen amounts private", () => {
  assert.equal(defaultMobileNotificationPreferences.enabled, false);
  assert.equal(defaultMobileNotificationPreferences.showAmounts, false);
  assert.equal(notificationAllowed(defaultMobileNotificationPreferences, "manual_fill"), false);
  assert.equal(notificationAllowed({ ...defaultMobileNotificationPreferences, enabled: true, manualFills: false }, "manual_fill"), false);
  assert.equal(notificationAllowed({ ...defaultMobileNotificationPreferences, enabled: true }, "autonomous_entry"), true);
  const notification = buildMobileNotification({ category: "trades", title: "Closed", summary: "Net PnL +$12.50", redactedSummary: "Trade closed" }, false);
  assert.equal(notification.title, "Trade update");
  assert.equal(notification.body, "Trade closed");
  const withoutSafeSummary = buildMobileNotification({ category: "trades", title: "Closed +$12.50", summary: "Net PnL +$12.50" }, false);
  assert.equal(withoutSafeSummary.title, "Trade update");
  assert.equal(withoutSafeSummary.body, "Open Moeazi Activity for details.");
});

test("disabled PushTransport accepts no sends", async () => {
  const result = await new DisabledPushTransport().deliver(["opaque-token"], buildMobileNotification({ category: "trades", title: "Entry", summary: "Entered" }));
  assert.deepEqual(result, { delivered: 0, skipped: 1, invalidTokens: [], deliveredTokens: [], failedTokens: [] });
});

test("outbox retry skips provider devices already accepted for the event", () => {
  const devices = [
    { provider: "fcm", deviceId: "phone-a", pushToken: "token-a" },
    { provider: "fcm", deviceId: "phone-b", pushToken: "token-b" },
  ];
  const delivered = [notificationDeviceKey("fcm", "phone-a")];
  const retry = undeliveredNotificationDevices(devices, delivered);
  assert.deepEqual(retry.map((device) => device.deviceId), ["phone-b"]);
  assert.deepEqual(undeliveredNotificationDevices(retry, [...delivered, notificationDeviceKey("fcm", "phone-b")]), []);
});

test("FCM transport stays network-idle while the backend push gate is off", async () => {
  const previousEnabled = process.env.MOBILE_PUSH_ENABLED;
  const previousProvider = process.env.PUSH_TRANSPORT;
  process.env.MOBILE_PUSH_ENABLED = "false";
  process.env.PUSH_TRANSPORT = "fcm";
  try {
    const result = await new FcmPushTransport().deliver(["opaque-token"], buildMobileNotification({ category: "trades", title: "Entry", summary: "Entered" }));
    assert.deepEqual(result, { delivered: 0, skipped: 1, invalidTokens: [], deliveredTokens: [], failedTokens: [] });
  } finally {
    if (previousEnabled === undefined) delete process.env.MOBILE_PUSH_ENABLED;
    else process.env.MOBILE_PUSH_ENABLED = previousEnabled;
    if (previousProvider === undefined) delete process.env.PUSH_TRANSPORT;
    else process.env.PUSH_TRANSPORT = previousProvider;
  }
});
