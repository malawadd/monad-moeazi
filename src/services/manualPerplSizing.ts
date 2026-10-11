import {formatUnits, parseUnits} from 'viem';
import type {MarketBook, MarketDirectoryRow} from '../types/marketDirectory';
import {monadTimestampMillis} from './monadFormatting';
export type ManualEntrySide = 'long' | 'short';
export type ManualEntryOrderType = 'market' | 'limit';

export type ManualPerplEntrySizingInput = {
  market: MarketDirectoryRow | null;
  book?: MarketBook | null;
  snapshotObservedAt?: number | string;
  snapshotError?: boolean;
  accountFresh: boolean;
  balanceUnits?: string | null;
  lockedUnits?: string | null;
  side: ManualEntrySide;
  orderType: ManualEntryOrderType;
  notionalAUsd: number;
  leverage: number;
  limitPrice?: string;
  capabilityEnabled: boolean; positionOpen?: boolean;
  now?: number;
};
export type ManualPerplEntrySizing = {
  canReview: boolean;
  reason: string | null;
  quoteFresh: boolean;
  bookFresh: boolean;
  minNotionalAUsd: number;
  maxNotionalAUsd: number;
  manualCapAUsd: number;
  freeCollateralAUsd: number;
  lockedCollateralAUsd: number | null;
  executableDepthAUsd: number | null;
  maxLeverage: number;
  exchangeMaxLeverage: number;
  sizeUnits: string;
  size: string;
  limitPrice: string;
  entryPrice: number | null;
  spreadBps: number | null;
  impactBps: number | null;
  marginAUsd: number;
  entryFeeAUsd: number;
  openingFeeReserveAUsd: number;
  exitFeeAUsd: number;
  breakEvenPrice: number | null;
  liquidationPrice: number | null;
  liquidationDistancePct: number | null; onePercentUpPnlAUsd: number; onePercentDownPnlAUsd: number;
  liquidationCaveat: string;
};

type DepthResult = {baseSize: number; quoteNotional: number; averagePrice: number | null; impactBps: number | null; complete: boolean};
const FRESH_MS = 60_000;
const MAX_FUTURE_MS = 5_000;
const ONE_AUSD = 1_000_000;

export function timestampIsFresh(value: number | string | null | undefined, now = Date.now()) {
  if (value === null || value === undefined || value === '') return false;
  const at = monadTimestampMillis(value);
  const age = now - at;
  return Number.isFinite(at) && age >= -MAX_FUTURE_MS && age <= FRESH_MS;
}

export function sliderValueFromOffset(offset: number, width: number, min: number, max: number, step: number) {
  if (width <= 0 || max <= min) return min;
  const ratio = Math.max(0, Math.min(1, offset / width));
  const raw = min + ratio * (max - min);
  const safeStep = step > 0 ? step : (max - min) / 100;
  return clampNumber(min + Math.round((raw - min) / safeStep) * safeStep, min, max);
}

