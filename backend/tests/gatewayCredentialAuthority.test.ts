import assert from "node:assert/strict";
import { test } from "node:test";
import { getHyperliquidExecutionCredential,
  ownedHyperliquidTradingAddress } from "../convex/gatewayCredentialAuthority";

const master = "0x1111111111111111111111111111111111111111";
const agent = "0x2222222222222222222222222222222222222222";
const target = "0x3333333333333333333333333333333333333333";
const handler = (getHyperliquidExecutionCredential as any)._handler;

function fixture() {
  const rows: Record<string, any[]> = {
    strategyAccounts: [{ _id: "strategy-a", userId: "user-a", accountWalletId: "wallet-a",
      status: "active", emergencyStop: false }],
    accountWallets: [{ _id: "wallet-a", userId: "user-a", strategyAccountId: "strategy-a",
      ownerAddress: master }],
    venueAccounts: [{ _id: "venue-a", strategyAccountId: "strategy-a", venue: "hyperliquid",
      role: "hyperliquid_agent_wallet", status: "ready", legacy: false,
      ownerAddress: master, accountId: target, walletAddress: agent,
      readinessJson: JSON.stringify({ state: "authorization_required", bindingReceipt: {
        schemaVersion: 1, source: "hyperliquid_info", strategyAccountId: "strategy-a",
        masterAddress: master, targetAddress: target, apiWalletAddress: agent,
        extraAgent: { address: agent, validUntil: Date.now() + 60_000 },
      } }) }],
    venueIntegrations: [{ strategyAccountId: "strategy-a", venue: "hyperliquid",
      status: "ready", enabled: true, routingEnabled: true, authorityMode: "autopilot" }],
    venuePermissions: [{ strategyAccountId: "strategy-a", venue: "hyperliquid", status: "active",
      authorityMode: "autopilot", expiresAt: Date.now() + 60_000,
      ownerAddress: master, delegatePublicKey: agent, limitsJson: '{"maxOrderUsd":5}' }],
    venueCredentials: [{ strategyAccountId: "strategy-a", venue: "hyperliquid",
      venueAccountId: "venue-a", status: "active", publicKey: agent,
      encryptedEnvelope: "opaque", kmsKeyRef: "test-kms", keyVersion: 1 }],
  };
  const db = {
    get: async (id: string) => Object.values(rows).flat().find((row) => row._id === id) ?? null,
    query: (table: string) => {
      const constraints: Array<[string, unknown]> = [];
      const chain: any = {
        withIndex: (_name: string, fn: (q: any) => unknown) => {
          const q = { eq: (key: string, value: unknown) => { constraints.push([key, value]); return q; } };
          fn(q); return chain;
        },
        collect: async () => rows[table].filter((row) =>
          constraints.every(([key, value]) => row[key] === value)),
      };
      return chain;
    },
  };
  return { rows, ctx: { db } };
}

const args = { strategyAccountId: "strategy-a", venueAccountId: "venue-a", targetAddress: target };

test("gateway credential is available only for one active owned Hyperliquid scope", async () => {
  const { ctx } = fixture();
  const credential = await handler(ctx, args);
  assert.equal(credential.encryptedEnvelope, "opaque");
  assert.equal(credential.targetAddress, target);
  assert.equal(credential.masterAddress, master);
  assert.equal(credential.targetKind, "subaccount");
  assert.equal(credential.credentialContext,
    `venue-credential:v1:strategy-a:hyperliquid:${agent}`);
});

test("gateway credential stays unavailable for disabled, stopped, expired, or ambiguous authority", async () => {
  const changes = [
    (rows: any) => { rows.strategyAccounts[0].emergencyStop = true; },
    (rows: any) => { rows.venueIntegrations[0].routingEnabled = false; },
    (rows: any) => { rows.venuePermissions[0].expiresAt = Date.now() - 1; },
    (rows: any) => { rows.venueCredentials.push({ ...rows.venueCredentials[0] }); },
    (rows: any) => { rows.venueAccounts[0].accountId = master; },
    (rows: any) => { rows.venueAccounts[0].status = "approval_required"; },
  ];
  for (const change of changes) {
    const { ctx, rows } = fixture();
    change(rows);
    assert.equal(await handler(ctx, args), null);
  }
});

test("execution context receives only the exact verified trading address", async () => {
  const { ctx, rows } = fixture();
  const binding = await ownedHyperliquidTradingAddress(ctx, "strategy-a");
  assert.equal(binding?.targetAddress, target);
  assert.equal(binding?.masterAddress, master);
  assert.equal(binding?.targetKind, "subaccount");
  assert.equal("encryptedEnvelope" in (binding ?? {}), false);
  rows.venuePermissions[0].expiresAt = Date.now() - 1;
  assert.equal(await ownedHyperliquidTradingAddress(ctx, "strategy-a"), null);
});
