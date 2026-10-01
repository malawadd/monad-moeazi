/* eslint-disable @typescript-eslint/no-explicit-any */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByAuthSubject } from "./model";

async function viewer(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Authentication is required.");
  const user = await getUserByAuthSubject(ctx, identity.subject);
  if (!user) throw new Error("Moeazi account is not provisioned.");
  return { identity, user };
}

export const createProof = mutation({
  args: {
    proofId: v.string(), ownerAddress: v.string(), chainId: v.number(),
    typedDataJson: v.string(), rootHash: v.string(), expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { identity, user } = await viewer(ctx);
    const owner = String(identity.walletAddress ?? "").toLowerCase();
    if (owner !== args.ownerAddress.toLowerCase()) throw new Error("Signing-proof owner does not match the session.");
    const now = Date.now();
    await ctx.db.insert("mobileSigningProofs", {
      userId: user._id, ...args, ownerAddress: owner, status: "prepared", createdAt: now, updatedAt: now,
    });
    return { proofId: args.proofId, status: "prepared" as const };
  },
});

export const getProof = query({
  args: { proofId: v.string() },
  handler: async (ctx, args) => {
    const { user } = await viewer(ctx);
    const proof = await ctx.db.query("mobileSigningProofs")
      .withIndex("by_userId_proofId", (q: any) => q.eq("userId", user._id).eq("proofId", args.proofId)).first();
    if (!proof) return null;
    return {
      proofId: proof.proofId, ownerAddress: proof.ownerAddress, chainId: proof.chainId,
      typedDataJson: proof.typedDataJson, rootHash: proof.rootHash,
      status: proof.status, expiresAt: proof.expiresAt,
    };
  },
});

export const claimProof = mutation({
  args: { proofId: v.string() },
  handler: async (ctx, args) => {
    const { identity, user } = await viewer(ctx);
    const proof = await ctx.db.query("mobileSigningProofs")
      .withIndex("by_userId_proofId", (q: any) => q.eq("userId", user._id).eq("proofId", args.proofId)).first();
    if (!proof) throw new Error("Signing proof was not found.");
    if (proof.status !== "prepared") throw new Error("Signing proof was already used.");
    if (proof.ownerAddress !== String(identity.walletAddress ?? "").toLowerCase()) {
      throw new Error("Signing-proof owner does not match the session.");
    }
    const now = Date.now();
    if (proof.expiresAt <= now) {
      await ctx.db.patch(proof._id, { status: "expired", updatedAt: now });
      throw new Error("Signing proof expired.");
    }
    await ctx.db.patch(proof._id, { status: "verifying", claimedAt: now, updatedAt: now });
    return {
      proofId: proof.proofId, ownerAddress: proof.ownerAddress, chainId: proof.chainId,
      typedDataJson: proof.typedDataJson, rootHash: proof.rootHash, expiresAt: proof.expiresAt,
    };
  },
});

export const completeProof = mutation({
  args: { proofId: v.string() },
  handler: async (ctx, args) => {
    const { identity, user } = await viewer(ctx);
    const proof = await ctx.db.query("mobileSigningProofs")
      .withIndex("by_userId_proofId", (q: any) => q.eq("userId", user._id).eq("proofId", args.proofId)).first();
    if (!proof) throw new Error("Signing proof was not found.");
    if (proof.status !== "verifying") throw new Error("Signing proof was not claimed for verification.");
    if (proof.ownerAddress !== String(identity.walletAddress ?? "").toLowerCase()) {
      throw new Error("Signing-proof owner does not match the session.");
    }
    const now = Date.now();
    if (proof.expiresAt <= now) {
      await ctx.db.patch(proof._id, { status: "expired", updatedAt: now });
      throw new Error("Signing proof expired.");
    }
    await ctx.db.patch(proof._id, { status: "verified", verifiedAt: now, updatedAt: now });
    return { proofId: proof.proofId, status: "verified" as const, ownerAddress: proof.ownerAddress };
  },
});
