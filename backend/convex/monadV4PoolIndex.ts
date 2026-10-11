import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMonadOperator } from "./monadHelpers";

const address = (value: string) => /^0x[a-f0-9]{40}$/.test(value);
const poolId = (value: string) => /^0x[a-f0-9]{64}$/.test(value);

export const getIndexSnapshot = query({
  args: {},
  handler: async (ctx) => {
    await requireMonadOperator(ctx);
    const [state, pools] = await Promise.all([
      ctx.db.query("monadV4PoolIndexState").withIndex("by_key", (q: any) => q.eq("key", "poolmanager-initialize" )).first(),
      ctx.db.query("monadV4Pools").take(2000),
    ]);
    return { state: state ?? null, pools };
  },
});

export const persistIndexBatch = mutation({
  args: {
    rows: v.array(v.object({ poolId: v.string(), currency0: v.string(), currency1: v.string(), fee: v.number(),
      tickSpacing: v.number(), hooks: v.string(), initializedBlock: v.number() })),
    scannedThrough: v.number(), latestBlock: v.number(), commitCursor: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    if (!Number.isSafeInteger(args.scannedThrough) || !Number.isSafeInteger(args.latestBlock)
        || args.scannedThrough < 0 || args.latestBlock < args.scannedThrough || args.rows.length > 500) {
      throw new Error("Monad v4 pool index cursor is invalid.");
    }
    for (const row of args.rows) {
      if (!poolId(row.poolId) || !address(row.currency0) || !address(row.currency1) || !address(row.hooks)
          || row.currency0 >= row.currency1 || !Number.isSafeInteger(row.fee) || row.fee < 0 || row.fee > 0xffffff
          || !Number.isSafeInteger(row.tickSpacing) || row.tickSpacing <= 0 || row.tickSpacing > 0x7fffff
          || !Number.isSafeInteger(row.initializedBlock) || row.initializedBlock < 0
          || row.initializedBlock > args.scannedThrough) throw new Error("Monad v4 pool event is invalid.");
      const existing = await ctx.db.query("monadV4Pools")
        .withIndex("by_poolId", (q: any) => q.eq("poolId", row.poolId)).first();
      const value = { ...row, observedAt: Date.now() };
      if (existing) await ctx.db.patch(existing._id, value);
      else await ctx.db.insert("monadV4Pools", value);
    }
    if (args.commitCursor === false) return { scannedThrough: null, indexed: args.rows.length };
    const prior = await ctx.db.query("monadV4PoolIndexState")
      .withIndex("by_key", (q: any) => q.eq("key", "poolmanager-initialize")).first();
    if (prior && args.scannedThrough < prior.scannedThrough) throw new Error("Monad v4 pool index cursor cannot move backward.");
    const state = { key: "poolmanager-initialize", scannedThrough: args.scannedThrough,
      latestBlock: args.latestBlock, updatedAt: Date.now() };
    if (prior) await ctx.db.patch(prior._id, state);
    else await ctx.db.insert("monadV4PoolIndexState", state);
    return { scannedThrough: args.scannedThrough, indexed: args.rows.length };
  },
});

export const setPoolVerification = mutation({
  args: { poolId: v.string(), verified: v.boolean(), evidence: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireMonadOperator(ctx);
    const evidence = args.evidence.trim();
    if (!poolId(args.poolId) || evidence.length < 8 || evidence.length > 1000) {
      throw new Error("PoolId and review evidence are required.");
    }
    const row = await ctx.db.query("monadV4Pools")
      .withIndex("by_poolId", (q: any) => q.eq("poolId", args.poolId)).first();
    if (!row) throw new Error("PoolId is not present in the Monad v4 Initialize index.");
    const patch = { verified: args.verified, verificationEvidence: evidence,
      verifiedBy: String(identity.subject), verifiedAt: Date.now() };
    await ctx.db.patch(row._id, patch);
    return { poolId: row.poolId, ...patch };
  },
});
