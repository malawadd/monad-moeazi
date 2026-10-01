import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  canTransitionPaymentIntent,
  allowsEoaDirectDeposit,
  isActivePaymentLink,
  normalizeDepositPolicy,
  normalizePaymentSlug,
  PAYMENT_INTENT_STATUS,
} from "./helpers/paymentLinks";

function normalizeEvm(value: string) {
  return value.trim().toLowerCase();
}

function evmReceiveAddress(wallet: any) {
  return wallet?.evmDepositAddress ?? wallet?.evmUaAddress ?? null;
}

function assertPositiveAmount(amount: string) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }
}

async function getActiveLinkBySlug(ctx: { db: any }, rawSlug: string) {
  const slug = normalizePaymentSlug(rawSlug);
  const link = await ctx.db
    .query("paymentLinks")
    .withIndex("by_slug", (q: any) => q.eq("slug", slug))
    .first();
  return link && isActivePaymentLink(link.status) ? link : null;
}

async function getWalletForLink(ctx: { db: any }, link: any) {
  return await ctx.db
    .query("accountWallets")
    .withIndex("by_userId", (q: any) => q.eq("userId", link.userId))
    .first();
}

async function requirePaymentIntent(ctx: { db: any }, paymentIntentId: any, nextStatus: any) {
  const intent = await ctx.db.get(paymentIntentId);
  if (!intent) {
    throw new Error("Payment intent not found.");
  }
  if (!canTransitionPaymentIntent(intent.status, nextStatus)) {
    throw new Error(`Cannot move payment intent from ${intent.status} to ${nextStatus}.`);
  }
  return intent;
}

export const getPublicPaymentLink = query({
  args: {
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const link = await getActiveLinkBySlug(ctx, args.slug);
    if (!link) return null;

    const [strategyAccount, user, wallet] = await Promise.all([
      link.strategyAccountId ? (ctx.db.get(link.strategyAccountId) as Promise<any>) : Promise.resolve(null),
      ctx.db.get(link.userId) as Promise<any>,
      getWalletForLink(ctx, link),
    ]);

    return {
      paymentLinkId: link._id,
      slug: link.slug,
      status: link.status,
      depositPolicy: normalizeDepositPolicy(link.depositPolicy),
      eoaDirectAllowed: allowsEoaDirectDeposit(link.depositPolicy),
      strategyLabel: strategyAccount?.label ?? "Moeazi account",
      recipientName: user?.displayName ?? "Moeazi account",
      ownerAddress: wallet?.ownerAddress ?? null,
      evmUaAddress: evmReceiveAddress(wallet),
      evmSmartAccountAddress: wallet?.evmUaAddress ?? null,
      evmDepositAddress: evmReceiveAddress(wallet),
      solanaUaAddress: wallet?.solanaUaAddress ?? null,
      walletProvider: wallet?.walletProvider ?? "particle",
      accountMode: wallet?.accountMode ?? "smart_account",
      walletReady: Boolean(evmReceiveAddress(wallet)),
      lastRefreshedAt: wallet?.lastRefreshedAt ?? null,
      createdAt: link.createdAt,
    };
  },
});

