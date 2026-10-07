import { PERP_MIN_TRADE_MARGIN } from "./perpTypedData.js";

export type PerpPriceSample = { marketIndex: number; priceUsdcPerTokenWad: string; observedAt: number; blockNumber: number };
export type PerpPosition = { isOpen: boolean; isLong: boolean; marketIndex: number; leverage: number;
  marginUsdc: string; sizeWad: string; entryPriceWad: string; fundingAccruedUsdc: string;
  takeProfitWad: string; stopLossWad: string; openedAt: number; lastFundingAt: number };
export type PerpDecision = { action: string; reasonCode: string; params?: Record<string, unknown>;
  scenarioId?: string; scenarioStep?: number };
export type PerpDecisionContext = { now: number; prices: PerpPriceSample[]; histories: PerpPriceSample[][];
  position: PerpPosition | null; pendingOrder: Record<string, any> | null; availableUsdcUnits: string;
  fundingAmountUnits: string; expiresAt: number };
export interface PerpDecisionProvider { id: string; version: string; decide(context: PerpDecisionContext): PerpDecision; }

const percent = (price: bigint, bps: bigint) => price * bps / 10_000n;

export const defaultPerpDecisionProvider: PerpDecisionProvider = {
  id: "pool-momentum-v1", version: "1.0.0",
  decide(context) {
    if (context.now >= context.expiresAt) return { action: "settle_expired", reasonCode: "run_expired" };
    if (context.pendingOrder) return { action: "hold", reasonCode: "limit_order_pending" };
    if (context.position?.isOpen) {
      const position = context.position; const current = BigInt(context.prices[position.marketIndex]?.priceUsdcPerTokenWad ?? "0");
      if (current <= 0n) return { action: "hold", reasonCode: "price_unavailable" };
      const tp = BigInt(position.takeProfitWad); const sl = BigInt(position.stopLossWad);
      if (position.takeProfitWad !== "0" && (position.isLong ? current >= tp : current <= tp)) {
        return { action: "execute_trigger", reasonCode: "take_profit_reached", params: { marketIndex: position.marketIndex } };
      }
      if (position.stopLossWad !== "0" && (position.isLong ? current <= sl : current >= sl)) {
        return { action: "execute_trigger", reasonCode: "stop_loss_reached", params: { marketIndex: position.marketIndex } };
      }
      if (position.takeProfitWad === "0" || position.stopLossWad === "0") {
        const entry = BigInt(position.entryPriceWad);
        const takeProfitWad = (position.isLong ? entry + percent(entry, 200n) : entry - percent(entry, 200n)).toString();
        const stopLossWad = (position.isLong ? entry - percent(entry, 100n) : entry + percent(entry, 100n)).toString();
        return { action: "set_triggers", reasonCode: "default_position_protection", params: { takeProfitWad, stopLossWad } };
      }
      const heldMs = context.now - position.openedAt * 1000;
      const baseline = [...(context.histories[position.marketIndex] ?? [])].reverse()
        .find((item) => item.observedAt >= position.openedAt * 1000 && item.observedAt <= context.now - 60_000);
      if (heldMs >= 60_000 && baseline && absoluteBps(current, BigInt(baseline.priceUsdcPerTokenWad)) <= 50n) {
        return { action: "close_position", reasonCode: "flat_window_exit" };
      }
      if (context.now - position.lastFundingAt * 1000 >= 60_000) return { action: "accrue_funding", reasonCode: "bounded_funding_due" };
      return { action: "hold", reasonCode: "position_within_signed_triggers" };
    }
    const candidates = context.histories.map((rows, marketIndex) => {
      const now = context.prices[marketIndex];
      const prior = [...rows].reverse().find((row) => now && row.observedAt <= context.now - 60_000);
      if (!now || !prior || now.priceUsdcPerTokenWad === "0" || prior.priceUsdcPerTokenWad === "0") return null;
      const changeBps = signedBps(BigInt(now.priceUsdcPerTokenWad), BigInt(prior.priceUsdcPerTokenWad));
      return { marketIndex, changeBps, price: BigInt(now.priceUsdcPerTokenWad) };
    }).filter((item): item is NonNullable<typeof item> => item !== null && (item.changeBps >= 300n || item.changeBps <= -300n));
    candidates.sort((a, b) => Number(abs(b.changeBps) - abs(a.changeBps)));
    const strongest = candidates[0];
    const margin = BigInt(context.availableUsdcUnits) < BigInt(context.fundingAmountUnits)
      ? BigInt(context.availableUsdcUnits) : BigInt(context.fundingAmountUnits);
    if (!strongest || margin < PERP_MIN_TRADE_MARGIN) return { action: "hold", reasonCode: margin < PERP_MIN_TRADE_MARGIN
      ? "available_margin_below_trade_floor" : "no_qualified_one_minute_signal" };
    const isLong = strongest.changeBps > 0n; const price = strongest.price;
    return { action: "market_entry", reasonCode: "strongest_one_minute_market_move", params: {
      marketIndex: strongest.marketIndex, isLong, leverage: 2, marginUsdcUnits: margin.toString(),
      takeProfitWad: (isLong ? price + percent(price, 200n) : price - percent(price, 200n)).toString(),
      stopLossWad: (isLong ? price - percent(price, 100n) : price + percent(price, 100n)).toString(),
      expectedPriceWad: price.toString(), signalBps: strongest.changeBps.toString(),
    } };
  },
};

export function scriptedPerpDecision(scenario: { scenarioId: string; stepIndex: number; script: any[] }): PerpDecision {
  const step = scenario.script[scenario.stepIndex];
  if (!step) return { action: "hold", reasonCode: "scenario_complete", scenarioId: scenario.scenarioId, scenarioStep: scenario.stepIndex };
  return { action: String(step.action), reasonCode: `operator_scenario:${scenario.stepIndex}`,
    params: step.params && typeof step.params === "object" ? step.params : {},
    scenarioId: scenario.scenarioId, scenarioStep: scenario.stepIndex };
}

function signedBps(current: bigint, prior: bigint) { return (current - prior) * 10_000n / prior; }
function abs(value: bigint) { return value < 0n ? -value : value; }
function absoluteBps(current: bigint, prior: bigint) { return abs((current - prior) * 10_000n / prior); }
