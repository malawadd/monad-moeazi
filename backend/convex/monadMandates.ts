import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hashTypedData, keccak256, toBytes } from "viem";
import { appendMonadActivity, MONAD_CHAIN_ID, requireMeraViewer,
  requireMonadOperator, requireStoredMeraOwner } from "./monadHelpers";

function assertMandateShape(args: any, typedData: any, owner: string) {
  const message = typedData.message ?? {};
  const adapters = JSON.parse(args.allowedAdaptersJson) as string[];
  if (args.chainId !== MONAD_CHAIN_ID || args.ownerAddress.toLowerCase() !== owner
      || args.verifyingContract.toLowerCase() !== args.vaultAddress.toLowerCase()
      || args.expiresAt <= Math.floor(Date.now() / 1000)
      || args.expiresAt > Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
      || args.validAfter > Math.floor(Date.now() / 1000) || !/^[0-9]+$/.test(args.nonce)
      || BigInt(args.maxInputPerTrade) <= 0n || BigInt(args.maxTotalInput) < BigInt(args.maxInputPerTrade)
      || message.chainId?.toString() !== String(MONAD_CHAIN_ID)
      || String(message.vault).toLowerCase() !== args.vaultAddress.toLowerCase()
      || String(message.tokenIn).toLowerCase() !== args.tokenIn.toLowerCase()
      || String(message.tokenOut).toLowerCase() !== args.tokenOut.toLowerCase()
      || String(message.maxInputPerTrade) !== args.maxInputPerTrade
      || String(message.maxTotalInput) !== args.maxTotalInput
      || String(message.validAfter) !== String(args.validAfter)
      || String(message.expiresAt) !== String(args.expiresAt)
      || String(message.nonce) !== args.nonce
      || JSON.stringify(message.allowedAdapters?.map((value: string) => value.toLowerCase()))
        !== JSON.stringify(adapters.map(value => value.toLowerCase()))) {
    throw new Error("Monad mandate envelope is invalid or expired.");
  }
  return adapters;
}

export const getMandates = query({ args: {}, handler: async (ctx) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const rows = await ctx.db.query("monadMandates")
    .withIndex("by_userId_mandateId", (q: any) => q.eq("userId", user._id))
    .order("desc").take(50);
  return rows.filter(row => row.ownerAddress === owner)
    .map(({ signature: _signature, typedDataJson, ...row }) => ({ ...row, typedData: JSON.parse(typedDataJson) }));
} });

export const prepareMandate = mutation({
  args: { mandateId: v.string(), idempotencyKey: v.string(), subject: v.string(), ownerAddress: v.string(), chainId: v.number(),
    verifyingContract: v.string(), vaultAddress: v.string(), allowedAdaptersJson: v.string(),
    usdcAddress: v.string(), wmonAddress: v.string(), tokenIn: v.string(), tokenOut: v.string(),
    maxInputPerTrade: v.string(), maxTotalInput: v.string(), validAfter: v.number(), expiresAt: v.number(),
    nonce: v.string(), typedDataJson: v.string(), typedDataHash: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const { user, owner } = await requireStoredMeraOwner(ctx, args.subject, args.ownerAddress);
    const typedData = JSON.parse(args.typedDataJson);
    assertMandateShape(args, typedData, owner);
    if (hashTypedData(typedData as any).toLowerCase() !== args.typedDataHash.toLowerCase()) {
      throw new Error("Monad mandate typed-data hash does not match its terms.");
    }
    const prior = await ctx.db.query("monadMandates")
      .withIndex("by_userId_idempotencyKey", (q: any) => q.eq("userId", user._id).eq("idempotencyKey", args.idempotencyKey)).first();
    if (prior) {
      if (prior.typedDataHash !== args.typedDataHash.toLowerCase()) throw new Error("Mandate idempotency key was reused for different terms.");
      return { ...prior, typedData: JSON.parse(prior.typedDataJson) };
    }
    const nonceUsed = await ctx.db.query("monadMandates")
      .withIndex("by_owner_nonce", (q: any) => q.eq("ownerAddress", owner).eq("nonce", args.nonce)).first();
    if (nonceUsed) throw new Error("Monad mandate nonce was already used.");
    const now = Date.now();
    const id = await ctx.db.insert("monadMandates", { ...args,
      ownerAddress: owner, chainId: MONAD_CHAIN_ID, typedDataHash: args.typedDataHash.toLowerCase(),
      status: "prepared", subject: `mera:${owner}`, userId: user._id, createdAt: now, updatedAt: now });
    await appendMonadActivity(ctx, { userId: user._id, ownerAddress: owner,
      activityId: `mandate:${args.mandateId}:prepared`, mandateId: args.mandateId,
      kind: "mandate", status: "prepared", summary: "Managed vault mandate prepared" });
    return { ...await ctx.db.get(id), typedData };
  },
});

