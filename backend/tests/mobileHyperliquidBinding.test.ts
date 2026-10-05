import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { createMobileAccessToken } from "../lib/particleSession";
import { mobileHyperliquidBinding } from "../lib/mobileHyperliquidBinding";

test("legacy Magic session is rejected before Hyperliquid binding dispatch", async () => {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {type: "pkcs8", format: "pem"},
    publicKeyEncoding: {type: "spki", format: "pem"},
  });
  const previous = {
    issuer: process.env.PARTICLE_CONVEX_JWT_ISSUER,
    privateKey: process.env.PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM,
    publicKey: process.env.PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM,
  };
  process.env.PARTICLE_CONVEX_JWT_ISSUER = "https://mobile-binding-test.local";
  process.env.PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM = pair.privateKey;
  process.env.PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM = pair.publicKey;
  const originalFetch = globalThis.fetch;
  let dispatches = 0;
  globalThis.fetch = (async () => {
    dispatches += 1;
    throw new Error("Legacy binding must not dispatch.");
  }) as typeof fetch;
  try {
    const token = await createMobileAccessToken({
      subject: "magic:0x1111111111111111111111111111111111111111",
      authProvider: "magic",
      walletAddress: "0x1111111111111111111111111111111111111111",
      deviceId: "device-a",
    });
    const request = () => new Request("http://localhost/mobile", {
      method: "POST",
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
      body: JSON.stringify({attemptId: "attempt-a"}),
    });
    for (const operation of ["binding-challenge", "credentials"] as const) {
      const response = await mobileHyperliquidBinding(request(), operation);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error, "Mobile session is invalid or expired.");
    }
    assert.equal(dispatches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    };
    restore("PARTICLE_CONVEX_JWT_ISSUER", previous.issuer);
    restore("PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM", previous.privateKey);
    restore("PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM", previous.publicKey);
  }
});
