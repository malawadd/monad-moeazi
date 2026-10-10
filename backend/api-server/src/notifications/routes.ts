import type { ApiApp } from "../app.js";
import { meraMutation, meraQuery } from "../monad/convex.js";
import { MonadApiError } from "../monad/config.js";
import { parseBody, requireMera, routeError } from "../monad/auth.js";
import { defaultMobileNotificationPreferences } from "../../../lib/mobileNotifications.js";

const PREF_KEYS = ["enabled", "autonomousEntries", "autonomousCloses", "settlementProblems", "manualFills", "showAmounts"] as const;
type PreferenceKey = typeof PREF_KEYS[number];

function pushConfigReady() {
  return process.env.MOBILE_PUSH_ENABLED === "true" && process.env.PUSH_TRANSPORT === "fcm";
}

function preferencesFromBody(value: unknown) {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const preferences = body.preferences && typeof body.preferences === "object" && !Array.isArray(body.preferences)
    ? body.preferences as Record<string, unknown> : body;
  if (PREF_KEYS.some((key) => typeof preferences[key] !== "boolean")) {
    throw new MonadApiError("Every notification preference must be a boolean.", 400, "notification_preferences_invalid");
  }
  return Object.fromEntries(PREF_KEYS.map((key) => [key, preferences[key]])) as Record<PreferenceKey, boolean>;
}

function errorResponse(context: any, error: unknown) {
  const result = routeError(error);
  return context.json(result.body, result.status as any);
}

export function registerPushNotificationRoutes(app: ApiApp) {
  app.get("/api/mobile/notifications/capabilities", async (context) => {
    try {
      await requireMera(context);
      return context.json({ enabled: pushConfigReady(), provider: pushConfigReady() ? "fcm" : "disabled" });
    } catch (error) { return errorResponse(context, error); }
  });

  app.get("/api/mobile/notifications/preferences", async (context) => {
    try {
      const auth = await requireMera(context);
      const preferences = await meraQuery(auth.token, "mobileNotifications", "getPreferences", {});
      return context.json(preferences ?? defaultMobileNotificationPreferences);
    } catch (error) { return errorResponse(context, error); }
  });

  app.patch("/api/mobile/notifications/preferences", async (context) => {
    try {
      const auth = await requireMera(context);
      const body = parseBody(await context.req.json().catch(() => null));
      const preferences = preferencesFromBody(body);
      return context.json(await meraMutation(auth.token, "mobileNotifications", "updatePreferences", preferences));
    } catch (error) { return errorResponse(context, error); }
  });

  app.post("/api/mobile/notifications/device", async (context) => {
    try {
      const auth = await requireMera(context);
      if (!pushConfigReady()) throw new MonadApiError("Push registration is disabled on this service.", 503, "push_disabled");
      const body = parseBody(await context.req.json().catch(() => null));
      if (body.provider !== "fcm" || body.platform !== "android" || typeof body.pushToken !== "string"
          || body.pushToken.length < 20 || body.pushToken.length > 4096 || /[\r\n\0\s]/.test(body.pushToken)) {
        throw new MonadApiError("Android FCM registration details are invalid.", 400, "push_device_invalid");
      }
      const result = await meraMutation(auth.token, "mobileNotifications", "registerDevice", {
        deviceId: auth.deviceId,
        provider: "fcm", platform: "android", pushToken: body.pushToken,
      });
      return context.json(result);
    } catch (error) { return errorResponse(context, error); }
  });

  app.delete("/api/mobile/notifications/device", async (context) => {
    try {
      const auth = await requireMera(context);
      return context.json(await meraMutation(auth.token, "mobileNotifications", "unregisterDevice", {}));
    } catch (error) { return errorResponse(context, error); }
  });
}
