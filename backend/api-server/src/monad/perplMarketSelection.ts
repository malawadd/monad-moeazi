import { MonadApiError } from "./config.js";
import type { VenueMarket } from "./venueTypes.js";

// The deployed strategy vault accepts at most 16 signed market IDs.
export function allOpenPerplMarketIds(markets: VenueMarket[]): number[] {
  const ids = markets.filter((market) => market.isOpen).map((market) => market.id);
  if (!ids.length) throw new MonadApiError("Perpl has no currently open markets for enrollment.", 503, "perpl_markets_unavailable");
  if (ids.length > 16) throw new MonadApiError(
    "Perpl has more open markets than the deployed strategy vault can authorize; enrollment is blocked instead of silently omitting markets.",
    503, "perpl_market_mandate_capacity");
  return ids;
}
