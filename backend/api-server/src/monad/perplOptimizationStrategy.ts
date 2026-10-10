import type { VenueAccountSnapshot, VenueAction, VenueMarket } from "./venueTypes.js";
import { PERPL_OPTIMIZER_POLICY as policy, type PerplOptimizerParams } from "./perplOptimizerConfig.js";
import { perplMaxSlippageBps } from "./perplConfig.js";

export type PerplPriceObservation = { observedAt: number; blockNumber: number; close: number };
type Input = { now: number; expiresAt: number; run: any; account: VenueAccountSnapshot; markets: VenueMarket[];
  histories: Record<number, PerplPriceObservation[]>; params: PerplOptimizerParams; forceExit?: boolean;
  optimizerStatus?: string; activeCycle?: Record<string, any> | null; policyVersion?: string };
export type OptimizerDecision = { kind: "hold"; reasonCode: string; details?: Record<string, unknown> }
  | { kind: "order"; reasonCode: string; action: Omit<VenueAction, "accountId" | "requestId">; details: Record<string, unknown> }
  | { kind: "settle"; reasonCode: string };

export function decidePerplOptimizer(input: Input): OptimizerDecision {
  const { account, now, expiresAt } = input;
  const policyVersion = input.policyVersion ?? "perpl-deterministic-v2";
  if (account.orders.length) return { kind: "hold", reasonCode: "pending_order_reconciliation" };
  if (account.positions.length > 1) return { kind: "hold", reasonCode: "position_count_exceeds_policy" };
  if (account.positions.length === 1) return exitDecision(input, account.positions[0]);
  if (input.forceExit || now >= expiresAt) return { kind: "settle", reasonCode: input.forceExit ? "owner_stop_or_expiry_flat" : "run_expired_flat" };
  if (input.optimizerStatus && input.optimizerStatus !== "running") return { kind: "hold", reasonCode: "optimizer_target_or_cycle_cap_reached" };
  if (expiresAt - now < 90_000) return { kind: "hold", reasonCode: "entry_window_closing" };
  if (BigInt(account.balanceUnits) <= 0n) return { kind: "hold", reasonCode: "account_balance_unavailable" };
  const allowed = new Set<number>(safeIds(input.run.marketIdsJson));
  const candidates = input.markets.filter((market) => allowed.has(market.id))
    .map((market) => evaluateCandidate(market, input.histories[market.id] ?? [], input))
    .sort((a, b) => (b.netMoveBps ?? -Infinity) - (a.netMoveBps ?? -Infinity));
  const chosen = candidates.find((candidate) => candidate.accepted);
  if (!chosen) return { kind: "hold", reasonCode: "no_market_passed_optimizer_filters",
    details: { policyVersion, rejectedMarkets: candidates.map(rejectionSummary) } };
  const leverage = chosen.leverage!; const notional = chosen.notionalUnits!; const margin = ceilDiv(notional, BigInt(leverage));
  const market = chosen.market; const sign = chosen.signal!.momentum5mBps > 0 ? "long" : "short";
  const price = sign === "long" ? market.price!.ask : market.price!.bid;
  const size = notional * 10n ** BigInt(market.priceDecimals + market.sizeDecimals) / (BigInt(price) * 1_000_000n);
  if (size <= 0n || size > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: "hold", reasonCode: "policy_size_rounds_to_zero" };
  const action = { kind: "market_entry", marketId: market.id, side: sign, size: Number(size), leverage,
    maxCollateralUnits: margin.toString(), maxExposureUnits: notional.toString(), maxLeverage: leverage,
    allowedMarketIds: [...allowed], expiresAt, maxSlippageBps: Math.min(perplMaxSlippageBps(), market.maxMarketSlippageBps) } as Omit<VenueAction, "accountId" | "requestId">;
  return { kind: "order", reasonCode: "optimizer_momentum_entry", action,
    details: { policyVersion, marketId: market.id, symbol: market.symbol,
      direction: sign, fiveMinuteMoveBps: chosen.signal!.momentum5mBps, fifteenMinuteMoveBps: chosen.signal!.momentum15mBps,
      estimatedRoundTripCostBps: chosen.costBps, estimatedNetMoveBps: chosen.netMoveBps,
      estimatedEntryImpactBps: chosen.entryImpactBps, estimatedExitImpactBps: chosen.exitImpactBps,
      fundingEstimateBps: chosen.fundingBps, volatilityBps: chosen.signal!.volatilityBps, spreadBps: chosen.spreadBps,
      marginUnits: margin.toString(), notionalUnits: notional.toString(), leverage,
      size: size.toString(), depthConsumptionBps: chosen.depthBps, observations: chosen.signal!.observations,
      rejectedMarkets: candidates.filter((item) => item !== chosen).map(rejectionSummary), params: { ...input.params } } };
}