export const createPaymentIntent = mutation({
  args: {
    slug: v.string(),
    paymentFlow: v.optional(v.union(v.literal("eoa_direct"), v.literal("payer_ua"))),
    payerAddress: v.string(),
    targetChainId: v.number(),
    targetTokenAddress: v.string(),
    targetTokenSymbol: v.string(),
    sourceChainId: v.optional(v.number()),
    sourceTokenAddress: v.optional(v.string()),
    sourceTokenSymbol: v.optional(v.string()),
    sourceTokenDecimals: v.optional(v.number()),
    sourceAmount: v.optional(v.string()),
    receiver: v.string(),
    receiverKind: v.union(v.literal("evm"), v.literal("solana")),
    settlementChainId: v.optional(v.number()),
    settlementTokenAddress: v.optional(v.string()),
    settlementTokenSymbol: v.optional(v.string()),
    settlementAmount: v.optional(v.string()),
    amount: v.string(),
  },
  handler: async (ctx, args) => {
    assertPositiveAmount(args.amount);
    const link = await getActiveLinkBySlug(ctx, args.slug);
    if (!link) {
      throw new Error("Payment link is not active.");
    }
    const paymentFlow = args.paymentFlow ?? "payer_ua";
    if (paymentFlow === "eoa_direct" && !allowsEoaDirectDeposit(link.depositPolicy)) {
      throw new Error("This payment link accepts Universal Account settlement only.");
    }

    const wallet = await getWalletForLink(ctx, link);
    if (!evmReceiveAddress(wallet)) {
      throw new Error("Recipient account wallet is not ready.");
    }

    const expectedReceiver =
      args.receiverKind === "evm" ? evmReceiveAddress(wallet) : wallet.solanaUaAddress;
    if (!expectedReceiver) {
      throw new Error(
        args.receiverKind === "solana"
          ? "Recipient Solana Universal Account address is missing."
          : "Recipient EVM Universal Account address is missing.",
      );
    }
    const receiverMatches =
      args.receiverKind === "evm"
        ? normalizeEvm(args.receiver) === normalizeEvm(expectedReceiver)
        : args.receiver.trim() === expectedReceiver.trim();
    if (!receiverMatches) {
      throw new Error("Payment receiver does not match the shared account wallet.");
    }

    const now = Date.now();
    const paymentIntentId = await ctx.db.insert("paymentIntents", {
      paymentLinkId: link._id,
      strategyAccountId: link.strategyAccountId,
      paymentFlow,
      payerAddress: normalizeEvm(args.payerAddress),
      targetChainId: args.targetChainId,
      targetTokenAddress: args.targetTokenAddress,
      targetTokenSymbol: args.targetTokenSymbol.toUpperCase(),
      sourceChainId: args.sourceChainId,
      sourceTokenAddress: args.sourceTokenAddress,
      sourceTokenSymbol: args.sourceTokenSymbol?.toUpperCase(),
      sourceTokenDecimals: args.sourceTokenDecimals,
      sourceAmount: args.sourceAmount,
      receiver: args.receiver,
      receiverKind: args.receiverKind,
      settlementChainId: args.settlementChainId,
      settlementTokenAddress: args.settlementTokenAddress,
      settlementTokenSymbol: args.settlementTokenSymbol?.toUpperCase(),
      settlementAmount: args.settlementAmount,
      amount: args.amount,
      status: PAYMENT_INTENT_STATUS.draft,
      particleTransactionId: undefined,
      txHash: undefined,
      errorMessage: undefined,
      detailsJson: undefined,
      createdAt: now,
      updatedAt: now,
      previewedAt: undefined,
      submittedAt: undefined,
      failedAt: undefined,
    });
    return await ctx.db.get(paymentIntentId);
  },
});

export const markPaymentIntentPreviewed = mutation({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    particleTransactionId: v.optional(v.string()),
    detailsJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePaymentIntent(ctx, args.paymentIntentId, PAYMENT_INTENT_STATUS.previewed);
    const now = Date.now();
    await ctx.db.patch(args.paymentIntentId, {
      status: PAYMENT_INTENT_STATUS.previewed,
      particleTransactionId: args.particleTransactionId,
      detailsJson: args.detailsJson,
      previewedAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(args.paymentIntentId);
  },
});

export const markPaymentIntentSubmitted = mutation({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    particleTransactionId: v.optional(v.string()),
    txHash: v.optional(v.string()),
    detailsJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePaymentIntent(ctx, args.paymentIntentId, PAYMENT_INTENT_STATUS.submitted);
    const now = Date.now();
    await ctx.db.patch(args.paymentIntentId, {
      status: PAYMENT_INTENT_STATUS.submitted,
      particleTransactionId: args.particleTransactionId,
      txHash: args.txHash,
      detailsJson: args.detailsJson,
      submittedAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(args.paymentIntentId);
  },
});

export const markPaymentIntentFailed = mutation({
  args: {
    paymentIntentId: v.id("paymentIntents"),
    errorMessage: v.string(),
    detailsJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePaymentIntent(ctx, args.paymentIntentId, PAYMENT_INTENT_STATUS.failed);
    const now = Date.now();
    await ctx.db.patch(args.paymentIntentId, {
      status: PAYMENT_INTENT_STATUS.failed,
      errorMessage: args.errorMessage,
      detailsJson: args.detailsJson,
      failedAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(args.paymentIntentId);
  },
});
