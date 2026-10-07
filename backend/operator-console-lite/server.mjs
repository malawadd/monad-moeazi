import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { savePlatformKey, reloadPlatformWorkers } from "./platform-keys.mjs";
import {
  LoginRateLimiter, clearConsoleSessionCookie, consoleSessionCookie,
  issueConsoleSession, loadOrCreateAdminSecret, readConsoleSessionCookie,
  secretMatches, verifyConsoleSession,
} from "./admin-session.mjs";
import { isAllowedOperatorApiRequest, isConsoleHost, isLoopbackAddress, isSameOriginRequest } from "./security.mjs";

const PORT = Number(process.env.MOEAZI_CONSOLE_PORT ?? 3104);
const API_ORIGIN = "http://127.0.0.1:3102";
const MAX_BODY = 1_048_576;
const MAX_RESPONSE = 2_097_152;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(ROOT);
const ADMIN_SECRET = await loadOrCreateAdminSecret(PROJECT_ROOT);
const loginLimiter = new LoginRateLimiter();
let keyWriteInProgress = false;
const STATIC = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.css", ["app.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/programs.js", ["programs.js", "text/javascript; charset=utf-8"]],
  ["/dev-controls.js", ["dev-controls.js", "text/javascript; charset=utf-8"]],
  ["/operator-auth.js", ["operator-auth.js", "text/javascript; charset=utf-8"]],
  ["/console-pages.js", ["console-pages.js", "text/javascript; charset=utf-8"]],
  ["/manual-sequence.js", ["manual-sequence.js", "text/javascript; charset=utf-8"]],
  ["/manual-sequence.css", ["manual-sequence.css", "text/css; charset=utf-8"]],
  ["/autonomy-controls.js", ["autonomy-controls.js", "text/javascript; charset=utf-8"]],
  ["/autonomy.css", ["autonomy.css", "text/css; charset=utf-8"]],
  ["/fonts/syne.woff2", ["assets/syne.woff2", "font/woff2"]],
  ["/fonts/jakarta.woff2", ["assets/jakarta.woff2", "font/woff2"]],
  ["/fonts/plex.woff2", ["assets/plex.woff2", "font/woff2"]],
]);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

function send(response, status, body, type = "application/json; charset=utf-8", extra = {}) {
  response.writeHead(status, {
    "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": CSP, "Referrer-Policy": "no-referrer", ...extra,
  });
  response.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

async function readJson(request) {
  const announced = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(announced) || announced < 0 || announced > MAX_BODY) {
    const error = new Error("Request body is too large."); error.status = 413; throw error;
  }
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) { const error = new Error("Request body is too large."); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { const error = new Error("Request must contain valid JSON."); error.status = 400; throw error; }
}

function validSession(request) {
  const raw = readConsoleSessionCookie(request.headers.cookie);
  if (!raw) return false;
  try { return verifyConsoleSession(ADMIN_SECRET, decodeURIComponent(raw)); }
  catch { return false; }
}

function sendJsonProxy(response, upstream, bytes) {
  let data;
  try { data = JSON.parse(bytes.toString("utf8")); }
  catch { send(response, 502, { error: "The local API returned an invalid response." }); return; }
  send(response, upstream.status, data);
}

async function readBoundedResponse(upstream) {
  const reader = upstream.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) { await reader.cancel(); throw new Error("Response is too large."); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

async function sessionRoute(request, response, pathname) {
  if (pathname === "/api/session" && request.method === "GET") {
    send(response, 200, { authenticated: validSession(request) }); return true;
  }
  if (pathname === "/api/session/logout" && request.method === "POST") {
    if (!isSameOriginRequest(request.headers.origin, request.headers.host)) {
      send(response, 403, { error: "Cross-origin operator requests are blocked." }); return true;
    }
    send(response, 200, { authenticated: false }, undefined, { "Set-Cookie": clearConsoleSessionCookie() });
    return true;
  }
  if (pathname !== "/api/session/login" || request.method !== "POST") return false;
  if (!isSameOriginRequest(request.headers.origin, request.headers.host)) {
    send(response, 403, { error: "Cross-origin operator requests are blocked." }); return true;
  }
  const address = request.socket.remoteAddress ?? "unknown";
  if (!loginLimiter.allowed(address)) { send(response, 429, { error: "Too many login attempts. Try again in 15 minutes." }); return true; }
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    send(response, 415, { error: "Send application/json." }); return true;
  }
  let input;
  try { input = await readJson(request); }
  catch (error) { send(response, error.status ?? 400, { error: error.message }); return true; }
  const valid = input && !Array.isArray(input) && Object.keys(input).length === 1
    && secretMatches(ADMIN_SECRET, input.password);
  if (!valid) {
    loginLimiter.failed(address);
    send(response, 401, { error: "The local admin secret is not valid." }); return true;
  }
  loginLimiter.succeeded(address);
  send(response, 200, { authenticated: true }, undefined,
    { "Set-Cookie": consoleSessionCookie(issueConsoleSession(ADMIN_SECRET)) });
  return true;
}

