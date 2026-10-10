import { meraQuery } from "./convex.js";
import { monadProvider, finalizedBlockNumber } from "./provider.js";
import { buildSpotCandles, verifySpotSwapHistory } from "./spotTradeHistory.js";

/** Returns candle history derived only from finalized, verified pool observations and swaps. */
export async function spotMarketDetail(context: any, auth: any, market: any,
  venueId: string, marketId: string, parsed: { resolution: number; from: number; to: number }) {
  const history: any = await meraQuery(auth.token, "monadManual", "getMarketTrades", {
    venueId, marketId, limit: 100, includeSpotObservations: true,
  });
  const points = Array.isArray(history?.spotObservations) ? [...history.spotObservations] : [];
  let provider: any;
  try {
    const candidates = (history?.spotCandidates ?? []).filter((item: any) => item.venueId === venueId).slice(0, 20);
    if (candidates.length) {
      provider = await monadProvider();
      const checkpoint = await finalizedBlockNumber(provider);
      const checked = await Promise.allSettled(candidates.map((candidate: any) =>
        verifySpotSwapHistory(provider, auth.ownerAddress, candidate, checkpoint)));
      for (const item of checked) if (item.status === "fulfilled" && item.value) points.push({
        marketId: item.value.marketId, venueId: item.value.venueId, t: item.value.occurredAt,
        priceUnits: item.value.priceUnits, quoteUnits: item.value.quoteUnits, blockNumber: item.value.blockNumber,
        source: "verified_wallet_swap" });
    }
  } catch { /* persisted canonical pool observations remain useful while wallet RPC history is unavailable */ }
  finally { await provider?.destroy(); }
  const candles = buildSpotCandles(points.filter((point: any) => point.marketId === marketId),
    parsed.resolution, parsed.from, parsed.to);
  const available = candles.length > 0;
  return context.json({ market, candles, resolutionSeconds: parsed.resolution, candleTimeUnit: "milliseconds",
    candlesUnavailable: !available, unavailable: { candles: !available,
      candlesReason: available ? undefined : "verified_spot_history_unavailable" }, observedAt: Date.now() });
}
