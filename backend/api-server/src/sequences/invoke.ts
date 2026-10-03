import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { importPKCS8, SignJWT } from "jose";
import { FIXTURE_SUBJECT } from "./catalog.js";
import { sha256 } from "./canonical.js";
import { InvocationError, type FunctionDescriptor, type IdentityMode } from "./types.js";

const operatorSubject = "moeazi:operator:local";
const timeoutMs = 15_000;

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new InvocationError("Required local service configuration is unavailable.", "definite", 503);
  return value;
}

function privateKey() {
  return importPKCS8(env("PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM").replace(/\\n/g, "\n"), "RS256");
}

async function operatorToken() {
  const key = await privateKey();
  return new SignJWT({ authProvider: "local_operator" })
    .setProtectedHeader({ alg: "RS256", kid: process.env.PARTICLE_CONVEX_JWT_KID || "moeazi-monad-local" })
    .setIssuer(env("PARTICLE_CONVEX_JWT_ISSUER"))
    .setAudience("convex")
    .setSubject(operatorSubject)
    .setIssuedAt()
    .setExpirationTime("60s")
    .setJti(sha256(String(Date.now()) + ":" + Math.random()).slice(0, 32))
    .sign(key);
}

async function callConvex(descriptor: FunctionDescriptor, args: unknown) {
  const url = assertLocalConvexUrl(process.env.CONVEX_SELF_HOSTED_URL || process.env.NEXT_PUBLIC_CONVEX_URL);
  const moduleName = descriptor.target.module;
  const name = descriptor.target.name;
  if (!moduleName || !name) throw new InvocationError("Reviewed Convex target is incomplete.", "definite", 500);
  const client = new ConvexHttpClient(url);
  client.setAuth(await operatorToken());
  const api = anyApi as unknown as Record<string, Record<string, unknown>>;
  const functionReference = api[moduleName]?.[name];
  if (!functionReference) throw new InvocationError("Reviewed Convex function was not found.", "definite", 404);
  try {
    if (descriptor.kind === "query") return await (client as any).query(functionReference, args);
    if (descriptor.kind === "mutation") return await (client as any).mutation(functionReference, args);
    if (descriptor.kind === "action") return await (client as any).action(functionReference, args);
    throw new InvocationError("Unsupported Convex function kind.", "definite", 400);
  } catch (error) {
    if (error instanceof InvocationError) throw error;
    const message = error instanceof Error ? error.message : "Convex request failed.";
    const certainty = descriptor.mutation ? "uncertain" : "definite";
    throw new InvocationError(message.slice(0, 500), certainty);
  }
}

