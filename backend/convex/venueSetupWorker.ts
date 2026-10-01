import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { managedTradingVenue } from "./agentValidators";
import { verifyMessage } from "ethers";

const authority = v.union(v.literal("shadow"), v.literal("approval"), v.literal("autopilot"));
const HL_INFO_URL = "https://api.hyperliquid.xyz/info";
const ADDRESS = /^0x[0-9a-f]{40}$/;

function bindingMessage(args: any, strategyAccountId: string) {
  return [
    "Moeazi Hyperliquid account binding", "Version: 1", `Setup attempt: ${args.attemptId}`,
    `Strategy account: ${strategyAccountId}`, `Master address: ${args.masterAddress}`,
    `Target kind: ${args.targetKind}`, `Target address: ${args.targetAddress}`,
    `API wallet address: ${args.apiWalletAddress}`, `Nonce: ${args.nonce}`,
    `Expires at: ${args.expiresAt}`,
  ].join("\n");
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("");
}

async function infoQuery(type: string, user: string) {
  const response = await fetch(HL_INFO_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, user }),
  });
  if (!response.ok) throw new Error("Hyperliquid Info verification is unavailable.");
  return await response.json();
}

export const finalizeVenueSetup = internalMutation({
  args: {
    attemptId: v.id("venueSetupAttempts"),
    ownerAddress: v.string(),
    accountId: v.string(),
    delegatePublicKey: v.optional(v.string()),
    collateralJson: v.string(),
    readinessJson: v.string(),
    limitsJson: v.string(),
    authorityMode: authority,
    permissionExpiresAt: v.optional(v.number()),
    transactionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) throw new Error("Venue setup attempt not found.");
    if (attempt.authorityMode !== args.authorityMode) throw new Error("Authority mode changed during verification.");
    throw new Error(
      "Protocol-specific authenticated venue verification is required before accounts or permissions can be marked ready.",
    );
  },
});