function evaluateCandidate(market: VenueMarket, history: PerplPriceObservation[], input: Input): any {
  const base = { market, accepted: false, reason: "insufficient_observations" };
  if (!market.isOpen || !market.price || !market.book) return { ...base, reason: "market_or_book_unavailable" };
  if (input.now - market.price.observedAt > policy.staleMarketMs || input.now - market.book.observedAt > policy.staleMarketMs) return { ...base, reason: "stale_market_or_book" };
  if (!Number.isSafeInteger(market.fundingRateMicros) || !Number.isSafeInteger(market.fundingIntervalSeconds)
    || (market.fundingIntervalSeconds ?? 0) <= 0 || market.fundingObservedAt !== undefined
      && input.now - market.fundingObservedAt > Math.max(policy.staleMarketMs, market.fundingIntervalSeconds! * 1_000)) {
    return { ...base, reason: "funding_estimate_unavailable" };
  }
  const signalResult = makeSignal(history, input.now);
  if (!signalResult.signal) return { ...base, reason: signalResult.reason };
  const signal = signalResult.signal;
  if (Math.abs(signal.momentum5mBps) < input.params.momentumThresholdBps) return { ...base, signal, reason: "five_minute_threshold" };
  if (Math.sign(signal.momentum5mBps) !== Math.sign(signal.momentum15mBps)) return { ...base, signal, reason: "fifteen_minute_trend_disagrees" };
  const spreadBps = Math.round((market.price.ask - market.price.bid) * 10_000 / market.price.mid);
  if (spreadBps < 0 || !Number.isFinite(spreadBps)) return { ...base, signal, reason: "invalid_spread" };
  const side = signal.momentum5mBps > 0 ? "long" : "short";
  const entryLevels = side === "long" ? market.book.asks : market.book.bids;
  const exitLevels = side === "long" ? market.book.bids : market.book.asks;
  if (!validLevels(entryLevels) || !validLevels(exitLevels)) return { ...base, signal, reason: "insufficient_book_depth" };
  const conservatism = Math.max(10_000, input.params.executionConservatismBps);
  const depthBps = Math.floor(policy.maximumDepthConsumptionBps * 10_000 / conservatism);
  const highRisk = signal.volatilityBps >= policy.highVolatilityBps || spreadBps >= policy.highSpreadBps;
  const leverage = highRisk ? 1 : Math.max(1, Math.min(policy.maximumLeverage, Number(input.run.maxLeverage), market.maxLeverage));
  const entryDepth = depthNotional(entryLevels, market, depthBps);
  const exitDepth = depthNotional(exitLevels, market, depthBps);
  const signedExposure = BigInt(input.run.maxPositionExposureUnits ?? policy.maximumNotionalUnits);
  const nominalLimit = BigInt(policy.maximumNotionalUnits) * 10_000n / BigInt(conservatism);
  const availableMargin = minBig(BigInt(policy.maximumMarginUnits), BigInt(input.run.amountUnits), BigInt(input.account.balanceUnits));
  const notionalCap = minBig(nominalLimit, signedExposure, entryDepth, exitDepth, availableMargin * BigInt(leverage));
  if (notionalCap <= 0n) return { ...base, signal, spreadBps, reason: "depth_below_minimum" };
  const feesBps = Math.ceil(2 * market.takerFeeMicros / 100);
  const fundingBps = estimateFundingBps(market);
  const depthBpsForCap = Math.min(policy.roundTripImpactCapBps, policy.roundTripImpactCapBps * 10_000 / conservatism);
  const fixedCostBps = spreadBps + feesBps + fundingBps;
  let adverseRiskBps = Math.max(input.params.momentumThresholdBps, signal.volatilityBps * 2, fixedCostBps + 20);
  let notional = minBig(notionalCap, BigInt(policy.plannedLossUnits) * 10_000n / BigInt(Math.ceil(adverseRiskBps)));
  if (notional < 10_000n) return { ...base, signal, spreadBps, costBps: fixedCostBps,
    netMoveBps: Math.abs(signal.momentum5mBps) - fixedCostBps, reason: "risk_budget_size_below_order_floor" };
  let entryImpact = impactAtNotional(entryLevels, market, notional, side === "long");
  let exitImpact = impactAtNotional(exitLevels, market, notional, side !== "long");
  if (entryImpact === null || exitImpact === null || entryImpact + exitImpact > depthBpsForCap) {
    return { ...base, signal, spreadBps, reason: "depth_impact_exceeds_cap", entryImpactBps: entryImpact, exitImpactBps: exitImpact };
  }
  let costBps = fixedCostBps + entryImpact + exitImpact;
  let netMoveBps = Math.abs(signal.momentum5mBps) - costBps;
  if (netMoveBps <= 0) return { ...base, signal, spreadBps, costBps, netMoveBps, reason: "estimated_cost_exceeds_momentum" };
  adverseRiskBps = Math.max(input.params.momentumThresholdBps, signal.volatilityBps * 2, costBps + 20);
  const riskSized = BigInt(policy.plannedLossUnits) * 10_000n / BigInt(Math.ceil(adverseRiskBps));
  if (riskSized < notional) {
    notional = riskSized;
    if (notional < 10_000n) return { ...base, signal, spreadBps, costBps,
      netMoveBps, reason: "risk_budget_size_below_order_floor" };
    entryImpact = impactAtNotional(entryLevels, market, notional, side === "long");
    exitImpact = impactAtNotional(exitLevels, market, notional, side !== "long");
    if (entryImpact === null || exitImpact === null || entryImpact + exitImpact > depthBpsForCap) {
      return { ...base, signal, spreadBps, reason: "depth_impact_exceeds_cap", entryImpactBps: entryImpact, exitImpactBps: exitImpact };
    }
    costBps = fixedCostBps + entryImpact + exitImpact; netMoveBps = Math.abs(signal.momentum5mBps) - costBps;
  }
  if (netMoveBps <= 0) return { ...base, signal, spreadBps, costBps, netMoveBps, reason: "estimated_cost_exceeds_momentum" };
  const margin = ceilDiv(notional, BigInt(leverage));
  if (margin > BigInt(policy.maximumMarginUnits) || margin > BigInt(input.run.amountUnits) || margin > BigInt(input.account.balanceUnits)) {
    return { ...base, signal, spreadBps, costBps, netMoveBps, reason: "margin_or_balance_cap" };
  }
  return { ...base, accepted: true, reason: "accepted", signal, spreadBps, feesBps, fundingBps,
    costBps, netMoveBps, entryImpactBps: entryImpact, exitImpactBps: exitImpact, notionalUnits: notional,
    leverage, depthBps };
}

