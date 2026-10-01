import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { DEFAULT_TRADE_SETTINGS } from "../lib/trade/markets";
import {
  canonicalHyperliquidCoin,
  getLiveHyperliquidMarket,
  getLiveHyperliquidMarkets,
} from "../lib/trade/hyperliquidMarkets";
import { assertCanCancelTradeIntent, normalizeOptionalHours } from "../lib/trade/intents";
import { getPublicVenueSnapshots } from "../lib/trade/publicQuotes";
import { routeBestExecution, validateTradeSettings } from "../lib/trade/routing";
import type { BestExecutionQuote, PerpMarket } from "../lib/trade/types";
import {
  getViewerUser,
  insertTradeIntent,
  requireViewerUser,
  toTradeSettings,
} from "./tradeHelpers";

const sideValidator = v.union(v.literal("long"), v.literal("short"));
const venueValidator = v.union(
  v.literal("hyperliquid"),
  v.literal("lighter"),
  v.literal("orderly"),
  v.literal("gmx"),
  v.literal("ostium"),
);
const tradeIntentArgs = {
  marketId: v.string(),
  coin: v.optional(v.string()),
  assetIndex: v.optional(v.number()),
  side: sideValidator,
  marginUsd: v.number(),
  leverage: v.number(),
  expectedHoldHours: v.optional(v.number()),
  slippageCapBps: v.number(),
  selectedVenue: venueValidator,
  marketMetadataJson: v.optional(v.string()),
  quoteJson: v.string(),
};

export const getTradeDashboard = query({
  args: {},
  handler: async (ctx) => {
    const { identity, user } = await getViewerUser(ctx);
    if (!identity || !user) {
      return {
        signedIn: Boolean(identity),
        settings: DEFAULT_TRADE_SETTINGS,
        accountWallet: null,
        queuedIntents: [],
      };
    }

    const [settings, accountWallet, intents] = await Promise.all([
      ctx.db.query("tradeSettings").withIndex("by_userId", (q) => q.eq("userId", user._id)).first(),
      ctx.db.query("accountWallets").withIndex("by_userId", (q) => q.eq("userId", user._id)).first(),
      ctx.db.query("tradeIntents").withIndex("by_userId", (q) => q.eq("userId", user._id)).order("desc").take(12),
    ]);

    return {
      signedIn: true,
      settings: toTradeSettings(settings),
      accountWallet: accountWallet
        ? {
            id: accountWallet._id,
            ownerAddress: accountWallet.ownerAddress,
            evmUaAddress: accountWallet.evmUaAddress,
            unifiedBalanceUsd: accountWallet.unifiedBalanceUsd,
            assetsJson: accountWallet.assetsJson,
            lastRefreshedAt: accountWallet.lastRefreshedAt,
          }
        : null,
      queuedIntents: intents.map((intent) => ({
        id: intent._id,
        marketId: intent.marketId,
        coin: intent.coin ?? intent.marketId,
        assetIndex: intent.assetIndex,
        side: intent.side,
        status: intent.status,
        marginUsd: intent.marginUsd,
        leverage: intent.leverage,
        notionalUsd: intent.notionalUsd,
        selectedVenue: intent.selectedVenue ?? null,
        quoteJson: intent.quoteJson,
        quoteCreatedAt: intent.quoteCreatedAt,
        queuedAt: intent.queuedAt,
        updatedAt: intent.updatedAt,
      })),
    };
  },
});

export const getPublicTradeConfig = query({
  args: {},
  handler: async () => ({
    settings: DEFAULT_TRADE_SETTINGS,
  }),
});

export const getHyperliquidMarkets = action({
  args: {},
  handler: async () => ({
    markets: await getLiveHyperliquidMarkets(),
    settings: DEFAULT_TRADE_SETTINGS,
  }),
});

