import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oldBase = process.env.API_PARITY_OLD_URL ?? "http://127.0.0.1:3102";
const newBase = process.env.API_PARITY_NEW_URL ?? "http://127.0.0.1:3112";
const routeRoot = path.join(root, "app", "api", "mobile");
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : entry.name === "route.ts" ? [file] : [];
  }));
  return nested.flat();
}

function requestPath(file) {
  const segments = path.relative(routeRoot, path.dirname(file)).split(path.sep);
  return `/api/mobile/${segments.map((segment) => {
    if (/^\[\.\.\./.test(segment)) return "fixture-path";
    if (/^\[\[\.\.\./.test(segment)) return "fixture-path";
    if (/^\[/.test(segment)) return segment.includes("providerId") ? "x" : "fixture-id";
    return segment;
  }).join("/")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

async function capture(base, route, method) {
  const response = await fetch(`${base}${route}?compatibilityProbe=1`, {
    method,
    headers: { accept: "application/json", "content-type": "application/json" },
    body: ["POST", "PUT", "PATCH", "DELETE"].includes(method) ? "{}" : undefined,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const bodyText = method === "HEAD" ? "" : await response.text();
  let body;
  try { body = canonicalJson(JSON.parse(bodyText)); } catch { body = bodyText; }
  const headers = Object.fromEntries(["content-type", "cache-control", "allow", "location", "vary", "www-authenticate"]
    .map((name) => [name, response.headers.get(name)]).filter(([, value]) => value !== null));
  headers["set-cookie-present"] = response.headers.has("set-cookie");
  return { status: response.status, headers, body };
}

const mismatches = [];
let total = 0;
for (const file of await files(routeRoot)) {
  const source = await readFile(file, "utf8");
  const available = methods.filter((method) => new RegExp(
    `export\\s+(?:(?:async\\s+)?function\\s+${method}\\b|const\\s+${method}\\s*=|\\{[^}]*\\b${method}\\b[^}]*\\}\\s+from)`,
  ).test(source));
  for (const method of available) {
    const route = requestPath(file);
    const oldResult = await capture(oldBase, route, method);
    const newResult = await capture(newBase, route, method);
    total += 1;
    if (JSON.stringify(oldResult) !== JSON.stringify(newResult)) {
      mismatches.push({ method, route, oldStatus: oldResult.status, newStatus: newResult.status });
    }
  }
}

console.log(JSON.stringify({ routes: new Set((await files(routeRoot)).map(requestPath)).size, operations: total, mismatches }));
if (total < 55 || mismatches.length) process.exitCode = 1;
