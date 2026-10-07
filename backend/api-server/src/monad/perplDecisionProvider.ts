import type { VenueAccountSnapshot, VenueAction, VenueMarket } from "./venueTypes.js";
import { perplMaxSlippageBps } from "./perplConfig.js";

export const PERPL_POLICY_ID = "perpl-trend-3-finalized-v1";
export type PerplDecision = { kind: "hold"; reasonCode: string; details?: Record<string, unknown> }
  | { kind: "order"; reasonCode: string; action: Omit<VenueAction, "accountId" | "requestId">; details?: Record<string, unknown> }
  | { kind: "settle"; reasonCode: string };
type PolicyInput = { now: number; expiresAt: number; run: any; account: VenueAccountSnapshot; markets: VenueMarket[];
  histories: Record<number, number[]>; forceExit?: boolean };

/** Versioned, deterministic policy: finalized 3-sample momentum entries with one-position exits. */
export function decidePerplRun(input: PolicyInput): PerplDecision {
  const { now, expiresAt, run, account, markets } = input;
  if (account.orders.length) return { kind: "hold", reasonCode: "pending_order_reconciliation" };
  if (account.positions.length > 1) return { kind: "hold", reasonCode: "position_count_exceeds_policy", details: { count: account.positions.length } };
  if (account.positions.length === 1) return decideExit(input, account.positions[0]);
  if (input.forceExit || now >= expiresAt) return { kind: "settle", reasonCode: input.forceExit ? "owner_stop_flat" : "run_expired_flat" };
  if (expiresAt - now < 90_000) return { kind: "hold", reasonCode: "entry_window_closing" };
  if (BigInt(account.balanceUnits) < 10_000_000n) return { kind: "hold", reasonCode: "available_collateral_below_trade_floor" };
  const allowed = new Set<number>(safeJsonNumbers(run.marketIdsJson));
  const candidates = markets.filter((market) => allowed.has(market.id) && market.isOpen && market.price && market.book
    && now - market.price.observedAt <= 30_000 && now - market.book.observedAt <= 30_000)
    .map((market) => ({ market, signal: momentum(input.histories[market.id] ?? []) }))
    .filter((item) => item.signal && Math.abs(item.signal.bps) >= 20)
    .sort((a, b) => Math.abs(b.signal!.bps) - Math.abs(a.signal!.bps));
  const selected = candidates[0];
  if (!selected) return { kind: "hold", reasonCode: "momentum_below_entry_threshold", details: { policy: PERPL_POLICY_ID } };
  const market = selected.market; const leverage = Math.max(1, Math.min(2, Number(run.maxLeverage), market.maxLeverage));
  const maxCollateral = BigInt(run.amountUnits) / 4n;
  const collateral = BigInt(account.balanceUnits) < maxCollateral ? BigInt(account.balanceUnits) : maxCollateral;
  const exposure = BigInt(run.maxPositionExposureUnits) < collateral * BigInt(leverage)
    ? BigInt(run.maxPositionExposureUnits) : collateral * BigInt(leverage);
  const price = selected.signal!.bps > 0 ? market.price!.ask : market.price!.bid;
  const size = exposure * (10n ** BigInt(market.priceDecimals + market.sizeDecimals))
    / (BigInt(price) * 1_000_000n);
  if (size <= 0n || size > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: "hold", reasonCode: "policy_size_rounds_to_zero" };
  return { kind: "order", reasonCode: "finalized_momentum_entry", details: { policy: PERPL_POLICY_ID,
    momentumBps: selected.signal!.bps, collateralCapUnits: collateral.toString(), exposureCapUnits: exposure.toString() },
    action: { kind: "market_entry", marketId: market.id, side: selected.signal!.bps > 0 ? "long" : "short",
      size: Number(size), leverage, maxCollateralUnits: collateral.toString(), maxExposureUnits: exposure.toString(),
      maxLeverage: Number(run.maxLeverage),
      allowedMarketIds: [...allowed], expiresAt, maxSlippageBps: Math.min(perplMaxSlippageBps(), market.maxMarketSlippageBps) } };
}

function decideExit(input: PolicyInput, position: any): PerplDecision {
  const market = input.markets.find((item) => item.id === Number(position.mkt));
  if (!market?.price || !market.book || input.now - market.price.observedAt > 30_000 || input.now - market.book.observedAt > 30_000) {
    return { kind: "hold", reasonCode: "exit_quote_unavailable", details: { marketId: position.mkt } };
  }
  const entry = BigInt(position.ep ?? 0); const short = Number(position.sd) === 2;
  const mark = BigInt(short ? market.price.ask : market.price.bid);
  if (!entry || !BigInt(position.s ?? 0)) return { kind: "hold", reasonCode: "position_fields_invalid" };
  const delta = short ? entry - mark : mark - entry;
  const bps = Number(delta * 10_000n / entry);
  const closeByTime = Boolean(input.forceExit) || input.expiresAt - input.now <= 90_000;
  if (bps < 150 && bps > -100 && !closeByTime) return { kind: "hold", reasonCode: "position_within_policy_band", details: { unrealizedBps: bps } };
  const size = Number(position.s);
  if (!Number.isSafeInteger(size) || size <= 0) return { kind: "hold", reasonCode: "position_size_invalid" };
  return { kind: "order", reasonCode: closeByTime ? "time_exit" : bps <= -100 ? "risk_exit" : "take_profit_exit",
    details: { unrealizedBps: bps }, action: { kind: "close_position", marketId: Number(position.mkt),
      side: Number(position.sd) === 2 ? "short" : "long", size, leverage: Math.max(1, Math.round(Number(position.lv ?? 100) / 100)),
      maxSlippageBps: Math.min(perplMaxSlippageBps(), market.maxMarketSlippageBps) } };
}

function momentum(values: number[]) {
  const samples = values.filter((value) => Number.isSafeInteger(value) && value > 0).slice(-3);
  if (samples.length < 3) return null;
  const first = BigInt(samples[0]); const last = BigInt(samples[2]);
  return first ? { bps: Number((last - first) * 10_000n / first), last: Number(last) } : null;
}

function safeJsonNumbers(value?: string): number[] {
  try { const parsed = JSON.parse(value ?? "[]"); return Array.isArray(parsed) ? parsed.filter(Number.isSafeInteger) : []; }
  catch { return []; }
}
