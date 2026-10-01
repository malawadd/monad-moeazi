import { getUserByAuthSubject } from "./model";
import { DEFAULT_TRADE_SETTINGS } from "../lib/trade/markets";
import { normalizeOptionalHours } from "../lib/trade/intents";
import type { BestExecutionQuote, TradeSettings } from "../lib/trade/types";

export async function getViewerUser(ctx: { auth: any; db: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return { identity: null, user: null };
  return { identity, user: await getUserByAuthSubject(ctx, identity.subject) };
}

export async function requireViewerUser(ctx: { auth: any; db: any }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  const now = Date.now();
  const existing = await getUserByAuthSubject(ctx, identity.subject);
  if (existing) return existing;

  const userId = await ctx.db.insert("users", {
    authSubject: identity.subject,
    authProvider: String(identity.authProvider ?? "particle"),
    walletAddress:
      typeof identity.walletAddress === "string"
        ? identity.walletAddress
        : typeof identity.particleWalletAddress === "string"
          ? identity.particleWalletAddress
          : undefined,
    particleWalletAddress:
      typeof identity.particleWalletAddress === "string"
        ? identity.particleWalletAddress
        : typeof identity.walletAddress === "string"
          ? identity.walletAddress
          : undefined,
    particleUuid: typeof identity.particleUuid === "string" ? identity.particleUuid : undefined,
    email: typeof identity.email === "string" ? identity.email : undefined,
    displayName:
      identity.name ??
      [identity.givenName, identity.familyName].filter(Boolean).join(" ") ??
      identity.nickname,
    createdAt: now,
    updatedAt: now,
  });
  const user = await ctx.db.get(userId);
  if (!user) throw new Error("Could not create user.");
  return user;
}

export function toTradeSettings(row: any): TradeSettings {
  if (!row) return DEFAULT_TRADE_SETTINGS;
  return {
    defaultMarketId: row.defaultMarketId,
    defaultLeverage: row.defaultLeverage,
    defaultMarginUsd: row.defaultMarginUsd,
    slippageCapBps: row.slippageCapBps,
    expectedHoldHours: row.expectedHoldHours ?? null,
    requireConfirmation: row.requireConfirmation,
  };
}

export async function insertTradeIntent(ctx: any, args: {
  marketId: string;
  coin?: string;
  assetIndex?: number;
  side: "long" | "short";
  marginUsd: number;
  leverage: number;
  expectedHoldHours?: number;
  slippageCapBps: number;
  selectedVenue: "hyperliquid" | "lighter" | "orderly" | "gmx" | "ostium";
  marketMetadataJson?: string;
  quoteJson: string;
}) {
  const user = await requireViewerUser(ctx);
  const parsed = JSON.parse(args.quoteJson) as BestExecutionQuote;
  if (parsed.winningVenue !== args.selectedVenue) {
    throw new Error("Only the current best-execution venue can be recorded.");
  }
  const accountWallet = await ctx.db
    .query("accountWallets")
    .withIndex("by_userId", (q: any) => q.eq("userId", user._id))
    .first();
  const expectedHoldHours = normalizeOptionalHours(args.expectedHoldHours);
  const now = Date.now();
  const intentId = await ctx.db.insert("tradeIntents", {
    userId: user._id,
    accountWalletId: accountWallet?._id,
    marketId: args.marketId,
    coin: args.coin ?? parsed.market.baseSymbol ?? args.marketId,
    assetIndex: args.assetIndex ?? parsed.market.assetIndex,
    side: args.side,
    status: "quoted",
    marginUsd: args.marginUsd,
    leverage: args.leverage,
    notionalUsd: Number((args.marginUsd * args.leverage).toFixed(2)),
    slippageCapBps: args.slippageCapBps,
    expectedHoldHours: expectedHoldHours ?? undefined,
    selectedVenue: args.selectedVenue,
    benchmarkVenue: parsed.benchmarkVenue ?? undefined,
    marketMetadataJson: args.marketMetadataJson ?? JSON.stringify(parsed.market),
    quoteJson: args.quoteJson,
    quoteCreatedAt: parsed.createdAt,
    queuedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(intentId);
}