async function proxy(request, response, pathname, search) {
  if (!pathname.startsWith("/api/operator") || !["GET", "POST", "PATCH", "PUT", "DELETE"].includes(request.method)) {
    send(response, 404, { error: "Route not found." }); return;
  }
  if (!isAllowedOperatorApiRequest(request.headers.origin, request.headers.host, request.method)) {
    send(response, 403, { error: "Cross-origin operator requests are blocked." }); return;
  }
  if (!validSession(request)) { send(response, 401, { error: "Sign in with the local operator secret." }); return; }
  const bridge = process.env.OPERATOR_CONSOLE_BRIDGE_SECRET;
  if (!bridge || bridge.length < 40) { send(response, 503, { error: "The private API bridge is not configured." }); return; }
  let body;
  if (!["GET", "DELETE"].includes(request.method)) {
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      send(response, 415, { error: "Send application/json." }); return;
    }
    try { body = await readJson(request); }
    catch (error) { send(response, error.status ?? 400, { error: error.message }); return; }
  }
  if (pathname === "/api/operator" && body && typeof body === "object" && typeof body.operation === "string") {
    const { validateEnvelope } = await import("./security.mjs");
    const checked = validateEnvelope(body);
    if (checked.error) { send(response, checked.status, { error: checked.error }); return; }
  }
  if (pathname === "/api/operator/providers/key") {
    if (keyWriteInProgress) { send(response, 409, { error: "Another provider update is running." }); return; }
    keyWriteInProgress = true;
    try {
      const { provider, apiKey } = body ?? {};
      const saved = await savePlatformKey(PROJECT_ROOT, provider, apiKey);
      await reloadPlatformWorkers(PROJECT_ROOT);
      send(response, 200, { provider, saved: true, changed: saved.changed, runtimeReloaded: true });
    } catch (error) {
      send(response, 400, { error: error instanceof Error ? error.message : "Provider key could not be saved." });
    } finally { keyWriteInProgress = false; }
    return;
  }
  let upstreamPath = pathname;
  if (upstreamPath === "/api/operator") upstreamPath = "/api/operator";
  else if (upstreamPath.startsWith("/api/operator/sequences")) {
    upstreamPath = upstreamPath.replace("/api/operator/sequences", "/api/sequences");
  }
  let upstream;
  try {
    upstream = await fetch(`${API_ORIGIN}${upstreamPath}${search}`, {
      method: request.method,
      headers: { Accept: "application/json", "x-moeazi-operator-bridge": bridge,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(120_000),
    });
  } catch { send(response, 502, { error: "The local API could not be reached on port 3102." }); return; }
  if (upstream.status >= 300 && upstream.status < 400) { send(response, 502, { error: "The local API returned an unexpected redirect." }); return; }
  try { sendJsonProxy(response, upstream, await readBoundedResponse(upstream)); }
  catch { send(response, 502, { error: "The local API response is too large." }); }
}

const server = createServer(async (request, response) => {
  if (!isLoopbackAddress(request.socket.remoteAddress) || !isConsoleHost(request.headers.host)) {
    send(response, 403, { error: "Use this console through 127.0.0.1:3104." }); return;
  }
  let parsed;
  try { parsed = new URL(request.url, "http://127.0.0.1"); }
  catch { send(response, 400, { error: "Invalid request URL." }); return; }
  if (await sessionRoute(request, response, parsed.pathname)) return;
  if (request.method === "GET" || request.method === "HEAD") {
    const asset = STATIC.get(parsed.pathname);
    if (asset) {
      try { send(response, 200, await readFile(path.join(ROOT, asset[0])), asset[1]); }
      catch { send(response, 404, { error: "Asset not found." }); }
      return;
    }
  }
  if (parsed.pathname.startsWith("/api/operator")) {
    await proxy(request, response, parsed.pathname, parsed.search); return;
  }
  send(response, 404, { error: "Route not found." });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Moeazi operator console: http://127.0.0.1:${PORT}\n`);
});