export const authorizeMandate = mutation({
  args: { mandateId: v.string(), subject: v.string(), ownerAddress: v.string(),
    signature: v.string(), typedDataHash: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const { user, owner } = await requireStoredMeraOwner(ctx, args.subject, args.ownerAddress);
    const row = await ctx.db.query("monadMandates")
      .withIndex("by_userId_mandateId", (q: any) => q.eq("userId", user._id).eq("mandateId", args.mandateId)).first();
    if (!row || row.ownerAddress !== owner) throw new Error("Monad mandate was not found.");
    if (row.expiresAt <= Math.floor(Date.now() / 1000) || row.status === "expired") throw new Error("Monad mandate expired.");
    const typedData = JSON.parse(row.typedDataJson);
    if (args.typedDataHash.toLowerCase() !== row.typedDataHash
        || hashTypedData(typedData as any).toLowerCase() !== row.typedDataHash) {
      throw new Error("Monad mandate typed-data hash does not match stored terms.");
    }
    const signatureHash = keccak256(toBytes(args.signature));
    if (row.signatureHash && row.signatureHash !== signatureHash) throw new Error("Monad mandate signature cannot be replaced.");
    if (row.status === "signed" || row.status === "active") return { mandateId: row.mandateId, ownerAddress: owner,
      chainId: MONAD_CHAIN_ID, status: row.status as "signed" | "active", expiresAt: row.expiresAt,
      typedDataHash: row.typedDataHash };
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "signed", signature: args.signature,
      signatureHash, authorizedAt: row.authorizedAt ?? now, updatedAt: now });
    const existing = await ctx.db.query("monadVaults")
      .withIndex("by_userId_mandateId", (q: any) => q.eq("userId", user._id).eq("mandateId", row.mandateId)).first();
    const vault = { userId: user._id, ownerAddress: owner, chainId: MONAD_CHAIN_ID,
      vaultAddress: row.vaultAddress, mandateId: row.mandateId,
      usdcAddress: row.usdcAddress, wmonAddress: row.wmonAddress, status: "pending" as const, updatedAt: now };
    if (existing) await ctx.db.patch(existing._id, { status: "pending", updatedAt: now });
    else await ctx.db.insert("monadVaults", { ...vault, createdAt: now });
    await appendMonadActivity(ctx, { userId: user._id, ownerAddress: owner,
      activityId: `mandate:${row.mandateId}:signed`, mandateId: row.mandateId,
      kind: "mandate", status: "signed", summary: "Managed vault mandate signed; on-chain authorization is still required" });
    return { mandateId: row.mandateId, ownerAddress: owner, chainId: MONAD_CHAIN_ID,
      status: "signed" as const, expiresAt: row.expiresAt, typedDataHash: row.typedDataHash };
  },
});

export const getOperatorMandate = query({
  args: { mandateId: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await ctx.db.query("monadMandates")
      .withIndex("by_mandateId", (q: any) => q.eq("mandateId", args.mandateId)).first();
    return row ? { ...row, typedData: JSON.parse(row.typedDataJson) } : null;
  },
});

export const getActiveOperatorMandates = query({ args: { vaultAddress: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const rows = await ctx.db.query("monadMandates")
    .withIndex("by_vaultAddress", (q: any) => q.eq("vaultAddress", args.vaultAddress))
    .order("desc").take(20);
  return rows.filter(row => row.status === "active" && row.expiresAt > Math.floor(Date.now() / 1000))
    .map(row => ({ mandateId: row.mandateId, ownerAddress: row.ownerAddress,
      vaultAddress: row.vaultAddress, tokenIn: row.tokenIn, tokenOut: row.tokenOut,
      maxInputPerTrade: row.maxInputPerTrade, maxTotalInput: row.maxTotalInput,
      expiresAt: row.expiresAt }));
} });
