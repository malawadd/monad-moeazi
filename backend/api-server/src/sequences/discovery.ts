import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FunctionDescriptor, FunctionKind } from "./types.js";

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const UNKNOWN_SCHEMA = { type: "object", additionalProperties: false } as const;
let sourceInventory: Promise<FunctionDescriptor[]> | undefined;
const runtimeInventory = new Map<string, FunctionDescriptor>();

async function files(directory: string, extension: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { return []; }
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(full, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) found.push(full);
  }
  return found;
}

function safetyHint(id: string): Pick<FunctionDescriptor, "safety" | "cost" | "possibleEffects" | "requiredAuthority"> {
  const value = id.toLowerCase();
  if (/(withdraw|deposit|fund|broadcast|submit|execute|trade|transfer|order|release|activate)/.test(value)) {
    return { safety: "live", requiredAuthority: "May require owner signature or execution authority. This entry is unreviewed and blocked; the console cannot supply owner signatures or certify a live path.",
      cost: { class: "unknown", description: "Possible funded or live side effect; exact behavior is unreviewed." },
      possibleEffects: ["Could prepare, authorize, move, or submit funds."] };
  }
  if (/(probe|provider|analysis|dispatch|experiment|evaluate|modelcall|generation)/.test(value)) {
    return { safety: "paid", requiredAuthority: "Provider credentials or operator consent may be required. This entry is unreviewed and blocked; credentials stay server-side.",
      cost: { class: "possible", description: "May consume provider or analysis credits." },
      possibleEffects: ["Could contact a paid provider or create billable work."] };
  }
  return { safety: "unknown", requiredAuthority: "Authority requirements are unknown. This entry is unreviewed and blocked pending a safety review.",
    cost: { class: "unknown", description: "Cost and side effects have not been reviewed." },
    possibleEffects: ["Effects are unknown until the function is reviewed."] };
}

function unknown(id: string, source: FunctionDescriptor["source"], kind: FunctionKind,
  target: FunctionDescriptor["target"]): FunctionDescriptor {
  const hint = safetyHint(id);
  return { id, version: 1, title: id, source, kind, target, reviewed: false, runnable: false,
    blockedReason: "No reviewed argument schema, identity rule, effect description, and safety classification is registered.",
    argumentSchema: UNKNOWN_SCHEMA, identityModes: [], effectDescription: "Unreviewed function. It cannot run in a manual sequence.",
    possibleEffects: hint.possibleEffects, requiredAuthority: hint.requiredAuthority, cost: hint.cost, safety: hint.safety,
    mutation: kind === "mutation" || kind === "action" || (kind === "http" && target.method !== "GET") };
}