export const previewPerpRoute = action({
  args: {
    coin: v.optional(v.string()),
    marketId: v.optional(v.string()),
    side: sideValidator,
    marginUsd: v.number(),
    leverage: v.number(),
    expectedHoldHours: v.optional(v.number()),
    slippageCapBps: v.number(),
    marketMetadataJson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BestExecutionQuote> => {
    const coin = canonicalHyperliquidCoin(args.coin ?? args.marketId);
    const market = await getLiveHyperliquidMarket(coin).catch(() => parseRecentMarket(args.marketMetadataJson, coin));
    if (!market) throw new Error(`Hyperliquid does not list ${coin}.`);
    const input = {
      marketId: market.id,
      coin: market.id,
      side: args.side,
      marginUsd: args.marginUsd,
      leverage: args.leverage,
      holdTimeHours: normalizeOptionalHours(args.expectedHoldHours),
      slippageCapBps: args.slippageCapBps,
      now: Date.now(),
    };
    const snapshots = await getPublicVenueSnapshots(input, market);
    return routeBestExecution(input, snapshots, market);
  },
});

function parseRecentMarket(raw: string | undefined, coin: string): PerpMarket | null {
  if (!raw) return null;
  try {
    const market = JSON.parse(raw) as PerpMarket;
    const fresh = typeof market.fetchedAt === "number" && Date.now() - market.fetchedAt < 180_000;
    const listed = canonicalHyperliquidCoin(market.id) === coin && market.venues?.includes("hyperliquid");
    const precise = Number.isFinite(market.assetIndex) && Number.isFinite(market.szDecimals) && Number.isFinite(market.maxLeverage);
    return fresh && listed && precise && !market.isDelisted ? market : null;
  } catch {
    return null;
  }
}

export const setTradeSettings = mutation({
  args: {
    defaultMarketId: v.string(),
    defaultLeverage: v.number(),
    defaultMarginUsd: v.number(),
    slippageCapBps: v.number(),
    expectedHoldHours: v.optional(v.number()),
    requireConfirmation: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await requireViewerUser(ctx);
    const expectedHoldHours = normalizeOptionalHours(args.expectedHoldHours);
    validateTradeSettings({ ...args, expectedHoldHours });
    const now = Date.now();
    const existing = await ctx.db
      .query("tradeSettings")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();
    const patch = { ...args, expectedHoldHours: expectedHoldHours ?? undefined, updatedAt: now };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return await ctx.db.get(existing._id);
    }
    const settingsId = await ctx.db.insert("tradeSettings", {
      userId: user._id,
      ...patch,
      createdAt: now,
    });
    return await ctx.db.get(settingsId);
  },
});

export const recordTradeIntent = mutation({
  args: tradeIntentArgs,
  handler: async (ctx, args) => {
    return await insertTradeIntent(ctx, args);
  },
});

export const queueTradeIntent = mutation({
  args: tradeIntentArgs,
  handler: async (ctx, args) => await insertTradeIntent(ctx, args),
});

export const recordVenueFunding = mutation({
  args: {
    intentId: v.id("tradeIntents"),
    amountUsd: v.number(),
    particleTransactionId: v.optional(v.string()),
    detailsJson: v.optional(v.string()),
    confirmed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireViewerUser(ctx);
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.userId !== user._id) throw new Error("Trade intent not found.");
    const now = Date.now();
    await ctx.db.patch(args.intentId, {
      status: args.confirmed ? "funding_confirmed" : "funding_submitted",
      fundingAmountUsd: args.amountUsd,
      fundingTransactionId: args.particleTransactionId,
      fundingJson: args.detailsJson,
      updatedAt: now,
    });
    return await ctx.db.get(args.intentId);
  },
});

export const recordTradeExecution = mutation({
  args: {
    intentId: v.id("tradeIntents"),
    status: v.union(v.literal("order_submitting"), v.literal("open"), v.literal("failed"), v.literal("closed")),
    executionJson: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireViewerUser(ctx);
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.userId !== user._id) throw new Error("Trade intent not found.");
    await ctx.db.patch(args.intentId, {
      status: args.status,
      executionJson: args.executionJson,
      errorMessage: args.errorMessage,
      updatedAt: Date.now(),
    });
    return await ctx.db.get(args.intentId);
  },
});

export const cancelTradeIntent = mutation({
  args: {
    intentId: v.id("tradeIntents"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireViewerUser(ctx);
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.userId !== user._id) throw new Error("Trade intent not found.");
    assertCanCancelTradeIntent(intent.status as any);
    const now = Date.now();
    await ctx.db.patch(args.intentId, {
      status: "cancelled",
      cancelReason: args.reason,
      cancelledAt: now,
      updatedAt: now,
    });
    return await ctx.db.get(args.intentId);
  },
});