export function sliderProgress(value: number, min: number, max: number) {
  return max <= min ? 0 : Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export function adjustLimitPriceByTick(value: string, decimals: number, direction: -1 | 1) {
  try {
    const price = parseUnits(value, decimals) + BigInt(direction);
    return price > 0n ? formatUnits(price, decimals) : value;
  } catch {
    return value;
  }
}

export function getManualPerplEntrySizing(input: ManualPerplEntrySizingInput): ManualPerplEntrySizing {
  const {market, book, side, orderType} = input;
  const now = input.now ?? Date.now();
  const priceDecimals = safeDecimals(market?.priceDecimals);
  const sizeDecimals = safeDecimals(market?.sizeDecimals);
  const quoteAt = market?.quote?.observedAt ?? input.snapshotObservedAt;
  const bookAt = book?.observedAt ?? input.snapshotObservedAt;
  const quoteFresh = timestampIsFresh(quoteAt, now);
  const bookFresh = Boolean(book && timestampIsFresh(bookAt, now));
  const exchangeMaxLeverage = positiveInteger(market?.maxLeverage);
  const manualMaxLeverage = positiveInteger(market?.manualMaxLeverage);
  const maxLeverage = exchangeMaxLeverage && manualMaxLeverage ? Math.min(exchangeMaxLeverage, manualMaxLeverage) : 0;
  const balanceAUsd = unitsToNumber(input.balanceUnits, 6);
  const lockedCollateralAUsd = unitsToNumber(input.lockedUnits, 6);
  const freeCollateralAUsd = Math.max(0, balanceAUsd - lockedCollateralAUsd);
  const manualCapAUsd = unitsToNumber(market?.manualMaxOrderUnits, 6);
  const minNotionalAUsd = unitsToNumber(market?.minPostingUnits, 6);
  const quotePriceRaw = quoteSidePriceRaw(market, side);
  const quotePrice = rawPriceToNumber(quotePriceRaw, priceDecimals);
  const sideLevels = getSideLevels(book, side);
  const bestBookPriceRaw = positiveRaw(sideLevels[0]?.price);
  const bestBookPrice = rawPriceToNumber(bestBookPriceRaw, priceDecimals);
  const referencePrice = quotePrice ?? bestBookPrice;
  const liveLimitPrice = quotePrice === null ? '' : formatPriceNumber(quotePrice, priceDecimals);
  const selectedLimitPrice = input.limitPrice?.trim() || liveLimitPrice;
  const limitPriceNumber = orderType === 'limit' ? positiveDecimal(selectedLimitPrice) : null;
  const entryReferencePrice = orderType === 'limit' ? limitPriceNumber : referencePrice;
  const selectedPriceRaw = orderType === 'limit'
    ? decimalToRaw(selectedLimitPrice, priceDecimals)
    : quotePriceRaw ?? bestBookPriceRaw;
  const takerFeeRate = feeRate(market?.takerFeeMicros);
  const makerFeeRate = feeRate(market?.makerFeeMicros);
  const estimatedEntryFeeRate = orderType === 'limit' ? makerFeeRate : takerFeeRate;
  const openingFeeReserveRate = takerFeeRate;
  const exitFeeRate = takerFeeRate;
  const slippageBps = Math.min(100, positiveInteger(market?.manualMaxSlippageBps) || 100,
    positiveInteger(market?.maxMarketSlippageBps) || 100);
  const depth = measureDepth(sideLevels, bestBookPrice, slippageBps, priceDecimals, sizeDecimals);
  const executableDepthAUsd = depth.complete && (referencePrice ?? bestBookPrice) !== null
    ? depth.baseSize * (referencePrice ?? bestBookPrice)! : null;
  const rawCollateralBudget = maxLeverage > 0 && input.leverage >= 1 && input.leverage <= maxLeverage && openingFeeReserveRate !== null && freeCollateralAUsd > 0
    ? freeCollateralAUsd / (1 / input.leverage + openingFeeReserveRate) : 0;
  const collateralBudgetAUsd = Math.max(0, (Math.floor(rawCollateralBudget * ONE_AUSD) - 1) / ONE_AUSD);
  const maxNotionalAUsd = orderType === 'market'
    ? Math.min(manualCapAUsd, collateralBudgetAUsd, executableDepthAUsd ?? 0)
    : Math.min(manualCapAUsd, collateralBudgetAUsd);
  const normalizedMaxNotional = Number.isFinite(maxNotionalAUsd) && maxNotionalAUsd > 0 ? maxNotionalAUsd : 0;
  const selectedNotional = input.notionalAUsd;
  const sizeUnits = sizeUnitsForNotional(selectedNotional, selectedPriceRaw, priceDecimals, sizeDecimals);
  const size = formatUnits(BigInt(sizeUnits || '0'), sizeDecimals);
  const baseSize = unitsToNumber(sizeUnits, sizeDecimals);
  const marketExecution = orderType === 'market' && bestBookPrice !== null
    ? simulateDepth(sideLevels, baseSize, bestBookPrice, slippageBps, priceDecimals, sizeDecimals)
    : null;
  const entryPrice = orderType === 'market' ? marketExecution?.averagePrice ?? null : entryReferencePrice;
  const actualNotionalAUsd = entryPrice !== null ? baseSize * entryPrice : 0;
  const marginAUsd = input.leverage > 0 ? actualNotionalAUsd / input.leverage : 0;
  const entryFeeAUsd = estimatedEntryFeeRate === null ? 0 : actualNotionalAUsd * estimatedEntryFeeRate;
  const openingFeeReserveAUsd = openingFeeReserveRate === null ? 0 : actualNotionalAUsd * openingFeeReserveRate;
  const exitFeeAUsd = exitFeeRate === null ? 0 : actualNotionalAUsd * exitFeeRate;
  const spreadBps = spreadFromBook(book, priceDecimals);
  const maintenanceRate = Number(market?.maintenanceMarginBps) / 10_000;
  const marginFraction = input.leverage > 0 ? (1 / input.leverage) - (openingFeeReserveRate ?? 0) : 0;
  const liquidationPrice = entryPrice !== null && Number.isFinite(maintenanceRate) && maintenanceRate > 0
    ? side === 'long' ? entryPrice * (1 + maintenanceRate - marginFraction)
      : entryPrice * (1 - maintenanceRate + marginFraction)
    : null;
  const liquidationDistancePct = entryPrice !== null && liquidationPrice !== null
    ? Math.abs((entryPrice - liquidationPrice) / entryPrice) * 100 : null;
  const onePercentUpPnlAUsd = actualNotionalAUsd * 0.01 * (side === 'long' ? 1 : -1);
  const breakEvenPrice = entryPrice !== null && estimatedEntryFeeRate !== null && exitFeeRate !== null
    ? side === 'long' ? entryPrice * (1 + estimatedEntryFeeRate) / (1 - exitFeeRate)
      : entryPrice * (1 - estimatedEntryFeeRate) / (1 + exitFeeRate)
    : null;

  const reason = getBlockReason({input, market, quoteFresh, bookFresh, sideLevels, maxLeverage, maxNotionalAUsd: normalizedMaxNotional,
    manualCapAUsd, minNotionalAUsd, selectedNotional, freeCollateralAUsd, entryFeeRate: openingFeeReserveRate, entryReferencePrice, selectedPriceRaw,
    sizeUnits, marketExecution, depth, now});
  return {canReview: reason === null, reason, quoteFresh, bookFresh, minNotionalAUsd, maxNotionalAUsd: normalizedMaxNotional,
    manualCapAUsd, freeCollateralAUsd, lockedCollateralAUsd, executableDepthAUsd, maxLeverage, exchangeMaxLeverage,
    sizeUnits, size, limitPrice: selectedLimitPrice, entryPrice, spreadBps, impactBps: marketExecution?.impactBps ?? null,
    marginAUsd, entryFeeAUsd, openingFeeReserveAUsd, exitFeeAUsd, breakEvenPrice, liquidationPrice,
    liquidationDistancePct, onePercentUpPnlAUsd, onePercentDownPnlAUsd: -onePercentUpPnlAUsd,
    liquidationCaveat: 'Estimate only. Mark price, funding, fees, and Perpl margin rules can move liquidation.'};
}
function getBlockReason(values: {
  input: ManualPerplEntrySizingInput; market: MarketDirectoryRow | null; quoteFresh: boolean; bookFresh: boolean;
  sideLevels: Array<{price: number | string; size: number | string}>; maxLeverage: number; maxNotionalAUsd: number;
  manualCapAUsd: number; minNotionalAUsd: number; selectedNotional: number; freeCollateralAUsd: number;
  entryFeeRate: number | null; entryReferencePrice: number | null; selectedPriceRaw: string | null; sizeUnits: string;
  marketExecution: DepthResult | null; depth: DepthResult; now: number;
}) {
  const {input, market} = values;
  if (input.snapshotError) return 'Market data refresh failed. Refresh before preparing an order.';
  if (!market || market.kind !== 'perpl' || !market.available || market.marketOpen === false || market.status !== 'open') return 'This Perpl market is unavailable or closed.';
  if (!values.quoteFresh) return 'The live ticker is stale or missing. Refresh before preparing an order.';
  if (!input.accountFresh) return 'Fresh Mera-owned Perpl collateral is unavailable. Refresh the account before preparing an order.';
  if (!input.capabilityEnabled) return 'This order type is disabled by the manual Perpl account capability or local gate.';
  if (input.positionOpen) return 'A position is already open in this Perpl market. Manage it before opening another.';
  if (!positiveInteger(market.initialMarginBps) || !positiveInteger(market.maintenanceMarginBps)) return 'Live Perpl initial and maintenance margin rates are unavailable.';
  if (!values.maxLeverage || input.leverage < 1 || input.leverage > values.maxLeverage || !Number.isSafeInteger(input.leverage)) return 'Choose whole-number leverage within the live manual cap.';
  if (!values.manualCapAUsd) return 'The live Moeazi manual AUSD order cap is unavailable.';
  if (values.entryFeeRate === null) return 'The live Perpl fee tier is unavailable.';
  if (!values.entryReferencePrice || !values.selectedPriceRaw) return input.orderType === 'limit' ? 'A live side price is required to size this limit.' : 'A live executable side price is unavailable.';
  if (input.orderType === 'market' && !values.bookFresh) return 'The executable order book is stale or missing. Refresh before preparing a market order.';
  if (input.orderType === 'market' && !values.sideLevels.length) return 'The order book has no executable depth on this side.';
  if (input.orderType === 'market' && !values.depth.complete) return 'The current order book has no executable depth within the 100 bps market impact cap.';
  if (values.maxNotionalAUsd < values.minNotionalAUsd) return 'Maximum available size is below Perpl’s minimum posting amount.';
  if (!Number.isFinite(input.notionalAUsd) || input.notionalAUsd <= 0) return 'Choose a trade size greater than zero.';
  if (values.minNotionalAUsd > 0 && input.notionalAUsd < values.minNotionalAUsd) return `Choose at least ${formatAUsd(values.minNotionalAUsd)} AUSD.`;
  if (input.notionalAUsd > values.maxNotionalAUsd + 0.000001) return 'Trade size exceeds free AUSD after the opening fee, Moeazi manual cap, or executable depth.';
  if (!values.sizeUnits || BigInt(values.sizeUnits) <= 0n) return 'This size rounds down to zero at the market’s size precision.';
  if (input.orderType === 'market' && (!values.marketExecution?.complete || values.marketExecution.impactBps === null)) return 'The selected size cannot execute within the live 100 bps impact cap.';
  const requiredMargin = (input.notionalAUsd / input.leverage) + input.notionalAUsd * values.entryFeeRate;
  if (requiredMargin > values.freeCollateralAUsd + 0.000001) return 'Free AUSD is insufficient for isolated margin and the estimated opening fee.';
  if (!timestampIsFresh(market.quote?.observedAt, values.now)) return 'The live quote is no longer fresh. Refresh before preparing an order.';
  return null;
}

function measureDepth(levels: Array<{price: number | string; size: number | string}>, best: number | null,
  maxImpactBps: number, priceDecimals: number, sizeDecimals: number): DepthResult {
  if (!best || !levels.length) return {baseSize: 0, quoteNotional: 0, averagePrice: null, impactBps: null, complete: false};
  let baseSize = 0;
  for (const level of levels) {
    const price = rawPriceToNumber(positiveRaw(level.price), priceDecimals);
    const size = rawPriceToNumber(positiveRaw(level.size), sizeDecimals);
    if (price === null || size === null) continue;
    const impact = Math.abs((price - best) / best) * 10_000;
    if (impact > maxImpactBps + 0.000001) continue;
    baseSize += size;
  }
  return {baseSize, quoteNotional: baseSize * best, averagePrice: null, impactBps: null, complete: baseSize > 0};
}

function simulateDepth(levels: Array<{price: number | string; size: number | string}>, targetSize: number, best: number,
  maxImpactBps: number, priceDecimals: number, sizeDecimals: number): DepthResult {
  let remaining = targetSize;
  let filled = 0;
  let notional = 0;
  for (const level of levels) {
    const price = rawPriceToNumber(positiveRaw(level.price), priceDecimals);
    const size = rawPriceToNumber(positiveRaw(level.size), sizeDecimals);
    if (price === null || size === null || Math.abs((price - best) / best) * 10_000 > maxImpactBps + 0.000001) continue;
    const take = Math.min(remaining, size);
    filled += take; notional += take * price; remaining -= take;
    if (remaining <= 1e-12) break;
  }
  const averagePrice = filled > 0 ? notional / filled : null;
  const impactBps = averagePrice === null ? null : Math.abs((averagePrice - best) / best) * 10_000;
  return {baseSize: filled, quoteNotional: notional, averagePrice, impactBps, complete: remaining <= 1e-12};
}

function getSideLevels(book: MarketBook | null | undefined, side: ManualEntrySide) {
  const levels = side === 'long' ? book?.asks ?? [] : book?.bids ?? [];
  return [...levels].sort((left, right) => {
    const a = Number(left.price); const b = Number(right.price);
    return side === 'long' ? a - b : b - a;
  });
}

function spreadFromBook(book: MarketBook | null | undefined, priceDecimals: number) {
  const bid = rawPriceToNumber(positiveRaw(book?.bids[0]?.price), priceDecimals);
  const ask = rawPriceToNumber(positiveRaw(book?.asks[0]?.price), priceDecimals);
  if (!bid || !ask || bid > ask) return null;
  return ((ask - bid) / ((ask + bid) / 2)) * 10_000;
}

function quoteSidePriceRaw(market: MarketDirectoryRow | null, side: ManualEntrySide) {
  const value = side === 'long' ? market?.quote?.ask : market?.quote?.bid;
  return positiveRaw(value);
}

function sizeUnitsForNotional(notionalAUsd: number, priceRaw: string | null, priceDecimals: number, sizeDecimals: number) {
  if (!priceRaw || !Number.isFinite(notionalAUsd) || notionalAUsd <= 0) return '0';
  try {
    const notionalUnits = parseUnits(notionalAUsd.toFixed(6), 6);
    const scale = 10n ** BigInt(priceDecimals + sizeDecimals);
    const units = (notionalUnits * scale) / (BigInt(priceRaw) * BigInt(ONE_AUSD));
    return units > 0n ? units.toString() : '0';
  } catch {
    return '0';
  }
}

function decimalToRaw(value: string, decimals: number) {
  try { const raw = parseUnits(value, decimals); return raw > 0n ? raw.toString() : null; }
  catch { return null; }
}

function rawPriceToNumber(value: string | null, decimals: number) {
  if (!value) return null;
  const parsed = Number(value) / (10 ** decimals);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveRaw(value: unknown) {
  const text = String(value ?? '');
  return /^\d+$/.test(text) && BigInt(text) > 0n ? text : null;
}

function unitsToNumber(value: string | null | undefined, decimals: number) {
  if (!value || !/^\d+$/.test(value)) return 0;
  const number = Number(value) / (10 ** decimals);
  return Number.isFinite(number) ? number : 0;
}

function safeDecimals(value: number | undefined) { return Number.isSafeInteger(value) && value! >= 0 && value! <= 18 ? value! : 0; }
function positiveInteger(value: number | undefined) { return Number.isSafeInteger(value) && value! > 0 ? value! : 0; }
function feeRate(value: number | undefined) { return Number.isSafeInteger(value) && value! >= 0 ? value! / 1_000_000 : null; }
function positiveDecimal(value: string) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function formatPriceNumber(value: number, decimals: number) {
  const formatted = value.toFixed(Math.min(decimals, 10));
  return formatted.includes('.') ? formatted.replace(/0+$/, '').replace(/\.$/, '') : formatted;
}
function formatAUsd(value: number) { return value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
function clampNumber(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