export const registerHyperliquidCredentialBinding = internalAction({
  args: {
    attemptId: v.id("venueSetupAttempts"), masterAddress: v.string(), targetAddress: v.string(),
    targetKind: v.union(v.literal("master"), v.literal("subaccount")), apiWalletAddress: v.string(),
    encryptedEnvelope: v.string(), kmsKeyRef: v.string(), keyVersion: v.number(),
    credentialContext: v.string(), nonce: v.string(), expiresAt: v.number(), ownerSignature: v.string(),
  },
  handler: async (ctx, args): Promise<{ credentialId: string; venueAccountId: string; status: string }> => {
    const context: any = await ctx.runQuery(internal.venueIntegrations.getHyperliquidBindingContext, {
      attemptId: args.attemptId,
    });
    if (!context || context.venue !== "hyperliquid" || context.state !== "verifying"
      || !["approval", "autopilot"].includes(context.authorityMode)) {
      throw new Error("Hyperliquid setup attempt is unavailable.");
    }
    const masterAddress = args.masterAddress.toLowerCase();
    const targetAddress = args.targetAddress.toLowerCase();
    const apiWalletAddress = args.apiWalletAddress.toLowerCase();
    if (!ADDRESS.test(masterAddress) || !ADDRESS.test(targetAddress) || !ADDRESS.test(apiWalletAddress)
      || masterAddress !== context.ownerAddress.toLowerCase()) {
      throw new Error("Hyperliquid master, target, or API-wallet address does not match the owner context.");
    }
    if ((args.targetKind === "master" && targetAddress !== masterAddress)
      || (args.targetKind === "subaccount" && targetAddress === masterAddress)) {
      throw new Error("Hyperliquid target scope is invalid.");
    }
    const now = Date.now();
    if (!args.nonce || args.nonce.length < 32 || args.nonce.length > 64
      || args.expiresAt <= now || args.expiresAt > now + 300_000) {
      throw new Error("Hyperliquid owner-signature challenge expired or is invalid.");
    }
    const credentialContext = `venue-credential:v1:${context.strategyAccountId}:hyperliquid:${apiWalletAddress}`;
    if (args.credentialContext !== credentialContext || !args.encryptedEnvelope
      || args.encryptedEnvelope.length > 16_384 || !args.kmsKeyRef || args.kmsKeyRef.length > 256
      || !Number.isSafeInteger(args.keyVersion) || args.keyVersion < 1) {
      throw new Error("Hyperliquid encrypted credential envelope is invalid.");
    }
    let signer: string;
    try { signer = verifyMessage(bindingMessage({ ...args, masterAddress, targetAddress, apiWalletAddress }, context.strategyAccountId), args.ownerSignature).toLowerCase(); }
    catch { throw new Error("Hyperliquid owner signature is invalid."); }
    if (signer !== masterAddress) throw new Error("Hyperliquid owner signature does not match the master.");
    let apiRole: any; let targetRole: any; let extraAgents: any;
    try {
      [apiRole, targetRole, extraAgents] = await Promise.all([
        infoQuery("userRole", apiWalletAddress), infoQuery("userRole", targetAddress),
        infoQuery("extraAgents", masterAddress),
      ]);
    } catch {
      throw new Error("Hyperliquid Info verification is unavailable.");
    }
    if (!apiRole || apiRole.role !== "agent" || String(apiRole.data?.user ?? "").toLowerCase() !== masterAddress) {
      throw new Error("Hyperliquid API wallet is not an agent for the requested master.");
    }
    const expectedTargetRole = args.targetKind === "master" ? "user" : "subAccount";
    if (!targetRole || targetRole.role !== expectedTargetRole
      || (args.targetKind === "subaccount" && String(targetRole.data?.master ?? "").toLowerCase() !== masterAddress)) {
      throw new Error("Hyperliquid target account role or master binding is invalid.");
    }
    if (!Array.isArray(extraAgents)) throw new Error("Hyperliquid extra-agent response is malformed.");
    const extraAgent = extraAgents.find((row: any) => String(row?.address ?? "").toLowerCase() === apiWalletAddress);
    if (!extraAgent || !Number.isSafeInteger(extraAgent.validUntil) || extraAgent.validUntil <= now) {
      throw new Error("Hyperliquid API-wallet authorization is absent, expired, or has no expiry.");
    }
    const bindingReceiptJson = JSON.stringify({
      schemaVersion: 1, source: "hyperliquid_info", verifiedAt: now,
      attemptId: String(args.attemptId), strategyAccountId: String(context.strategyAccountId),
      masterAddress, targetKind: args.targetKind, targetAddress, apiWalletAddress,
      credentialContext, ownerSignatureHash: await sha256(args.ownerSignature),
      apiWalletRole: apiRole, targetRole,
      extraAgent: { address: apiWalletAddress, validUntil: extraAgent.validUntil },
    });
    return await ctx.runMutation(internal.venueIntegrations.storeHyperliquidCredentialBinding, {
      attemptId: args.attemptId, masterAddress, targetKind: args.targetKind,
      targetAddress, apiWalletAddress, encryptedEnvelope: args.encryptedEnvelope,
      kmsKeyRef: args.kmsKeyRef, keyVersion: args.keyVersion, credentialContext,
      ownerSignatureHash: await sha256(args.ownerSignature), bindingReceiptJson,
    });
  },
});

export const failVenueSetup = internalMutation({
  args: { attemptId: v.id("venueSetupAttempts"), error: v.string() },
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get(args.attemptId);
    if (!attempt) return null;
    await ctx.db.patch(attempt._id, { state: "failed", error: args.error.slice(0, 500), updatedAt: Date.now() });
    return attempt._id;
  },
});

export const completeOptimismMigration = internalMutation({
  args: { migrationId: v.id("optimismMigrations"), reconciliationJson: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.migrationId);
    if (!row || row.status !== "reconciling") throw new Error("Migration is not reconciling.");
    const legacy = await ctx.db.get(row.legacyVenueAccountId);
    const now = Date.now();
    if (legacy) await ctx.db.patch(legacy._id, {
      status: "paused", legacy: true, readinessJson: args.reconciliationJson, updatedAt: now,
    });
    await ctx.db.patch(row._id, { status: "complete", completedAt: now, updatedAt: now });
    return row._id;
  },
});
