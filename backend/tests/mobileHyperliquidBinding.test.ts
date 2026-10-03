import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { createMobileAccessToken } from "../lib/particleSession";
import { mobileHyperliquidBinding } from "../lib/mobileHyperliquidBinding";

const owner = "0x1111111111111111111111111111111111111111";
const agent = "0x2222222222222222222222222222222222222222";

test("mobile binding forwards only an owned setup attempt and never returns a key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" } });
  const prior = {
    issuer: process.env.PARTICLE_CONVEX_JWT_ISSUER,
    privateKey: process.env.PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM,
    publicKey: process.env.PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM,
    convex: process.env.NEXT_PUBLIC_CONVEX_URL,
    secret: process.env.WORKER_SHARED_SECRET,
    gateway: process.env.EXECUTION_GATEWAY_PUBLIC_URL,
  };
  process.env.PARTICLE_CONVEX_JWT_ISSUER = "https://mobile-binding-test.local";
  process.env.PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM = privateKey;
  process.env.PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM = publicKey;
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://mobile-binding-test.convex.cloud";
  process.env.WORKER_SHARED_SECRET = "test-worker-secret";
  process.env.EXECUTION_GATEWAY_PUBLIC_URL = "http://127.0.0.1:8200";
  const originalQuery = ConvexHttpClient.prototype.query;
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, string>; authorization: string }> = [];
  let owned = true;
  (ConvexHttpClient.prototype as any).query = async () => owned
    ? { attemptId: "attempt-a", ownerAddress: owner, authorityMode: "approval" } : null;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(options.body)),
      authorization: String((options.headers as Record<string, string>).Authorization) });
    return Response.json(calls.length === 1
      ? { challengeId: "hl-bind:00000000-0000-0000-0000-000000000000",
        message: "Sign exact account binding", expiresAt: Date.now() + 60_000, requiredSigner: owner }
      : { credentialId: "credential-a", venueAccountId: "venue-a", protocolBinding: "verified",
        status: "authorization_required", targetKind: "master", targetAddress: owner });
  }) as typeof fetch;
  try {
    const token = await createMobileAccessToken({ subject: "subject-a", authProvider: "magic",
      walletAddress: owner, deviceId: "device-a" });
    const request = (body: object, authenticated = true) => new Request("http://localhost/mobile", {
      method: "POST", headers: { "Content-Type": "application/json",
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    const challenge = await mobileHyperliquidBinding(request({ attemptId: "attempt-a",
      targetKind: "master", targetAddress: owner, apiWalletAddress: agent }), "binding-challenge");
    assert.equal(challenge.status, 200);
    assert.deepEqual(calls[0].body, { attempt_id: "attempt-a", master_address: owner,
      target_kind: "master", target_address: owner, api_wallet_address: agent });
    assert.equal(calls[0].authorization, "Bearer test-worker-secret");

    const key = "a".repeat(64);
    const credential = await mobileHyperliquidBinding(request({ attemptId: "attempt-a",
      challengeId: "hl-bind:00000000-0000-0000-0000-000000000000",
      ownerSignature: `0x${"b".repeat(130)}`, apiWalletPrivateKey: key }), "credentials");
    assert.equal(credential.status, 200);
    assert.equal(calls[1].body.api_wallet_private_key, key);
    assert.equal(JSON.stringify(await credential.json()).includes(key), false);

    owned = false;
    const denied = await mobileHyperliquidBinding(request({ attemptId: "attempt-a",
      targetKind: "master", targetAddress: owner, apiWalletAddress: agent }), "binding-challenge");
    assert.equal(denied.status, 404);
    assert.equal(calls.length, 2);
    const anonymous = await mobileHyperliquidBinding(request({}, false), "credentials");
    assert.equal(anonymous.status, 401);
    assert.equal(calls.length, 2);
  } finally {
    (ConvexHttpClient.prototype as any).query = originalQuery;
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries({
      PARTICLE_CONVEX_JWT_ISSUER: prior.issuer,
      PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM: prior.privateKey,
      PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM: prior.publicKey,
      NEXT_PUBLIC_CONVEX_URL: prior.convex,
      WORKER_SHARED_SECRET: prior.secret,
      EXECUTION_GATEWAY_PUBLIC_URL: prior.gateway,
    })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