function exitDecision(input: Input, rawPosition: unknown): OptimizerDecision {
  const position: any = rawPosition; const market = input.markets.find((item) => item.id === Number(position.mkt));
  if (!market?.price || !market.book || input.now - market.price.observedAt > policy.staleMarketMs
    || input.now - market.book.observedAt > policy.staleMarketMs) return { kind: "hold", reasonCode: "exit_quote_unavailable" };
  const short = Number(position.sd) === 2; const entry = BigInt(position.ep ?? 0); const size = BigInt(position.s ?? 0);
  if (entry <= 0n || size <= 0n) return { kind: "hold", reasonCode: "position_fields_invalid" };
  const closeLevels = short ? market.book.asks : market.book.bids;
  const executable = executablePriceAtSize(closeLevels, size, short);
  if (!executable) return { kind: "hold", reasonCode: "executable_close_depth_unavailable" };
  const exitPrice = executable.averagePrice;
  const quotePnl = (short ? entry - exitPrice : exitPrice - entry) * size * 1_000_000n
    / (10n ** BigInt(market.priceDecimals + market.sizeDecimals));
  const notional = size * entry * 1_000_000n / (10n ** BigInt(market.priceDecimals + market.sizeDecimals));
  const feeReserve = notional * BigInt(2 * market.takerFeeMicros) / 1_000_000n;
  const funding = BigInt(position.fundingPnlUnits ?? 0);
  const estimatedNet = quotePnl - feeReserve + funding;
  const openedAt = Number(input.activeCycle?.entryAt ?? input.activeCycle?.startedAt ?? input.now);
  const heldMs = Math.max(0, input.now - openedAt); const priorBest = BigInt(input.activeCycle?.bestEstimatedProfitUnits ?? "-999999999999999999");
  const materialGiveback = priorBest >= 20_000n && estimatedNet > 10_000n && estimatedNet <= priorBest - 10_000n;
  let reason: string | null = input.forceExit ? "owner_stop_or_expiry_exit"
    : input.activeCycle?.exitPending ? "finish_previous_partial_close" : null;
  if (!reason && estimatedNet <= -BigInt(policy.plannedLossUnits)) reason = "planned_loss_risk_exit";
  if (!reason && heldMs >= policy.maximumHoldMs) reason = "maximum_hold_exit";
  if (!reason && heldMs >= policy.minimumHoldMs && estimatedNet >= BigInt(policy.takeProfitUnits)) reason = "net_take_profit_exit";
  if (!reason && heldMs >= policy.minimumHoldMs && materialGiveback) reason = "positive_profit_giveback_exit";
  if (!reason) return { kind: "hold", reasonCode: "position_within_optimizer_exit_rules", details: {
    estimatedNetProfitUnits: estimatedNet.toString(), bestEstimatedProfitUnits: maxBig(priorBest, estimatedNet).toString(),
    heldMs, fundingPnlUnits: funding.toString(), closeImpactBps: executable.impactBps } };
  const closeImpactBps = executable.impactBps;
  if (!input.forceExit && !input.activeCycle?.exitPending) {
    const closeDepthSize = depthSize(closeLevels, policy.maximumDepthConsumptionBps);
    if (size > closeDepthSize || closeImpactBps > policy.roundTripImpactCapBps) return { kind: "hold",
      reasonCode: "normal_exit_depth_impact_over_cap", details: { estimatedNetProfitUnits: estimatedNet.toString(), closeImpactBps } };
  }
  const action = { kind: "close_position", marketId: market.id, side: short ? "short" : "long", size: Number(size),
    leverage: Math.max(1, Math.round(Number(input.activeCycle?.leverage ?? Number(position.lv ?? 100) / 100))),
    maxSlippageBps: Math.min(perplMaxSlippageBps(), market.maxMarketSlippageBps) } as Omit<VenueAction, "accountId" | "requestId">;
  return { kind: "order", reasonCode: reason, action, details: { estimatedNetProfitUnits: estimatedNet.toString(),
    bestEstimatedProfitUnits: maxBig(priorBest, estimatedNet).toString(), heldMs, closeImpactBps,
    fundingPnlUnits: funding.toString(), notionalUnits: notional.toString() } };
}

