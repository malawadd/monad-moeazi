import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { asNextRequest, defineRoute, invoke, nextParams, registerLegacyRoutes } from "../api-server/src/legacy-route-loader.js";
import { NextResponse } from "../api-server/src/next-compat.js";
import { cookies, currentRequest, withRequestScope } from "../api-server/src/request-context.js";
import { loadMonadEnvironment } from "../api-server/src/environment.js";

const apiRoot = "backend/app/api";

test("route definitions retain the /api prefix", () => {
  const route = defineRoute("backend/app/api/mobile/home/route.ts", apiRoot);
  assert.equal(route.pattern, "/api/mobile/home");
});

test("single dynamic params map to the right segment and preserve query strings", () => {
  const route = defineRoute("backend/app/api/mobile/withdrawals/[id]/route.ts", apiRoot);
  const request = new Request("http://127.0.0.1:3102/api/mobile/withdrawals/wd_123?view=full");
  assert.deepEqual(nextParams(request, route), { id: "wd_123" });
  assert.equal(asNextRequest(request).nextUrl.searchParams.get("view"), "full");
});

test("catch-all params decode path segments and ignore the query", () => {
  const route = defineRoute("backend/app/api/agent-monitoring/[...path]/route.ts", apiRoot);
  const request = new Request("http://console.local/api/agent-monitoring/traces/daily%20summary?limit=2");
  assert.deepEqual(nextParams(request, route), { path: ["traces", "daily summary"] });
});

test("optional catch-all matches the base path and deeper paths", () => {
  const route = defineRoute("backend/app/api/agent-evaluations/[[...path]]/route.ts", apiRoot);
  assert.equal(route.path, "/api/agent-evaluations");
  assert.deepEqual(nextParams(new Request("http://console.local/api/agent-evaluations"), route), {});
  assert.deepEqual(nextParams(new Request("http://console.local/api/agent-evaluations/run/a%2Fb"), route), {
    path: ["run", "a/b"],
  });
});

test("request-scoped cookies stay isolated across concurrent requests", async () => {
  const read = (cookie: string, delay: number) => withRequestScope(
    new Request("http://localhost/api", { headers: { Cookie: `session=${cookie}` } }),
    async () => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return (await cookies()).get("session")?.value;
    },
  );
  assert.deepEqual(await Promise.all([read("first", 8), read("second", 1)]), ["first", "second"]);
  assert.equal(currentRequest(), undefined);
});

test("NextResponse JSON and Set-Cookie preserve response headers", async () => {
  const response = NextResponse.json({ ok: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  response.cookies.set({ name: "session", value: "token", path: "/", httpOnly: true, sameSite: "lax" });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Content-Type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.match(response.headers.get("Set-Cookie") ?? "", /session=token; Path=\/; HttpOnly; SameSite=Lax/);
  assert.deepEqual(await response.json(), { ok: true });
});

test("route adaptation preserves a webhook request body byte-for-byte", async () => {
  const body = '{"event":"purchase","signature":"raw-value","spaces":"  "}';
  const route = defineRoute("backend/app/api/mobile/funding/webhooks/[providerId]/route.ts", apiRoot);
  const request = new Request("http://localhost/api/mobile/funding/webhooks/provider-x?eventId=e1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const response = await invoke(async (adapted, context) => Response.json({
    body: await adapted.text(),
    providerId: (await context!.params).providerId,
    eventId: adapted.nextUrl.searchParams.get("eventId"),
  }), request, route);
  assert.deepEqual(await response.json(), { body, providerId: "provider-x", eventId: "e1" });
});

test("Hono registers the complete mobile API and JWKS inventory", async () => {
  await loadMonadEnvironment();
  const app = new Hono();
  assert.equal(await registerLegacyRoutes(app), 56);
  const jwks = await app.request("/api/auth/jwks");
  assert.equal(jwks.status, 200);
  const publicKeys = await jwks.json() as { keys: Array<{ kid: string; alg: string; kty: string }> };
  assert.equal(publicKeys.keys[0]?.kid, process.env.PARTICLE_CONVEX_JWT_KID || "particle-convex");
  assert.equal(publicKeys.keys[0]?.alg, "RS256");
  assert.equal(publicKeys.keys[0]?.kty, "RSA");
  const challenge = await app.request("/api/mobile/auth/challenge", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  });
  assert.equal(challenge.status, 400);
  const home = await app.request("/api/mobile/home");
  assert.equal(home.status, 401);
});
