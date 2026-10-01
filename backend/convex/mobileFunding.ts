"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { readArbitrumFundingBalances, type MobileFundingSnapshot } from "./helpers/mobileFunding";

const RPC_TIMEOUT_MS = 8_000;

export const refresh = action({
  args: {},
  handler: async (ctx): Promise<MobileFundingSnapshot> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    const wallet = await ctx.runQuery(internal.mobileFundingModel.getWalletForSubject,
      { subject: identity.subject });
    const owner = wallet.ownerAddress.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(owner)) throw new Error("Saved Magic wallet address is invalid.");
    const identityOwner = String(identity.walletAddress ?? "").toLowerCase();
    if (identityOwner !== owner) throw new Error("Funding wallet does not match the authenticated Magic account.");

    const rpcUrl = process.env.ARBITRUM_RPC_URL
      ?? process.env.NEXT_PUBLIC_ARB_RPC_URL
      ?? "https://arb1.arbitrum.io/rpc";
    const funding = await readArbitrumFundingBalances(rpcUrl, owner, (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(RPC_TIMEOUT_MS) }));
    return await ctx.runMutation(internal.mobileFundingModel.recordSnapshot, {
      subject: identity.subject, observedAt: Date.now(), ...funding,
    });
  },
});
