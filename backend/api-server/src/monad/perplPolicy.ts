import type { VenueAction, VenueAccountSnapshot, VenueMarket } from "./venueTypes.js";
import { PerplApiError, perplMaxSlippageBps } from "./perplConfig.js";

const ONE_AUSD = 1_000_000n;

export function validatePerplAction(action: VenueAction, market: VenueMarket, account: VenueAccountSnapshot, now = Date.now()) {
  const isEntry = ["market_entry", "limit_entry"].includes(action.kind);
  const isCancel = action.kind === "cancel_limit";
  if (isEntry && (!market.isOpen || !market.price || !market.book)) throw new PerplApiError("Perpl market is not open with a live executable book.", 409, "perpl_market_unavailable");
  if (isEntry || ["close_position", "reduce_size", "linked_exit", "amend_limit"].includes(action.kind)) {
    if (!market.price || !market.book) throw new PerplApiError(isEntry ? "Perpl market data is unavailable." : "A fresh executable quote is unavailable for this exit or amendment.", 409,
      isEntry ? "perpl_market_unavailable" : "perpl_exit_quote_unavailable");
    const age = now - market.price.observedAt;
    if (age < -5_000 || age > 60_000 || now - market.book.observedAt > 60_000) {
      throw new PerplApiError("Perpl market data is stale; no order was submitted.", 409, isEntry ? "perpl_price_stale" : "perpl_exit_quote_unavailable");
    }
  }
  if (!Number.isSafeInteger(action.requestId) || Number(action.requestId) <= account.lastRequestId) {
    throw new PerplApiError("Perpl request ID is not newer than the account's last processed request.", 409, "perpl_request_id_stale");
  }
  if (isEntry && action.expiresAt && now >= action.expiresAt) throw new PerplApiError("Perpl run mandate has expired.", 409, "perpl_run_expired");
  const allowed = action.allowedMarketIds;
  if (allowed && !allowed.includes(market.id)) throw new PerplApiError("Perpl market is outside the signed run mandate.", 403, "perpl_market_not_allowed");
  const isOpen = ["market_entry", "limit_entry"].includes(action.kind);
  const isClose = ["close_position", "reduce_size", "linked_exit"].includes(action.kind);
  if (!Number.isSafeInteger(action.size) || action.size < 0 || !isCancel && isOpen && action.size === 0 || isOpen && (!Number.isSafeInteger(action.leverage)
    || action.leverage < 1 || action.leverage > Math.min(market.maxLeverage, action.maxLeverage ?? market.maxLeverage))) {
    throw new PerplApiError("Perpl order size or leverage is outside the runtime market limits.", 400, "perpl_order_limits");
  }
  if (isOpen && (action.activePositionCount ?? 0) > 0) {
    throw new PerplApiError("A Perpl run may have only one open position.", 409, "perpl_position_already_open");
  }
  if (isClose && (action.activePositionCount ?? 0) !== 1) {
    throw new PerplApiError("There is no reconciled Perpl run position to close.", 409, "perpl_position_missing");
  }
  if (["cancel_limit", "amend_limit"].includes(action.kind) && !Number.isSafeInteger(action.orderId)) {
    throw new PerplApiError("Perpl order change requires the existing order ID.", 400, "perpl_order_id_required");
  }
  if (action.kind === "add_margin" && (!action.collateralAmount || !/^\d+$/.test(action.collateralAmount))) {
    throw new PerplApiError("Perpl margin change requires an integer AUSD amount.", 400, "perpl_margin_amount_invalid");
  }
  if (isOpen && (!action.maxCollateralUnits || !action.maxExposureUnits || !action.maxLeverage)) {
    throw new PerplApiError("Perpl entry is missing its signed collateral and exposure limits.", 403, "perpl_policy_missing");
  }
  if (isOpen && action.maxCollateralUnits && action.maxExposureUnits) {
    const executionPrice = action.price && action.price > 0 ? action.price : action.side === "short" ? market.price!.bid : market.price!.ask;
    if (executionPrice <= 0 || action.size <= 0) throw new PerplApiError("Perpl entry needs an executable price and positive size.", 400, "perpl_order_size_invalid");
    const notionalUnits = BigInt(executionPrice) * BigInt(action.size) * ONE_AUSD
      / (10n ** BigInt(market.priceDecimals + market.sizeDecimals));
    const collateralUnits = notionalUnits / BigInt(action.leverage);
    if (notionalUnits > BigInt(action.maxExposureUnits) || collateralUnits > BigInt(action.maxCollateralUnits)) {
      throw new PerplApiError("Perpl order exceeds the signed collateral or exposure cap.", 403, "perpl_policy_limit");
    }
  }
  if (["market_entry", "close_position", "reduce_size"].includes(action.kind)) assertDepth(action, market);
  if (!["market_entry", "limit_entry", "close_position", "reduce_size", "cancel_limit", "amend_limit",
    "add_margin", "linked_exit"].includes(action.kind)) {
    throw new PerplApiError("Perpl action is outside the supported policy action set.", 400, "perpl_action_unsupported");
  }
}

function assertDepth(action: VenueAction, market: VenueMarket) {
  if (!market.book) throw new PerplApiError("Perpl order book is unavailable for safe market execution.", 409, "perpl_depth_unavailable");
  const sellsIntoBids = ["market_entry", "limit_entry"].includes(action.kind)
    ? action.side === "short" : action.side === "long";
  const levels = sellsIntoBids ? market.book.bids : market.book.asks;
  let remaining = BigInt(action.size);
  let notional = 0n;
  const best = BigInt(levels[0]?.price ?? 0);
  if (!best) throw new PerplApiError("Perpl order book has no executable side.", 409, "perpl_depth_unavailable");
  for (const level of levels) {
    const take = remaining < BigInt(level.size) ? remaining : BigInt(level.size);
    notional += BigInt(level.price) * take;
    remaining -= take;
    if (remaining === 0n) break;
  }
  if (remaining > 0n) throw new PerplApiError("Perpl order book depth cannot execute the full capped size.", 409, "perpl_depth_insufficient");
  const average = notional / BigInt(action.size);
  const impactBps = (average > best ? average - best : best - average) * 10_000n / best;
  const cap = Math.min(market.maxMarketSlippageBps, action.maxSlippageBps ?? perplMaxSlippageBps());
  if (impactBps > BigInt(cap)) {
    throw new PerplApiError("Perpl executable depth exceeds the market slippage limit.", 409, "perpl_depth_slippage");
  }
}
