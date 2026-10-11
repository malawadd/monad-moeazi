import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { MONAD_CHAIN_ID, requireMeraViewer, requireMonadOperator, requireStoredMeraOwner } from "./monadHelpers";

export const getQuote = query({
  args: { quoteId: v.string() },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const row = await ctx.db.query("monadQuotes")
      .withIndex("by_userId_quoteId", (q: any) => q.eq("userId", user._id).eq("quoteId", args.quoteId)).first();
    if (!row || row.ownerAddress !== owner || row.expiresAt <= Date.now()) return null;
    return row;
  },
});

export const getOperatorQuote = query({
  args: { quoteId: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await ctx.db.query("monadQuotes")
      .withIndex("by_quoteId", (q: any) => q.eq("quoteId", args.quoteId)).first();
    return row && row.expiresAt > Date.now() ? row : null;
  },
});

export const recordQuote = mutation({
  args: { subject: v.string(), ownerAddress: v.string(), quoteId: v.string(), accountScope: v.union(v.literal("wallet"), v.literal("vault")),
    venue: v.string(), tokenIn: v.string(), tokenOut: v.string(), poolAddress: v.optional(v.string()),
    poolId: v.optional(v.string()), poolKeyJson: v.optional(v.string()), marketId: v.optional(v.string()),
    inputDecimals: v.optional(v.number()), outputDecimals: v.optional(v.number()), amountInUnits: v.string(), amountOutUnits: v.string(),
    minimumAmountOutUnits: v.string(), slippageBps: v.number(), feeProvenance: v.string(), expiresAt: v.number(), gasJson: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const { user, owner } = await requireStoredMeraOwner(ctx, args.subject, args.ownerAddress);
    if (!/^0x[a-f0-9]{64}$/.test(args.quoteId) || args.expiresAt <= Date.now()
        || args.expiresAt > Date.now() + 2 * 60_000 || args.slippageBps < 1 || args.slippageBps > 500
        || (args.venue === "moeazi_mock_pools_testnet" && !/^0x[a-f0-9]{40}$/i.test(args.poolAddress ?? ""))
        || (args.venue !== "moeazi_mock_pools_testnet" && args.poolAddress !== undefined)
        || !/^\d+$/.test(args.amountInUnits) || !/^\d+$/.test(args.amountOutUnits)
        || !/^\d+$/.test(args.minimumAmountOutUnits) || BigInt(args.amountInUnits) <= 0n
        || BigInt(args.minimumAmountOutUnits) <= 0n || args.tokenIn.toLowerCase() === args.tokenOut.toLowerCase()) {
      throw new Error("Monad quote envelope is invalid or expired.");
    }
    const hasPoolId = args.poolId !== undefined;
    if (hasPoolId) {
      let key: any; let gas: any;
      try { key = JSON.parse(args.poolKeyJson ?? ""); } catch { key = null; }
      try { gas = JSON.parse(args.gasJson ?? ""); } catch { gas = null; }
      if (args.venue !== "uniswap_v4_testnet" || args.accountScope !== "wallet"
          || !/^0x[a-f0-9]{64}$/.test(args.poolId!) || args.poolAddress !== undefined
          || !/^v4_0x[a-f0-9]{64}$/.test(args.marketId ?? "") && args.marketId !== "WMON_USDC"
          || !key || !/^0x[a-f0-9]{40}$/i.test(key.currency0 ?? "") || !/^0x[a-f0-9]{40}$/i.test(key.currency1 ?? "")
          || !/^0x[a-f0-9]{40}$/i.test(key.hooks ?? "") || !Number.isSafeInteger(key.fee) || key.fee < 0 || key.fee > 0xffffff
          || !Number.isSafeInteger(key.tickSpacing) || key.tickSpacing <= 0 || key.tickSpacing > 0x7fffff
          || !Number.isSafeInteger(args.inputDecimals) || args.inputDecimals! < 0 || args.inputDecimals! > 36
          || !Number.isSafeInteger(args.outputDecimals) || args.outputDecimals! < 0 || args.outputDecimals! > 36
          || ![key.currency0.toLowerCase(), key.currency1.toLowerCase()].includes(args.tokenIn.toLowerCase())
          || ![key.currency0.toLowerCase(), key.currency1.toLowerCase()].includes(args.tokenOut.toLowerCase())
          || !gas || !/^\d+$/.test(gas.gasLimit ?? "") || BigInt(gas.gasLimit) <= 0n || BigInt(gas.gasLimit) > 3_000_000n
          || !/^\d+$/.test(gas.maxFeePerGas ?? "") || !/^\d+$/.test(gas.maxPriorityFeePerGas ?? "")
          || !/^\d+$/.test(gas.maxCostWei ?? "") || BigInt(gas.maxFeePerGas) <= 0n
          || BigInt(gas.maxPriorityFeePerGas) <= 0n || BigInt(gas.maxPriorityFeePerGas) > BigInt(gas.maxFeePerGas)
          || BigInt(gas.maxCostWei) !== BigInt(gas.gasLimit) * BigInt(gas.maxFeePerGas)) {
        throw new Error("PoolId-bound Monad v4 quote is invalid.");
      }
    } else if (args.poolKeyJson !== undefined || args.marketId !== undefined || args.inputDecimals !== undefined || args.outputDecimals !== undefined) {
      throw new Error("Monad v4 quote fields require a PoolId.");
    }
    const existing = await ctx.db.query("monadQuotes")
      .withIndex("by_userId_quoteId", (q: any) => q.eq("userId", user._id).eq("quoteId", args.quoteId)).first();
    if (existing) return existing;
    const recent = await ctx.db.query("monadQuotes")
      .withIndex("by_owner_createdAt", (q: any) => q.eq("ownerAddress", owner)).order("desc").take(150);
    for (const row of recent) if (row.expiresAt <= Date.now()) await ctx.db.delete(row._id);
    const id = await ctx.db.insert("monadQuotes", { ...args, userId: user._id, subject: `mera:${owner}`,
      ownerAddress: owner, chainId: MONAD_CHAIN_ID, createdAt: Date.now() });
    return await ctx.db.get(id);
  },
});
