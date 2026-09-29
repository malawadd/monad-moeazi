import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const SESSION_TTL_MS = 30 * 60 * 1000;
const COOKIE_NAME = "moeazi_operator_session";
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function loadOrCreateAdminSecret(root) {
  const secretPath = path.join(root, ".data", "operator-console-admin.secret");
  await mkdir(path.dirname(secretPath), { recursive: true });
  try {
    const saved = (await readFile(secretPath, "utf8")).trim();
    if (/^[A-Za-z0-9_-]{40,64}$/.test(saved)) return saved;
    throw new Error("The local admin secret file is malformed. Back it up, remove it, then rerun Monad setup to generate a new secret.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32).toString("base64url");
  await writeFile(secretPath, `${secret}\n`, { mode: 0o600, flag: "wx" }).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const created = (await readFile(secretPath, "utf8")).trim();
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(created)) {
    throw new Error("The local admin secret file is malformed. Back it up, remove it, then rerun Monad setup to generate a new secret.");
  }
  return created;
}

function mac(secret, payload) {
  return createHmac("sha256", secret).update("moeazi-console-session-v1\0").update(payload).digest();
}

export function issueConsoleSession(secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    expiresAt: now + SESSION_TTL_MS,
    nonce: randomBytes(18).toString("base64url"),
  })).toString("base64url");
  return `${payload}.${mac(secret, payload).toString("base64url")}`;
}

export function verifyConsoleSession(secret, value, now = Date.now()) {
  if (typeof value !== "string" || value.length > 2_048) return false;
  const [payload, supplied, ...extra] = value.split(".");
  if (!payload || !supplied || extra.length) return false;
  const expected = mac(secret, payload);
  let received;
  try { received = Buffer.from(supplied, "base64url"); } catch { return false; }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return body && Object.keys(body).sort().join(",") === "expiresAt,nonce"
      && Number.isSafeInteger(body.expiresAt) && body.expiresAt > now
      && body.expiresAt <= now + SESSION_TTL_MS + 5_000
      && typeof body.nonce === "string" && /^[A-Za-z0-9_-]{20,40}$/.test(body.nonce);
  } catch { return false; }
}

export function readConsoleSessionCookie(header) {
  if (typeof header !== "string" || header.length > 32_768) return null;
  const matches = header.split(";").filter((item) => item.trim().startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  return matches[0].trim().slice(COOKIE_NAME.length + 1) || null;
}

export function consoleSessionCookie(token) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearConsoleSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export class LoginRateLimiter {
  #clients = new Map();

  allowed(address, now = Date.now()) {
    const entry = this.#clients.get(address);
    if (!entry || now - entry.startedAt >= WINDOW_MS) {
      this.#clients.set(address, { startedAt: now, failures: 0 });
      return true;
    }
    return entry.failures < MAX_FAILURES;
  }

  failed(address, now = Date.now()) {
    const entry = this.#clients.get(address);
    if (!entry || now - entry.startedAt >= WINDOW_MS) {
      this.#clients.set(address, { startedAt: now, failures: 1 });
    } else entry.failures++;
  }

  succeeded(address) { this.#clients.delete(address); }
}

export function secretMatches(expectedSecret, candidate) {
  if (typeof candidate !== "string" || candidate.length > 512) return false;
  const expected = createHmac("sha256", "moeazi-console-login-v1").update(expectedSecret).digest();
  const received = createHmac("sha256", "moeazi-console-login-v1").update(candidate).digest();
  return timingSafeEqual(expected, received);
}
