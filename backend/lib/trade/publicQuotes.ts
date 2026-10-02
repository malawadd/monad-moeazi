import { readHyperliquidRestSnapshot } from "./hyperliquidApi";
import { TRADE_VENUE_PRIORITY } from "./markets";
import type { PerpMarket, RouteInput, TradeVenueId, VenueSnapshot } from "./types";

export async function getPublicVenueSnapshots(input: RouteInput, market: PerpMarket) {
  const now = input.now ?? Date.now();
  const results = await Promise.allSettled(
    TRADE_VENUE_PRIORITY.filter((venue) => market.venues.includes(venue)).map((venue) =>
      readPublicSnapshot(venue, market, now),
    ),
  );

  return results
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter(Boolean) as VenueSnapshot[];
}

async function readPublicSnapshot(venue: TradeVenueId, market: PerpMarket, now: number) {
  if (venue === "hyperliquid") {
    return await readHyperliquidRestSnapshot(market, now);
  }
  return null;
}
