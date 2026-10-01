/* eslint-disable @typescript-eslint/no-explicit-any */
import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { assertUnsignedInteger, decimalFromRaw, fundingObservationDisposition, MOBILE_FUNDING_CHAIN_ID,
  MOBILE_FUNDING_REGISTRY_VERSION, MOBILE_FUNDING_USDC_ADDRESS } from "./helpers/mobileFunding";
import { getUserByAuthSubject } from "./model";

const STALE_AFTER_MS = 60_000;

async function walletForSubject(ctx: any, subject: string) {
  const user = await getUserByAuthSubject(ctx, subject);
  if (!user) return null;
  const wallet = await ctx.db.query("accountWallets")
    .withIndex("by_userId", (q: any) => q.eq("userId", user._id)).first();
  return wallet ? { user, wallet } : null;
}

function snapshot(wallet: any, now = Date.now()) {
  const usdcAmount = wallet.arbitrumUsdcBalance ?? "0";
  const ethAmount = wallet.arbitrumEthBalance ?? "0";
  const observedAt = wallet.arbitrumBalanceObservedAt;
  return {
    schemaVersion: "2026-09-01" as const,
    ownerAddress: wallet.ownerAddress,
    depositAddress: wallet.evmDepositAddress ?? wallet.evmUaAddress,
    universalAccount: wallet.evmUaAddress,
    network: "Arbitrum" as const,
    chainId: MOBILE_FUNDING_CHAIN_ID,
    status: assertUnsignedInteger(wallet.arbitrumUsdcBalanceRaw ?? "0", "USDC balance") > 0n
      ? "available" as const : "waiting" as const,
    tradingAsset: {
      symbol: "USDC" as const, amount: usdcAmount, amountUsd: usdcAmount,
      contractAddress: MOBILE_FUNDING_USDC_ADDRESS, decimals: 6 as const,
    },
    feeAsset: { symbol: "ETH" as const, amount: ethAmount, decimals: 18 as const },
    observedBlock: wallet.arbitrumBalanceBlock,
    observedAt: observedAt ? new Date(observedAt).toISOString() : undefined,
    stale: !observedAt || now - observedAt > STALE_AFTER_MS,
  };
}

export const getWalletForSubject = internalQuery({
  args: { subject: v.string() },
  handler: async (ctx, args) => {
    const result = await walletForSubject(ctx, args.subject);
    if (!result) throw new Error("Moeazi account wallet is not ready.");
    return {
      ownerAddress: result.wallet.ownerAddress,
      evmUaAddress: result.wallet.evmUaAddress,
      evmDepositAddress: result.wallet.evmDepositAddress,
    };
  },
});

export const getSnapshot = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    const result = await walletForSubject(ctx, identity.subject);
    if (!result) throw new Error("Moeazi account wallet is not ready.");
    return snapshot(result.wallet);
  },
});

function eventDetail(asset: "USDC" | "ETH", amount: string, balance: string, block: number) {
  return JSON.stringify({ asset, amount, balance, chainId: MOBILE_FUNDING_CHAIN_ID,
    observedBlock: block, source: "arbitrum_rpc" });
}

export const recordSnapshot = internalMutation({
  args: {
    subject: v.string(), blockNumber: v.number(), observedAt: v.number(),
    usdcBalanceRaw: v.string(), ethBalanceRaw: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await walletForSubject(ctx, args.subject);
    if (!result) throw new Error("Moeazi account wallet is not ready.");
    const { user, wallet } = result;
    const usdcRaw = assertUnsignedInteger(args.usdcBalanceRaw, "USDC balance");
    const ethRaw = assertUnsignedInteger(args.ethBalanceRaw, "ETH balance");
    if (!Number.isSafeInteger(args.blockNumber) || args.blockNumber <= 0) {
      throw new Error("Arbitrum block number is invalid.");
    }
    const previousBlock = wallet.arbitrumBalanceBlock;
    const disposition = fundingObservationDisposition({
      block: previousBlock,
      usdcRaw: wallet.arbitrumUsdcBalanceRaw,
      ethRaw: wallet.arbitrumEthBalanceRaw,
    }, { block: args.blockNumber, usdcRaw: usdcRaw.toString(), ethRaw: ethRaw.toString() });
    if (disposition !== "new") return snapshot(wallet);

    const usdc = decimalFromRaw(usdcRaw.toString(), 6);
    const eth = decimalFromRaw(ethRaw.toString(), 18);
    const usdcUsd = Number(usdc);
    if (!Number.isFinite(usdcUsd) || usdcUsd < 0) {
      throw new Error("USDC balance cannot be represented in the compatibility projection.");
    }
    const previousUsdc = assertUnsignedInteger(wallet.arbitrumUsdcBalanceRaw ?? "0", "Previous USDC balance");
    const previousEth = assertUnsignedInteger(wallet.arbitrumEthBalanceRaw ?? "0", "Previous ETH balance");
    const assetsJson = JSON.stringify({
      version: MOBILE_FUNDING_REGISTRY_VERSION,
      chainId: MOBILE_FUNDING_CHAIN_ID,
      assets: [
        { symbol: "USDC", address: MOBILE_FUNDING_USDC_ADDRESS, amount: usdc, rawAmount: usdcRaw.toString(), decimals: 6, purpose: "trading" },
        { symbol: "ETH", address: null, amount: eth, rawAmount: ethRaw.toString(), decimals: 18, purpose: "network_fees" },
      ],
      totalAmountInUSD: usdcUsd,
    });
    await ctx.db.patch(wallet._id, {
      arbitrumUsdcBalanceRaw: usdcRaw.toString(), arbitrumUsdcBalance: usdc,
      arbitrumEthBalanceRaw: ethRaw.toString(), arbitrumEthBalance: eth,
      arbitrumBalanceBlock: args.blockNumber, arbitrumBalanceObservedAt: args.observedAt,
      arbitrumTokenRegistryVersion: MOBILE_FUNDING_REGISTRY_VERSION,
      unifiedBalanceUsd: usdcUsd, assetsJson, lastRefreshedAt: args.observedAt,
      updatedAt: args.observedAt,
    });

    for (const entry of [
      { asset: "USDC" as const, current: usdcRaw, previous: previousUsdc, balance: usdc, decimals: 6 },
      { asset: "ETH" as const, current: ethRaw, previous: previousEth, balance: eth, decimals: 18 },
    ]) {
      if (entry.current <= entry.previous || !wallet.strategyAccountId) continue;
      const discovered = previousBlock === undefined;
      const amount = decimalFromRaw((entry.current - entry.previous).toString(), entry.decimals);
      await ctx.db.insert("auditEvents", {
        strategyAccountId: wallet.strategyAccountId, userId: user._id, actor: "system",
        kind: discovered ? "wallet.balance.discovered" : "wallet.balance.increased",
        summary: discovered ? `Existing ${entry.asset} balance detected` : `${entry.asset} added to your wallet`,
        detail: eventDetail(entry.asset, amount, entry.balance, args.blockNumber),
        refTable: "accountWallets", refId: String(wallet._id), createdAt: args.observedAt,
      });
    }
    return snapshot({ ...wallet,
      arbitrumUsdcBalanceRaw: usdcRaw.toString(), arbitrumUsdcBalance: usdc,
      arbitrumEthBalanceRaw: ethRaw.toString(), arbitrumEthBalance: eth,
      arbitrumBalanceBlock: args.blockNumber, arbitrumBalanceObservedAt: args.observedAt,
    });
  },
});
