import assert from "node:assert/strict";
import { test } from "node:test";
import { gatewayCredentialRequest } from "../convex/gatewayCredentialHttp";

const handler = (gatewayCredentialRequest as any)._handler;
const body = { venue: "hyperliquid", strategyAccountId: "strategy-a",
  venueAccountId: "venue-a", targetAddress: "0x" + "1".repeat(40) };

test("credential route rejects broad worker token and missing separate configuration", async () => {
  const before = {
    gateway: process.env.GATEWAY_CREDENTIAL_SECRET,
    worker: process.env.WORKER_SHARED_SECRET,
  };
  try {
    process.env.WORKER_SHARED_SECRET = "worker-secret".padEnd(32, "x");
    process.env.GATEWAY_CREDENTIAL_SECRET = process.env.WORKER_SHARED_SECRET;
    let queried = false;
    const ctx = { runQuery: async () => { queried = true; return {}; } };
    const request = (token: string) => new Request("https://example.convex.site/execution-gateway/credential", {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    });
    assert.equal((await handler(ctx, request(process.env.WORKER_SHARED_SECRET))).status, 503);
    process.env.GATEWAY_CREDENTIAL_SECRET = "gateway-secret".padEnd(32, "y");
    assert.equal((await handler(ctx, request(process.env.WORKER_SHARED_SECRET))).status, 401);
    assert.equal(queried, false);
    assert.equal((await handler(ctx, request(process.env.GATEWAY_CREDENTIAL_SECRET))).status, 200);
    assert.equal(queried, true);
  } finally {
    if (before.gateway === undefined) delete process.env.GATEWAY_CREDENTIAL_SECRET;
    else process.env.GATEWAY_CREDENTIAL_SECRET = before.gateway;
    if (before.worker === undefined) delete process.env.WORKER_SHARED_SECRET;
    else process.env.WORKER_SHARED_SECRET = before.worker;
  }
});
