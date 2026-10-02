import type { PerpMarket, TradeSettings, TradeVenueId, VenueCapabilities } from "./types";

export const TRADE_VENUE_PRIORITY: TradeVenueId[] = [
  "hyperliquid",
  "lighter",
  "orderly",
  "gmx",
  "ostium",
];

export const VENUE_CAPABILITIES: Record<TradeVenueId, VenueCapabilities> = {
  hyperliquid: {
    venue: "hyperliquid",
    label: "Hyperliquid",
    kind: "clob",
    maxLeverage: 50,
    minNotionalUsd: 10,
    takerFeeBps: 4.5,
    makerFeeBps: 1.5,
    transferCostUsd: 1.2,
  },
  lighter: {
    venue: "lighter",
    label: "Lighter",
    kind: "clob",
    maxLeverage: 100,
    minNotionalUsd: 5,
    takerFeeBps: 0,
    makerFeeBps: 0,
    transferCostUsd: 1.5,
  },
  orderly: {
    venue: "orderly",
    label: "Orderly",
    kind: "clob",
    maxLeverage: 50,
    minNotionalUsd: 10,
    takerFeeBps: 6,
    makerFeeBps: 2,
    transferCostUsd: 1.7,
  },
  gmx: {
    venue: "gmx",
    label: "GMX",
    kind: "onchain",
    maxLeverage: 100,
    minNotionalUsd: 10,
    takerFeeBps: 6,
    makerFeeBps: 6,
    transferCostUsd: 2.2,
  },
  ostium: {
    venue: "ostium",
    label: "Ostium",
    kind: "onchain",
    maxLeverage: 200,
    minNotionalUsd: 5,
    takerFeeBps: 8,
    makerFeeBps: 8,
    transferCostUsd: 2.6,
  },
};

export const PERP_MARKETS: PerpMarket[] = [
  market("BTC-PERP", "BTC Perp", "BTC", "crypto", 2, 100, [
    "hyperliquid",
    "lighter",
    "orderly",
    "gmx",
    "ostium",
  ]),
  market("ETH-PERP", "ETH Perp", "ETH", "crypto", 2, 100, [
    "hyperliquid",
    "lighter",
    "orderly",
    "gmx",
    "ostium",
  ]),
  market("SOL-PERP", "SOL Perp", "SOL", "crypto", 3, 75, [
    "hyperliquid",
    "lighter",
    "orderly",
    "gmx",
    "ostium",
  ]),
  market("LINK-PERP", "LINK Perp", "LINK", "crypto", 4, 50, [
    "hyperliquid",
    "lighter",
    "orderly",
    "gmx",
    "ostium",
  ]),
  market("XAU/USD", "Gold", "XAU", "rwa", 2, 200, ["ostium", "gmx"]),
  market("USOIL/USD", "US Oil", "USOIL", "rwa", 3, 100, ["ostium"]),
  market("EUR/USD", "Euro FX", "EUR", "rwa", 5, 200, ["ostium"]),
  market("US100", "Nasdaq 100", "US100", "rwa", 2, 100, ["ostium"]),
];

export const DEFAULT_TRADE_SETTINGS: TradeSettings = {
  defaultMarketId: "BTC",
  defaultLeverage: 5,
  defaultMarginUsd: 100,
  slippageCapBps: 75,
  expectedHoldHours: null,
  requireConfirmation: true,
};

function market(
  id: string,
  label: string,
  baseSymbol: string,
  category: "crypto" | "rwa",
  pricePrecision: number,
  maxLeverage: number,
  venues: TradeVenueId[],
): PerpMarket {
  return {
    id,
    label,
    baseSymbol,
    quoteSymbol: "USDC",
    category,
    pricePrecision,
    maxLeverage,
    venues,
  };
}

export function getPerpMarket(marketId: string) {
  return PERP_MARKETS.find((marketItem) => marketItem.id === marketId) ?? null;
}
