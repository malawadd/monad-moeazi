import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

const ADDRESS = /^0x[0-9a-f]{40}$/;

function receiptMatches(raw: string | undefined, expected: {
  strategyAccountId: string; master: string; target: string; agent: string;
}, now: number): boolean {
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    const receipt = data?.bindingReceipt;
    return ["authorization_required", "ready"].includes(data?.state)
      && receipt?.schemaVersion === 1 && receipt?.source === "hyperliquid_info"
      && receipt?.strategyAccountId === expected.strategyAccountId
      && receipt?.masterAddress === expected.master
      && receipt?.targetAddress === expected.target
      && receipt?.apiWalletAddress === expected.agent
      && receipt?.extraAgent?.address === expected.agent
      && Number.isSafeInteger(receipt?.extraAgent?.validUntil)
      && receipt.extraAgent.validUntil > now;
  } catch { return false; }
}

/** Only the separately authenticated execution gateway may call this query. */
export const getHyperliquidExecutionCredential = internalQuery({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    venueAccountId: v.id("venueAccounts"),
    targetAddress: v.string(),
  },
  handler: verifiedHyperliquidCredentialContext,
});

export async function verifiedHyperliquidCredentialContext(ctx: any, args: {
  strategyAccountId: any; venueAccountId: any; targetAddress: string;
}) {
    const [strategy, venueAccount] = await Promise.all([
      ctx.db.get(args.strategyAccountId), ctx.db.get(args.venueAccountId),
    ]);
    if (!strategy || strategy.status !== "active" || strategy.emergencyStop
      || !strategy.accountWalletId || !venueAccount
      || venueAccount.strategyAccountId !== strategy._id
      || venueAccount.venue !== "hyperliquid"
      || venueAccount.role !== "hyperliquid_agent_wallet"
      || venueAccount.status !== "ready" || venueAccount.legacy) return null;
    const wallet = await ctx.db.get(strategy.accountWalletId);
    const master = venueAccount.ownerAddress?.toLowerCase();
    const target = venueAccount.accountId?.toLowerCase();
    const agent = venueAccount.walletAddress.toLowerCase();
    if (!wallet || wallet.userId !== strategy.userId
      || wallet.strategyAccountId && wallet.strategyAccountId !== strategy._id
      || !master || !target || !ADDRESS.test(master) || !ADDRESS.test(target)
      || !ADDRESS.test(agent) || master !== wallet.ownerAddress.toLowerCase()
      || target !== args.targetAddress.toLowerCase()) return null;
    const now = Date.now();
    if (!receiptMatches(venueAccount.readinessJson, {
      strategyAccountId: String(strategy._id), master, target, agent,
    }, now)) return null;
    const [integrations, permissions, credentials] = await Promise.all([
      ctx.db.query("venueIntegrations").withIndex("by_strategyAccountId_venue", (q: any) =>
        q.eq("strategyAccountId", strategy._id).eq("venue", "hyperliquid")).collect(),
      ctx.db.query("venuePermissions").withIndex("by_strategyAccountId_venue", (q: any) =>
        q.eq("strategyAccountId", strategy._id).eq("venue", "hyperliquid")).collect(),
      ctx.db.query("venueCredentials").withIndex("by_strategyAccountId_venue", (q: any) =>
        q.eq("strategyAccountId", strategy._id).eq("venue", "hyperliquid")).collect(),
    ]);
    const activeIntegration = integrations.filter((row: any) => row.status === "ready"
      && row.enabled && row.routingEnabled && row.authorityMode === "autopilot");
    const activePermissions = permissions.filter((row: any) => row.status === "active"
      && row.authorityMode === "autopilot" && row.expiresAt && row.expiresAt > now
      && row.ownerAddress.toLowerCase() === master
      && row.delegatePublicKey?.toLowerCase() === agent);
    const activeCredentials = credentials.filter((row: any) => row.status === "active"
      && row.venueAccountId === venueAccount._id
      && row.publicKey.toLowerCase() === agent);
    if (activeIntegration.length !== 1 || activePermissions.length !== 1
      || activeCredentials.length !== 1) return null;
    const credential = activeCredentials[0];
    return {
      strategyAccountId: String(strategy._id), venueAccountId: String(venueAccount._id),
      targetAddress: target, masterAddress: master,
      targetKind: target === master ? "master" as const : "subaccount" as const,
      apiWalletAddress: agent, encryptedEnvelope: credential.encryptedEnvelope,
      kmsKeyRef: credential.kmsKeyRef, keyVersion: credential.keyVersion,
      credentialContext: `venue-credential:v1:${strategy._id}:hyperliquid:${agent}`,
      permissionExpiresAt: activePermissions[0].expiresAt,
      limitsJson: activePermissions[0].limitsJson,
    };
}

/** Execution workers receive only the verified account address, never the credential. */
export async function ownedHyperliquidTradingAddress(ctx: any, strategyAccountId: any) {
  const accounts = await ctx.db.query("venueAccounts")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategyAccountId)).collect();
  const candidates = accounts.filter((row: any) => row.venue === "hyperliquid"
    && row.role === "hyperliquid_agent_wallet" && row.status === "ready" && !row.legacy);
  if (candidates.length !== 1 || !ADDRESS.test(candidates[0].accountId ?? "")) return null;
  const verified = await verifiedHyperliquidCredentialContext(ctx, {
    strategyAccountId, venueAccountId: candidates[0]._id,
    targetAddress: candidates[0].accountId,
  });
  if (!verified) return null;
  return { schemaVersion: 1 as const, source: "verified_hyperliquid_binding" as const,
    strategyAccountId: verified.strategyAccountId,
    venueAccountId: verified.venueAccountId,
    masterAddress: verified.masterAddress, targetAddress: verified.targetAddress,
    targetKind: verified.targetKind, permissionExpiresAt: verified.permissionExpiresAt };
}