export function assertLocalConvexUrl(value: string | undefined) {
  if (!value) throw new InvocationError("Local Convex URL is not configured.", "definite", 503);
  let url: URL;
  try { url = new URL(value); }
  catch { throw new InvocationError("Local Convex URL is invalid.", "definite", 503); }
  if (!["http:", "https:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    || url.port !== "3310" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new InvocationError("Convex sequence calls are restricted to the loopback Monad deployment on port 3310.", "definite", 403);
  }
  return url.origin;
}

export function assertMonadServiceUrl(source: Exclude<FunctionDescriptor["source"], "convex">, value: string | undefined) {
  if (!value) throw new InvocationError("Local service URL is not configured.", "definite", 503);
  const expectedPort = source === "agent" ? "9100" : source === "execution" ? "9200"
    : source === "sidecar" ? "9300" : "9110";
  let url: URL;
  try { url = new URL(value); } catch { throw new InvocationError("Local service URL is invalid.", "definite", 503); }
  if (!["http:", "https:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    || url.port !== expectedPort || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new InvocationError(`Reviewed ${source} calls are restricted to the loopback Monad service on port ${expectedPort}.`, "definite", 403);
  }
  return url.origin;
}

function serviceUrl(source: Exclude<FunctionDescriptor["source"], "convex">) {
  const value = source === "agent" ? process.env.AGENT_API_URL || "http://127.0.0.1:9100"
    : source === "execution" ? process.env.EXECUTION_GATEWAY_PUBLIC_URL || "http://127.0.0.1:9200"
      : source === "sidecar" ? process.env.EXECUTION_SIDECAR_PUBLIC_URL || "http://127.0.0.1:9300"
        : process.env.TEST_CENTER_API_URL || "http://127.0.0.1:9110";
  return assertMonadServiceUrl(source, value);
}

function routePath(descriptor: FunctionDescriptor, args: unknown) {
  let path = descriptor.target.path ?? "";
  const body = { ...(args as Record<string, unknown>) };
  for (const match of path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const value = body[match[1]];
    if (typeof value !== "string") throw new InvocationError("A reviewed path argument is missing.", "definite", 400);
    path = path.replace(match[0], encodeURIComponent(value));
    delete body[match[1]];
  }
  return { path, body };
}

async function callHttp(descriptor: FunctionDescriptor & { source: Exclude<FunctionDescriptor["source"], "convex"> }, args: unknown, identityMode: IdentityMode,
  sessionId: string) {
  const method = descriptor.target.method;
  if (!method || !descriptor.target.path) throw new InvocationError("Reviewed HTTP target is incomplete.", "definite", 500);
  const root = serviceUrl(descriptor.source);
  const target = routePath(descriptor, args);
  const headers = new Headers({ Accept: "application/json" });
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(target.body);
  }
  if (["agent", "execution", "test-center"].includes(descriptor.source)
    && (method !== "GET" || descriptor.source !== "execution")) {
    const secret = process.env.WORKER_SHARED_SECRET;
    if (secret) headers.set("Authorization", "Bearer " + secret);
  }
  if (descriptor.source === "agent" && descriptor.target.path !== "/health") {
    headers.set("Authorization", "Bearer " + env("WORKER_SHARED_SECRET"));
  }
  if (descriptor.source === "test-center") {
    headers.set("Authorization", "Bearer " + env("WORKER_SHARED_SECRET"));
    const subject = identityMode === "fixture" ? FIXTURE_SUBJECT : operatorSubject;
    headers.set("X-Moeazi-Subject", subject);
    headers.set("X-Moeazi-Session-Id", sha256(sessionId + ":" + subject));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(root + target.path, { method, headers, body, signal: controller.signal,
      redirect: "error", cache: "no-store" });
  } catch {
    throw new InvocationError("Local service did not return a definite response.", descriptor.mutation ? "uncertain" : "definite");
  } finally { clearTimeout(timer); }

  let bytes: string;
  try { bytes = await response.text(); }
  catch { throw new InvocationError("Local service response could not be read.", descriptor.mutation ? "uncertain" : "definite", response.status); }
  if (Buffer.byteLength(bytes, "utf8") > 1_048_576) {
    throw new InvocationError("Local service response exceeded the size limit.", descriptor.mutation ? "uncertain" : "definite", response.status);
  }
  let result: unknown;
  try { result = bytes ? JSON.parse(bytes) : null; }
  catch { throw new InvocationError("Local service returned invalid JSON.", descriptor.mutation ? "uncertain" : "definite", response.status); }
  if (!response.ok) {
    const detail = result && typeof result === "object"
      ? (result as Record<string, unknown>).detail ?? (result as Record<string, unknown>).error : null;
    const message = typeof detail === "string" ? detail.slice(0, 500) : "Local service returned HTTP " + response.status + ".";
    throw new InvocationError(message, response.status >= 500 && descriptor.mutation ? "uncertain" : "definite", response.status);
  }
  return result;
}

export async function invokeReviewedFunction(input: { descriptor: FunctionDescriptor; args: unknown;
  identityMode: IdentityMode; sessionId: string }) {
  const { descriptor, args, identityMode, sessionId } = input;
  if (!descriptor.reviewed || !descriptor.runnable) throw new InvocationError(
    descriptor.blockedReason || "This function is not enabled for sequences.", "definite", 403);
  if (identityMode === "fixture" && descriptor.source !== "test-center") {
    throw new InvocationError("Fixture identity is only available for isolated Test Center functions.", "definite", 403);
  }
  if (descriptor.source === "convex") return await callConvex(descriptor, args);
  return await callHttp(descriptor as FunctionDescriptor & { source: Exclude<FunctionDescriptor["source"], "convex"> },
    args, identityMode, sessionId);
}