function makeSignal(history: PerplPriceObservation[], now: number) {
  const points = history.filter((item) => Number.isSafeInteger(item.observedAt) && item.observedAt <= now
      && Number.isSafeInteger(item.close) && item.close > 0).sort((a, b) => a.observedAt - b.observedAt);
  const latest = points.at(-1); const prior = points.at(-2); const beforePrior = points.at(-3);
  if (!latest || !prior || !beforePrior) return { reason: "insufficient_observations" };
  if (now - latest.observedAt > policy.staleMarketMs || !validMinuteStep(prior, latest)
    || !validMinuteStep(beforePrior, prior)) return { reason: "stale_or_irregular_observations" };
  if (Math.sign(latest.close - prior.close) === 0
    || Math.sign(latest.close - prior.close) !== Math.sign(prior.close - beforePrior.close)) {
    return { reason: "one_minute_confirmation_missing" };
  }
  const at = (age: number) => points.filter((item) => item.observedAt <= now - age)
    .sort((a, b) => Math.abs(a.observedAt - (now - age)) - Math.abs(b.observedAt - (now - age)))[0];
  const five = at(5 * 60_000); const fifteen = at(15 * 60_000);
  if (!five || !fifteen || now - five.observedAt > 5 * 60_000 + policy.observationTargetToleranceMs
    || now - five.observedAt < 5 * 60_000 - policy.observationTargetToleranceMs
    || now - fifteen.observedAt > 15 * 60_000 + policy.observationTargetToleranceMs
    || now - fifteen.observedAt < 15 * 60_000 - policy.observationTargetToleranceMs) {
    return { reason: "five_or_fifteen_minute_history_missing" };
  }
  const fiveBps = bps(latest.close, five.close); const fifteenBps = bps(latest.close, fifteen.close);
  if (Math.sign(fiveBps) !== Math.sign(latest.close - prior.close)) return { reason: "one_minute_confirmation_missing" };
  const window = points.filter((item) => item.observedAt >= now - 15 * 60_000);
  const volatilityBps = window.slice(1).reduce((maximum, item, index) => Math.max(maximum,
    Math.abs(bps(item.close, window[index].close))), 0);
  return { signal: { momentum5mBps: fiveBps, momentum15mBps: fifteenBps,
    volatilityBps, observations: { first15m: fifteen,
      first5m: five, prior1m: prior, latest1m: latest } } };
}
function depthNotional(levels: Array<{ price: number; size: number }>, market: VenueMarket, depthBps: number) {
  return levels.reduce((sum, level) => sum + toNotional(BigInt(Math.max(0, Math.floor(level.size * depthBps / 10_000))),
    BigInt(level.price), market), 0n);
}
function impactAtNotional(levels: Array<{ price: number; size: number }>, market: VenueMarket, target: bigint, adverse: boolean): number | null {
  let remaining = target; let weighted = 0n; let filled = 0n;
  for (const level of levels) {
    const capacity = toNotional(BigInt(Math.floor(level.size)), BigInt(level.price), market);
    const take = capacity < remaining ? capacity : remaining; if (take <= 0n) continue;
    weighted += BigInt(level.price) * take; filled += take; remaining -= take; if (remaining <= 0n) break;
  }
  if (remaining > 0n || filled <= 0n) return null;
  const avg = weighted / filled; const best = BigInt(levels[0].price);
  return Math.max(0, Number((adverse ? avg - best : best - avg) * 10_000n / best));
}
function executablePriceAtSize(levels: Array<{ price: number; size: number }>, size: bigint, buying: boolean) {
  let remaining = size; let weighted = 0n; let filled = 0n;
  for (const level of levels) {
    const capacity = BigInt(Math.floor(level.size)); const take = capacity < remaining ? capacity : remaining;
    if (take <= 0n) continue;
    weighted += BigInt(level.price) * take; filled += take; remaining -= take; if (remaining <= 0n) break;
  }
  if (remaining > 0n || filled <= 0n) return null;
  const averagePrice = weighted / filled; const best = BigInt(levels[0].price);
  return { averagePrice, impactBps: Math.max(0, Number((buying ? averagePrice - best : best - averagePrice) * 10_000n / best)) };
}
function depthSize(levels: Array<{ price: number; size: number }>, depthBps: number) {
  return levels.reduce((sum, level) => sum + BigInt(Math.floor(level.size * depthBps / 10_000)), 0n);
}
function toNotional(sizeUnits: bigint, price: bigint, market: VenueMarket) {
  return sizeUnits * price * 1_000_000n / (10n ** BigInt(market.priceDecimals + market.sizeDecimals));
}
function estimateFundingBps(market: VenueMarket) {
  const rate = Math.abs(Number((market as any).fundingRateMicros ?? 0));
  const interval = Number((market as any).fundingIntervalSeconds ?? 0);
  if (!Number.isFinite(rate) || !Number.isFinite(interval) || interval <= 0) return 0;
  return Math.ceil(rate / 100 * (policy.maximumHoldMs / 1_000) / interval);
}
function validLevels(levels: Array<{ price: number; size: number }>) { return levels.length > 0 && levels.every((item) => item.price > 0 && item.size > 0); }
function bps(last: number, first: number) { return Math.round((last - first) * 10_000 / first); }
function validMinuteStep(earlier: PerplPriceObservation, later: PerplPriceObservation) {
  const distance = later.observedAt - earlier.observedAt; return distance >= 30_000 && distance <= 90_000;
}
function safeIds(raw: string) { try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter(Number.isSafeInteger) : []; } catch { return []; } }
function rejectionSummary(item: any) { return { marketId: item.market.id, symbol: item.market.symbol, reason: item.reason,
  fiveMinuteMoveBps: item.signal?.momentum5mBps, fifteenMinuteMoveBps: item.signal?.momentum15mBps,
  netMoveBps: item.netMoveBps, spreadBps: item.spreadBps, entryImpactBps: item.entryImpactBps, exitImpactBps: item.exitImpactBps }; }
function ceilDiv(a: bigint, b: bigint) { return (a + b - 1n) / b; }
function minBig(...values: bigint[]) { return values.reduce((a, b) => a < b ? a : b); }
function maxBig(a: bigint, b: bigint) { return a > b ? a : b; }