async function convexFunctions(): Promise<FunctionDescriptor[]> {
  const found: FunctionDescriptor[] = [];
  for (const file of await files(path.join(BACKEND_ROOT, "convex"), ".ts")) {
    if (file.includes(path.sep + "_generated" + path.sep)) continue;
    const source = await readFile(file, "utf8");
    const moduleName = path.relative(path.join(BACKEND_ROOT, "convex"), file)
      .replace(/\.ts$/, "").split(path.sep).join("/");
    const pattern = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(internalQuery|internalMutation|internalAction|query|mutation|action)(?:<[^>]+>)?\s*\(/g;
    for (const match of source.matchAll(pattern)) {
      const fn = match[1];
      const kind = match[2].replace(/^internal/, "").toLowerCase() as FunctionKind;
      const id = "convex:" + moduleName + "." + fn;
      found.push(unknown(id, "convex", kind, { module: moduleName, name: fn }));
    }
  }
  return found;
}

export function sourceOfPythonRoute(text: string, service: "agent" | "execution" | "test-center") {
  const prefixes = new Map<string, string>();
  const declarations = /([A-Za-z_]\w*)\s*=\s*APIRouter\(([^)]*)\)/gs;
  for (const match of text.matchAll(declarations)) {
    const value = match[2].match(/\bprefix\s*=\s*["']([^"']*)["']/)?.[1] ?? "";
    prefixes.set(match[1], value);
  }
  const routes: FunctionDescriptor[] = [];
  const pattern = /@([A-Za-z_]\w*)\.(get|post|put|patch|delete|options|head)\(\s*["']([^"']*)["']/g;
  for (const match of text.matchAll(pattern)) {
    const method = match[2].toUpperCase();
    const suffix = match[3];
    const prefix = prefixes.get(match[1]) ?? "";
    const routePath = match[1] === "app" ? suffix
      : (prefix.replace(/\/$/, "") + (suffix ? "/" + suffix.replace(/^\//, "") : ""));
    const source = service === "test-center" ? "test-center" : service;
    const id = source + ":" + method + " " + routePath;
    routes.push(unknown(id, source, "http", { method, path: routePath }));
  }
  return routes;
}

async function pythonFunctions(): Promise<FunctionDescriptor[]> {
  const root = path.join(BACKEND_ROOT, "agent-service", "src", "moeazi_agent");
  const found: FunctionDescriptor[] = [];
  for (const file of await files(root, ".py")) {
    const name = path.basename(file);
    const service = name.startsWith("test_center") ? "test-center"
      : name === "execution_api.py" ? "execution" : "agent";
    found.push(...sourceOfPythonRoute(await readFile(file, "utf8"), service));
  }
  return found;
}

export function sourceOfSidecarRoutes(text: string): FunctionDescriptor[] {
  const found: FunctionDescriptor[] = [];
  const pathPattern = /(?:req\.url\s*===\s*|req\.url\??\.\s*(?:startsWith|endsWith)\(\s*|\.pathname\s*===\s*)["']([^"']+)["']/g;
  for (const match of text.matchAll(pathPattern)) {
    const routePath = match[1].split("?")[0];
    const from = Math.max(0, match.index - 360);
    const through = Math.min(text.length, match.index + match[0].length + 100);
    const context = text.slice(from, through);
    const methodPattern = /req\.method\s*===\s*["'](GET|POST|PUT|PATCH|DELETE)["']/g;
    const before = [...text.slice(from, match.index).matchAll(methodPattern)];
    const after = context.slice(match.index - from + match[0].length).match(methodPattern)?.[1];
    const method = before.at(-1)?.[1] ?? after ?? "UNKNOWN";
    const displayPath = match[0].includes("startsWith") ? routePath + "*" : routePath;
    const id = "sidecar:" + method + " " + displayPath;
    if (!found.some((item) => item.id === id)) found.push(unknown(id, "sidecar", "http", { method, path: displayPath }));
  }
  return found;
}

async function sidecarFunctions(): Promise<FunctionDescriptor[]> {
  const found: FunctionDescriptor[] = [];
  const root = path.join(BACKEND_ROOT, "execution-sidecar", "src");
  for (const file of await files(root, ".ts")) found.push(...sourceOfSidecarRoutes(await readFile(file, "utf8")));
  return found;
}

export async function discoverFunctions() {
  sourceInventory ??= Promise.all([convexFunctions(), pythonFunctions(), sidecarFunctions()])
    .then((groups) => groups.flat());
  const descriptors = [...await sourceInventory, ...runtimeInventory.values()];
  const unique = new Map(descriptors.map((item) => [item.id, item]));
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function boundedJson(response: Response, maximumBytes: number) {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) { await reader.cancel(); throw new Error("OpenAPI document too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks.map((item) => Buffer.from(item)), size).toString("utf8"));
}

async function refreshService(source: FunctionDescriptor["source"], base: string) {
  let url: URL;
  try { url = new URL(base); } catch { return; }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) return;
  try {
    const response = await fetch(url.origin + "/openapi.json", { signal: AbortSignal.timeout(2_000), cache: "no-store" });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > 2_000_000) return;
    const spec = await boundedJson(response, 2_000_000) as { paths?: Record<string, Record<string, unknown>> };
    if (!spec.paths || typeof spec.paths !== "object" || Array.isArray(spec.paths)) return;
    for (const [id, value] of runtimeInventory) if (value.source === source) runtimeInventory.delete(id);
    for (const [routePath, methods] of Object.entries(spec.paths)) for (const method of Object.keys(methods)) {
      if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(method.toLowerCase())) continue;
      const upper = method.toUpperCase();
      const id = source + ":" + upper + " " + routePath;
      runtimeInventory.set(id, unknown(id, source, "http", { method: upper, path: routePath }));
    }
  } catch { /* Source declarations remain visible while a local service is offline. */ }
}

export async function refreshServiceInventory(environment = process.env): Promise<void> {
  const services: Array<[FunctionDescriptor["source"], string]> = [
    ["agent", environment.AGENT_API_URL || "http://127.0.0.1:9100"],
    ["execution", environment.EXECUTION_GATEWAY_PUBLIC_URL || "http://127.0.0.1:9200"],
  ];
  if (environment.AGENT_TEST_CENTER_ENABLED === "true") {
    services.push(["test-center", environment.TEST_CENTER_API_URL || "http://127.0.0.1:9110"]);
  }
  await Promise.all(services.map(([source, base]) => refreshService(source, base)));
}
