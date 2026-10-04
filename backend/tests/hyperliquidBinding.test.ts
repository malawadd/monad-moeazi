import assert from "node:assert/strict";
import { test } from "node:test";
import { Wallet } from "ethers";
import { storeHyperliquidCredentialBinding } from "../convex/venueIntegrations";
import { finalizeVenueSetup, registerHyperliquidCredentialBinding } from "../convex/venueSetupWorker";

type Row = Record<string, any> & { _id: string };
const handler = (fn: unknown) =>
  (fn as { _handler: (ctx: unknown, args: any) => Promise<any> })._handler;

function database() {
  const rows = new Map<string, Row[]>();
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  add("strategyAccounts", { _id: "strategy-a", userId: "user-a" });
  add("accountWallets", { _id: "wallet-a", userId: "user-a", strategyAccountId: "strategy-a",
    ownerAddress: "0x1111111111111111111111111111111111111111",
    evmUaAddress: "0x2222222222222222222222222222222222222222" });
  add("venueSetupAttempts", { _id: "attempt-a", strategyAccountId: "strategy-a",
    accountWalletId: "wallet-a", venue: "hyperliquid", authorityMode: "approval", state: "verifying" });
  add("venueIntegrations", { _id: "integration-a", strategyAccountId: "strategy-a",
    venue: "hyperliquid", authorityMode: "approval", activeSetupAttemptId: "attempt-a",
    enabled: false, routingEnabled: false, status: "authorization_required" });
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    patch: async (id: string, patch: Record<string, unknown>) => {
      const row = await db.get(id);
      if (!row) throw new Error(`Missing ${id}`);
      Object.assign(row, patch);
      return id;
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${(rows.get(table) ?? []).length + 1}`;
      add(table, { _id: id, ...value });
      inserted.push({ table, value });
      return id;
    },
    query: (table: string) => {
      const conditions: Array<[string, unknown]> = [];
      const chain: any = {
        withIndex: (_name: string, apply: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { conditions.push([key, value]); return q; } };
          apply(q);
          return chain;
        },
        filter: () => chain,
        collect: async () => (rows.get(table) ?? []).filter((row) =>
          conditions.every(([key, value]) => row[key] === value)),
        first: async () => (await chain.collect())[0] ?? null,
      };
      return chain;
    },
  };
  return { ctx: { db }, rows, inserted };
}

function argsFor(targetKind: "master" | "subaccount" = "master") {
  const masterAddress = "0x1111111111111111111111111111111111111111";
  const targetAddress = targetKind === "master"
    ? masterAddress : "0x3333333333333333333333333333333333333333";
  const apiWalletAddress = "0x4444444444444444444444444444444444444444";
  const credentialContext = "venue-credential:v1:strategy-a:hyperliquid:0x4444444444444444444444444444444444444444";
  const ownerSignatureHash = "a".repeat(64);
  const receipt = {
    schemaVersion: 1, source: "hyperliquid_info", verifiedAt: Date.now(),
    attemptId: "attempt-a", strategyAccountId: "strategy-a", masterAddress,
    targetKind, targetAddress, apiWalletAddress, ownerSignatureHash, credentialContext,
    apiWalletRole: { role: "agent", data: { user: masterAddress } },
    targetRole: targetKind === "master" ? { role: "user" } : { role: "subAccount", data: { master: masterAddress } },
    extraAgent: { address: apiWalletAddress, validUntil: 4_000_000_000_000 },
  };
  return {
    attemptId: "attempt-a", masterAddress, targetAddress, targetKind, apiWalletAddress,
    encryptedEnvelope: "opaque-ciphertext", kmsKeyRef: "local-master", keyVersion: 1,
    credentialContext, ownerSignatureHash, bindingReceiptJson: JSON.stringify(receipt),
    // This field was accepted by the old setup route and carries no authority here.
    verified: true,
  };
}

test("verified Hyperliquid binding stores a scoped encrypted credential but leaves routing blocked", async () => {
  const { ctx, inserted, rows } = database();
  const result = await handler(storeHyperliquidCredentialBinding)(ctx, argsFor());
  assert.equal(result.status, "authorization_required");
  const credential = inserted.find((row) => row.table === "venueCredentials")!.value;
  assert.equal(credential.status, "authorization_required");
  assert.equal(credential.encryptedEnvelope, "opaque-ciphertext");
  assert.equal("api_wallet_private_key" in credential, false);
  const integration = rows.get("venueIntegrations")![0];
  assert.equal(integration.status, "authorization_required");
  assert.equal(integration.enabled, false);
  assert.equal(integration.routingEnabled, false);
  assert.equal(rows.get("venueAccounts")!.every((row) => row.status === "approval_required"), true);
  assert.equal(rows.get("venuePermissions"), undefined);
});

test("subaccount receipt must tie both target role and API wallet to the requested master", async () => {
  const { ctx, inserted } = database();
  const args = argsFor("subaccount");
  const receipt = JSON.parse(args.bindingReceiptJson);
  receipt.targetRole.data.master = "0x5555555555555555555555555555555555555555";
  args.bindingReceiptJson = JSON.stringify(receipt);
  await assert.rejects(handler(storeHyperliquidCredentialBinding)(ctx, args), /Info evidence/);
  assert.equal(inserted.length, 0);
});

test("binding rejects stale setup attempts and shadow-only authority", async () => {
  for (const update of [
    { state: "ready" },
    { authorityMode: "shadow" },
  ]) {
    const { ctx, rows, inserted } = database();
    Object.assign(rows.get("venueSetupAttempts")![0], update);
    if (update.authorityMode) Object.assign(rows.get("venueIntegrations")![0], update);
    await assert.rejects(handler(storeHyperliquidCredentialBinding)(ctx, argsFor()), /setup attempt is unavailable/);
    assert.equal(inserted.length, 0);
  }
});

test("gateway registration command rechecks owner signature and live official Info roles", async () => {
  const wallet = Wallet.createRandom();
  const targetAddress = "0x3333333333333333333333333333333333333333";
  const apiWalletAddress = "0x4444444444444444444444444444444444444444";
  const nonce = "n".repeat(32);
  const expiresAt = Date.now() + 240_000;
  const message = [
    "Moeazi Hyperliquid account binding", "Version: 1", "Setup attempt: attempt-a",
    "Strategy account: strategy-a", `Master address: ${wallet.address.toLowerCase()}`,
    "Target kind: subaccount", `Target address: ${targetAddress}`,
    `API wallet address: ${apiWalletAddress}`, `Nonce: ${nonce}`, `Expires at: ${expiresAt}`,
  ].join("\n");
  const ownerSignature = await wallet.signMessage(message);
  const saved: any[] = [];
  const fakeContext = {
    runQuery: async () => ({ venue: "hyperliquid", state: "verifying", authorityMode: "approval",
      strategyAccountId: "strategy-a", ownerAddress: wallet.address.toLowerCase() }),
    runMutation: async (_reference: unknown, args: any) => {
      saved.push(args);
      return { credentialId: "credential-a", venueAccountId: "account-a", status: "authorization_required" };
    },
  };
  const input = {
    attemptId: "attempt-a", masterAddress: wallet.address, targetAddress,
    targetKind: "subaccount", apiWalletAddress,
    encryptedEnvelope: "opaque-ciphertext", kmsKeyRef: "test-kms", keyVersion: 1,
    credentialContext: `venue-credential:v1:strategy-a:hyperliquid:${apiWalletAddress}`,
    nonce, expiresAt, ownerSignature,
  };
  let omitExpiry = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const result = body.type === "extraAgents"
      ? [omitExpiry ? { address: apiWalletAddress } : { address: apiWalletAddress, validUntil: 4_000_000_000_000 }]
      : body.user === apiWalletAddress
        ? { role: "agent", data: { user: wallet.address } }
        : { role: "subAccount", data: { master: wallet.address } };
    return new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await handler(registerHyperliquidCredentialBinding)(fakeContext, input);
    assert.equal(result.status, "authorization_required");
    assert.equal(saved.length, 1);
    const receipt = JSON.parse(saved[0].bindingReceiptJson);
    assert.equal(receipt.targetKind, "subaccount");
    assert.equal(receipt.extraAgent.validUntil, 4_000_000_000_000);
    assert.equal(saved[0].encryptedEnvelope, "opaque-ciphertext");
    assert.equal("ownerSignature" in saved[0], false);
    omitExpiry = true;
    await assert.rejects(handler(registerHyperliquidCredentialBinding)(fakeContext, input), /expiry/);
    assert.equal(saved.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generic worker finalization cannot mark any venue ready", async () => {
  const { ctx, rows } = database();
  const attempt = rows.get("venueSetupAttempts")![0];
  await assert.rejects(handler(finalizeVenueSetup)(ctx, {
    attemptId: attempt._id, ownerAddress: "0x1111111111111111111111111111111111111111",
    accountId: "account-a", collateralJson: "{}", readinessJson: "{}", limitsJson: "{}",
    authorityMode: "approval",
  }), /Protocol-specific authenticated venue verification/);
  assert.equal(rows.get("venueAccounts"), undefined);
});
