import { readFile } from "node:fs/promises";
import path from "node:path";
import { importPKCS8, SignJWT } from "jose";
import { buildMobileNotification, DisabledPushTransport, type PushTransport, type PushTransportResult } from "../../../lib/mobileNotifications.js";

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
let cachedToken: { value: string; expiresAt: number } | undefined;
let cachedCredential: Promise<ServiceAccount> | undefined;

function enabled() {
  return process.env.MOBILE_PUSH_ENABLED === "true" && process.env.PUSH_TRANSPORT === "fcm";
}

async function serviceAccount(): Promise<ServiceAccount> {
  if (cachedCredential) return cachedCredential;
  cachedCredential = (async () => {
    const backendRoot = process.cwd();
    const relativePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim() || ".data/firebase-service-account.json";
    const accountPath = path.resolve(backendRoot, relativePath);
    const localDataRoot = path.resolve(backendRoot, ".data");
    if (!accountPath.startsWith(`${localDataRoot}${path.sep}`)) throw new Error("Push credential path must stay inside backend/.data.");
    const parsed = JSON.parse(await readFile(accountPath, "utf8")) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error("FCM service account is incomplete.");
    return parsed as ServiceAccount;
  })().catch((error) => { cachedCredential = undefined; throw error; });
  return cachedCredential;
}

async function accessToken(account: ServiceAccount) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const key = await importPKCS8(account.private_key.replace(/\\n/g, "\n"), "RS256");
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setAudience(account.token_uri || TOKEN_URL)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const response = await fetch(account.token_uri || TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error("FCM OAuth token request failed.");
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token || !body.expires_in) throw new Error("FCM OAuth token response was incomplete.");
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

function isUnregistered(body: any) {
  return body?.error?.status === "NOT_FOUND"
    || body?.error?.details?.some((detail: any) => detail?.errorCode === "UNREGISTERED");
}

export class FcmPushTransport implements PushTransport {
  async deliver(pushTokens: string[], event: ReturnType<typeof buildMobileNotification>): Promise<PushTransportResult> {
    if (!enabled()) return { delivered: 0, skipped: pushTokens.length, invalidTokens: [], deliveredTokens: [], failedTokens: [] };
    if (!pushTokens.length) return { delivered: 0, skipped: 0, invalidTokens: [], deliveredTokens: [], failedTokens: [] };
    const account = await serviceAccount();
    const token = await accessToken(account);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
    const outcomes = await Promise.all(pushTokens.map(async (pushToken) => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ message: {
            token: pushToken,
            notification: { title: event.title, body: event.body },
            data: { id: event.id ?? "", url: event.deepLink },
            android: { priority: event.priority, notification: { tag: event.id ?? event.deepLink } },
          } }),
        });
        if (response.ok) return { token: pushToken, delivered: true, invalid: false };
        const body = await response.json().catch(() => ({}));
        return { token: pushToken, delivered: false, invalid: isUnregistered(body) };
      } catch {
        return { token: pushToken, delivered: false, invalid: false };
      }
    }));
    const deliveredTokens = outcomes.filter((outcome) => outcome.delivered).map((outcome) => outcome.token);
    const invalidTokens = outcomes.filter((outcome) => outcome.invalid).map((outcome) => outcome.token);
    const failedTokens = outcomes.filter((outcome) => !outcome.delivered && !outcome.invalid).map((outcome) => outcome.token);
    return { delivered: deliveredTokens.length, skipped: outcomes.length - deliveredTokens.length,
      invalidTokens, deliveredTokens, failedTokens };
  }
}

const disabledTransport = new DisabledPushTransport();
const fcmTransport = new FcmPushTransport();

export function pushTransportFor(provider: string): PushTransport {
  if (!enabled()) return disabledTransport;
  return provider === "fcm" ? fcmTransport : disabledTransport;
}

export function pushTransportEnabled() { return enabled(); }
