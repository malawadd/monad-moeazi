import { Interface, formatUnits, parseUnits } from "ethers";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { operatorMutation } from "./convex.js";
import { requireMera, parseBody, routeError } from "./auth.js";
import { MonadApiError } from "./config.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { monadProvider, finalizedBlockNumber } from "./provider.js";
import { PERPL_DIRECT_VENUE_ID, PERPL_CHAIN_ID, PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE } from "./perplConfig.js";
import { PerplApiClient } from "./perplApi.js";
import { readPerplContext, readPerplMarkets } from "./perplContext.js";
import { readDirectAccount, readDirectOrder, readDirectAccountId } from "./perplDirectState.js";
import { buildDirectOrderDesc, PERPL_DIRECT_EXEC_ABI } from "./perplDirectOrders.js";
import { decodeDirectReceipt } from "./perplDirectEvents.js";
import { reconcileManualOperation } from "./manualPerplReconcile.js";
import { readLegacyManualState } from "./manualPerplState.js";
import { MANUAL_PERPL_LEVERAGE_CAP, MANUAL_PERPL_SLIPPAGE_CAP_BPS,
  manualPerplEntryCollateralUnits, manualPerplMaxOrderUnits } from "./manualPerplLimits.js";
import { storedManualAccounts, storedOperation, persistPrepared, storedIdempotentOperation, sha256Json,
  validateIdempotencyKey, manualOperationDto, requireManualPerplActions, requireManualPerplBroadcast } from "./manualPerplShared.js";

const nowFresh = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= Date.now() + 5_000 && Date.now() - value <= 60_000;
const positiveUnits = (value: unknown, label: string) => {
  if (typeof value !== "string" || !/^[1-9]\d{0,20}$/.test(value)) throw new MonadApiError(`${label} must be a positive integer in Perpl base units.`, 400, "manual_perpl_amount_invalid");
  const parsed = BigInt(value); if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new MonadApiError(`${label} is above the safe Perpl size limit.`, 400, "manual_perpl_amount_invalid");
  return Number(parsed);
};
export function manualOrderIntentHash(ownerAddress: string, accountMode: "direct_wallet" | "legacy_delegated", body: any) {
  return sha256Json({ owner: ownerAddress.toLowerCase(), accountMode, kind: String(body.kind), marketId: Number(body.marketId),
    side: body.side ?? null, sizeUnits: body.sizeUnits ?? null, limitPrice: body.limitPrice ?? null,
    leverage: body.leverage ?? 1, orderId: body.orderId ?? null, collateralAmountUnits: body.collateralAmountUnits ?? null });
}
function orderId(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" || !/^\d{1,12}$/.test(String(value))) throw new MonadApiError("A valid open Perpl order ID is required.", 400, "manual_perpl_order_id_invalid");
  const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new MonadApiError("Perpl order ID is invalid.", 400, "manual_perpl_order_id_invalid");
  return n;
}

async function snapshot(provider: any, auth: any, marketId: number, accountMode: "direct_wallet" | "legacy_delegated") {
  const saved: any = await storedManualAccounts(auth.token);
  const live = await readPerplContext(); const market = live.markets.find((row) => row.id === marketId);
  if (!market) throw new MonadApiError("Perpl market was not found on Testnet.", 404, "perpl_market_unknown");
  const checkpoint = await finalizedBlockNumber(provider);
  if (accountMode === "legacy_delegated") {
    const legacy: any = await readLegacyManualState(provider, auth.ownerAddress, saved?.legacy, live, checkpoint);
    if (!legacy?.accountId || !legacy.account) throw new MonadApiError("Legacy Perpl recovery account is not open.", 409, "manual_perpl_account_not_open");
    const account = legacy.account;
    return { live, market, daAddress: legacy.accountAddress, accountMode, accountId: legacy.accountId, account };
  }
  const accountId = await readDirectAccountId(provider, auth.ownerAddress, checkpoint);
  if (!accountId) throw new MonadApiError("Create the direct Mera-owned Perpl account before trading.", 409, "manual_perpl_account_missing");
  const ids = live.markets.filter((row) => row.isOpen).map((row) => row.id);
  const account = await readDirectAccount(provider, accountId, ids, auth.ownerAddress, 0, checkpoint);
  return { live, market, daAddress: auth.ownerAddress, accountMode, accountId, account };
}

function ensureFreshMarket(market: any, needsBook: boolean) {
  if (!market.isOpen) throw new MonadApiError("Perpl market is not open for orders.", 409, "perpl_market_closed");
  if (!market.price || !nowFresh(market.price.observedAt) || market.price.blockNumber <= 0) {
    throw new MonadApiError("Perpl ticker is stale or unavailable; no order review was prepared.", 409, "perpl_ticker_stale");
  }
  if (needsBook && (!market.book || !nowFresh(market.book.observedAt) || market.book.blockNumber <= 0
      || !market.book.bids.length || !market.book.asks.length)) {
    throw new MonadApiError("A fresh executable Perpl order book is required for this action.", 409, "perpl_depth_unavailable");
  }
}

function checkDepth(action: any, market: any, maxSlippageBps: number) {
  if (!market.book) throw new MonadApiError("Perpl order book is unavailable.", 409, "perpl_depth_unavailable");
  const sells = ["market_entry", "limit_entry"].includes(action.kind) ? action.side === "short" : action.side === "long";
  const levels = sells ? market.book.bids : market.book.asks; const best = BigInt(levels[0]?.price ?? 0);
  let remaining = BigInt(action.size); let notional = 0n;
  for (const level of levels) { const take = remaining < BigInt(level.size) ? remaining : BigInt(level.size);
    notional += BigInt(level.price) * take; remaining -= take; if (!remaining) break; }
  if (remaining > 0n || !best) throw new MonadApiError("The fresh Perpl book cannot execute the reviewed size.", 409, "perpl_depth_insufficient");
  const average = notional / BigInt(action.size); const impact = (average > best ? average - best : best - average) * 10_000n / best;
  if (impact > BigInt(maxSlippageBps)) throw new MonadApiError("Perpl book impact exceeds the manual order cap.", 409, "perpl_depth_slippage");
}

async function prepareOrder(context: any) {
  const auth = await requireMera(context); requireManualPerplActions();
  const body = parseBody(await context.req.json()); const idempotencyKey = validateIdempotencyKey(body.idempotencyKey);
  const accountMode = body.accountMode === undefined || body.accountMode === "direct_wallet" ? "direct_wallet"
    : body.accountMode === "legacy_delegated" ? "legacy_delegated" : null;
  if (!accountMode) throw new MonadApiError("Manual Perpl account mode is invalid.", 400, "manual_perpl_account_mode_invalid");
  const kind = String(body.kind); const supported = ["market_entry", "limit_entry", "close_position", "reduce_size", "cancel_limit", "add_margin", "amend_limit"];
  if (!supported.includes(kind)) throw new MonadApiError("Manual Perpl order kind is unsupported.", 400, "manual_perpl_action_invalid");
  const marketId = Number(body.marketId);
  if (!Number.isSafeInteger(marketId) || marketId <= 0) throw new MonadApiError("Perpl market ID is invalid.", 400, "perpl_market_unknown");
  const intentHash = manualOrderIntentHash(auth.ownerAddress, accountMode, { ...body, kind, marketId });
  const prior = await storedIdempotentOperation(auth.token, idempotencyKey, intentHash);
  if (prior) return context.json(manualOperationDto(prior, kind, prior.actionDetails ?? {}));
  let side = body.side === "long" || body.side === "short" ? body.side : undefined;
  const marketAction = ["market_entry", "limit_entry", "close_position", "reduce_size"].includes(kind);
  if (marketAction && !side) throw new MonadApiError("Manual Perpl order side must be long or short.", 400, "manual_perpl_side_invalid");
  const provider = await monadProvider();
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(PERPL_CHAIN_ID)) throw new MonadApiError("Manual Perpl orders require Monad Testnet.", 503, "perpl_wrong_chain");
    const { live, daAddress, accountId, account } = await snapshot(provider, auth, marketId, accountMode);
    const api = new PerplApiClient();
    const market = kind === "cancel_limit" ? live.markets.find((item) => item.id === marketId)
      : (await readPerplMarkets(api, [marketId], true))[0];
    if (!market) throw new MonadApiError("Perpl market was not found on Testnet.", 404, "perpl_market_unknown");
    if (kind !== "cancel_limit") ensureFreshMarket(market, ["market_entry", "close_position", "reduce_size"].includes(kind));
    const position: any = account.positions.find((row: any) => Number(row.mkt) === marketId);
    const currentSize = Number(position?.s ?? 0); const currentSide = Number(position?.sd) === 2 ? "short" : "long";
  let size = kind === "cancel_limit" || kind === "add_margin" || kind === "amend_limit" ? 0
    : kind === "close_position" && !body.sizeUnits ? currentSize : positiveUnits(body.sizeUnits, "Order size");
    if (kind === "close_position" && (!position || side !== currentSide || size !== currentSize)) throw new MonadApiError("Close requires the complete current position; use reduce_size for partial exits.", 409, "manual_perpl_position_mismatch");
    if (kind === "reduce_size" && (!position || side !== currentSide || size >= currentSize)) throw new MonadApiError("Reduce size must be smaller than the verified position.", 409, "manual_perpl_position_mismatch");
    if (["market_entry", "limit_entry"].includes(kind) && position) throw new MonadApiError("A position already exists for this Perpl market.", 409, "manual_perpl_position_exists");
    const existingOrderId = ["cancel_limit", "amend_limit"].includes(kind) ? orderId(body.orderId) : undefined;
    let beforeOrder: any = null;
    if (existingOrderId) {
      if (!account.orders.some((row: any) => Number(row.lockId) === existingOrderId)) throw new MonadApiError("The selected Perpl order is not locked in this manual account.", 409, "manual_perpl_order_missing");
    beforeOrder = await readDirectOrder(provider, marketId, existingOrderId, account.blockNumber);
    if (beforeOrder.accountId !== accountId || beforeOrder.orderId !== existingOrderId) throw new MonadApiError("Perpl order is not owned by this manual account.", 403, "manual_perpl_order_owner_mismatch");
    if (kind === "amend_limit") {
      const existingSide = Number(beforeOrder.orderType) === 1 ? "short" : "long";
      if (side && side !== existingSide) throw new MonadApiError("Limit amendments must keep the existing order direction.", 409, "manual_perpl_order_side_mismatch");
      if (body.sizeUnits !== undefined) throw new MonadApiError("Manual limit amendments may change price only; cancel and prepare a new order to change size.", 400, "manual_perpl_amend_size_unsupported");
      side = existingSide; size = positiveUnits(String(beforeOrder.size), "Existing order size");
    }
  }
    const leverage = Number(body.leverage ?? 1);
    if (["market_entry", "limit_entry"].includes(kind) && (!Number.isSafeInteger(leverage) || leverage < 1
        || leverage > Math.min(MANUAL_PERPL_LEVERAGE_CAP, live.limits.maxLeverage, market.maxLeverage))) {
      throw new MonadApiError("Manual Perpl leverage exceeds the capped Testnet limit.", 400, "manual_perpl_leverage_invalid");
    }
    let price = 0; let limitPrice: string | undefined;
    if (kind === "limit_entry" || kind === "amend_limit") {
      if (typeof body.limitPrice !== "string") throw new MonadApiError("Limit price is required.", 400, "manual_perpl_limit_price_invalid");
      try { price = Number(parseUnits(body.limitPrice, market.priceDecimals)); } catch { price = 0; }
      if (!Number.isSafeInteger(price) || price <= 0) throw new MonadApiError("Limit price precision or value is invalid.", 400, "manual_perpl_limit_price_invalid");
      limitPrice = formatUnits(price, market.priceDecimals);
    }
    if (kind === "add_margin") {
      const collateral = positiveUnits(body.collateralAmountUnits, "AUSD margin");
      if (BigInt(account.balanceUnits) - BigInt(account.lockedUnits) < BigInt(collateral)) throw new MonadApiError("Manual Perpl account has insufficient free AUSD.", 409, "manual_perpl_collateral_insufficient");
    }
    const requestId = Number(BigInt(Date.now()) * 1_000n + BigInt(Math.floor(Math.random() * 1000)));
    const priceForNotional = price || (side === "short" ? market.price!.bid : market.price!.ask);
    const notional = marketAction && size ? BigInt(priceForNotional) * BigInt(size) * 1_000_000n
      / (10n ** BigInt(market.priceDecimals + market.sizeDecimals)) : 0n;
    const entryCollateral = ["market_entry", "limit_entry"].includes(kind)
      ? manualPerplEntryCollateralUnits(notional, leverage, market.takerFeeMicros) : null;
    const maxOrder = manualPerplMaxOrderUnits();
    if (["market_entry", "limit_entry"].includes(kind) && (notional <= 0n || notional > maxOrder
        || BigInt(account.balanceUnits) - BigInt(account.lockedUnits) < entryCollateral!.requiredUnits)) {
      throw new MonadApiError("Manual Perpl entry exceeds the configured AUSD cap or free collateral including opening fee.", 409, "manual_perpl_order_cap");
    }
    const action: any = { kind, marketId, accountId, ...(side ? { side } : {}), size, price,
      leverage, orderId: existingOrderId ?? 0, requestId, maxSlippageBps: MANUAL_PERPL_SLIPPAGE_CAP_BPS,
      ...(kind === "add_margin" ? { collateralAmount: String(body.collateralAmountUnits) } : {}) };
    if (["market_entry", "close_position", "reduce_size"].includes(kind)) {
      checkDepth(action, market, MANUAL_PERPL_SLIPPAGE_CAP_BPS);
    }
    const checkpoint = await finalizedBlockNumber(provider);
    const orderDesc = buildDirectOrderDesc(action, market, requestId, checkpoint);
    const data = new Interface(PERPL_DIRECT_EXEC_ABI).encodeFunctionData("execOrder", [orderDesc]);
    const transactionTarget = accountMode === "direct_wallet" ? PERPL_TESTNET_EXCHANGE : daAddress;
    const built = await buildEip1559Transaction(provider, auth.ownerAddress, transactionTarget, data);
    const review = { action: kind, kind, accountMode, ownerAddress: auth.ownerAddress, chainId: PERPL_CHAIN_ID, venueId: PERPL_DIRECT_VENUE_ID,
      exchangeAddress: PERPL_TESTNET_EXCHANGE,
      accountAddress: daAddress, accountId, marketId, symbol: market.symbol, priceDecimals: market.priceDecimals,
      sizeDecimals: market.sizeDecimals, ...(side ? { side, direction: side } : {}),
      sizeUnits: String(size), ...(limitPrice ? { limitPrice } : {}), leverage,
      quotedAUSDUnits: notional.toString(), maxOrderAUSDUnits: maxOrder.toString(),
      estimatedEntryMarginUnits: entryCollateral?.marginUnits.toString() ?? null,
      estimatedEntryFeeUnits: entryCollateral?.feeUnits.toString() ?? null,
      observedAt: market.price?.observedAt ?? null,
      quoteBlockNumber: market.price?.blockNumber ?? null, requestId, orderId: existingOrderId ?? null,
      ...(beforeOrder ? { existingOrder: beforeOrder } : {}), orderDescription: orderDesc,
      target: transactionTarget, transactionValue: "0", method: "execOrder(OrderDesc)", gas: built.gas,
      collateral: { symbol: "AUSD", address: PERPL_TESTNET_AUSD, decimals: 6 } };
    const operationId = randomUUID(); const expiresAt = Date.now() + 240_000;
    const row: any = await persistPrepared(auth.token, { operationId, idempotencyKey, intentHash,
      action: kind, actionJson: JSON.stringify({ ...review, prePositionSize: String(currentSize), preOrderCount: account.orders.length,
        accountBlock: account.blockNumber, preBalanceUnits: account.balanceUnits,
        preFundingUnits: String(position?.fundingPnlUnits ?? "0"), preEntryPricePNS: String(position?.ep ?? "0"),
        marketId, symbol: market.symbol,
        side: side ?? currentSide, sizeUnits: String(size), orderId: existingOrderId ?? null, orderDescription: orderDesc }),
      transactionJson: JSON.stringify(built.transaction), nonce: built.transaction.nonce, expiresAt,
      accountAddress: daAddress, accountId, accountMode, marketId, requestId });
    return context.json(manualOperationDto(row, kind, review), 201);
  } finally { await provider.destroy(); }
}

async function operationStatus(context: any) {
  const auth = await requireMera(context); const operationId = context.req.param("operationId");
  let row: any = await storedOperation(auth.token, operationId);
  if (!row) throw new MonadApiError("Manual Perpl operation was not found.", 404, "manual_perpl_operation_not_found");
  if (row.expiresAt <= Date.now() && row.status === "prepared") return context.json({ ...manualOperationDto(row, row.action, row.actionDetails ?? {}), status: "expired" });
  if (["submitted", "uncertain"].includes(row.status) && row.txHash) {
    const provider = await monadProvider();
    try { row = await reconcileManualOperation(provider, auth, row); } finally { await provider.destroy(); }
  }
  return context.json({ ...manualOperationDto(row, row.action, row.actionDetails ?? {}),
    ...(row.result ? { fill: row.result.fills?.length ? row.result.fills : undefined } : {}) });
}
async function submit(context: any) {
  const auth = await requireMera(context); requireManualPerplBroadcast();
  const operationId = context.req.param("operationId"); const row: any = await storedOperation(auth.token, operationId);
  if (!row) throw new MonadApiError("Manual Perpl operation was not found.", 404, "manual_perpl_operation_not_found");
  const body = parseBody(await context.req.json()); const verified = verifyExactSignedTransaction(body.signedTransaction, row.transaction, auth.ownerAddress);
  if (row.txHash) {
    if (row.txHash.toLowerCase() !== verified.transactionHash.toLowerCase()) throw new MonadApiError("This manual operation already contains different signed bytes.", 409, "signed_transaction_mismatch");
    const provider = await monadProvider();
    try {
      const current: any = await reconcileManualOperation(provider, auth, row);
      return context.json({ ...manualOperationDto(current, row.action, row.actionDetails ?? {}),
        message: "This operation already has its exact signed transaction saved; status was reconciled without another broadcast." });
    } finally { await provider.destroy(); }
  }
  await operatorMutation("monadManual", "markSubmitted", { operationId, ownerAddress: auth.ownerAddress,
    signedTransaction: verified.canonicalRawTransaction, txHash: verified.transactionHash.toLowerCase() });
  const provider = await monadProvider();
  try {
    const response = await provider.broadcastTransaction(verified.canonicalRawTransaction);
    if (response.hash.toLowerCase() !== verified.transactionHash.toLowerCase()) throw new Error("RPC returned another transaction hash.");
    const updated: any = await storedOperation(auth.token, operationId);
    return context.json({ ...manualOperationDto(updated, row.action, row.actionDetails ?? {}), status: "submitted", txHash: response.hash });
  } catch {
    const updated: any = await storedOperation(auth.token, operationId);
    return context.json({ ...manualOperationDto(updated, row.action, row.actionDetails ?? {}), status: "uncertain",
      message: "The signed transaction is saved. Check this same operation ID to reconcile its receipt." });
  } finally { await provider.destroy(); }
}

export function registerManualPerplOrderRoutes(app: Hono<any>) {
  app.post("/api/mobile/manual/perpl/orders/prepare", (c) => guard(c, prepareOrder));
  app.post("/api/mobile/manual/perpl/operations/:operationId/submit", (c) => guard(c, submit));
  app.get("/api/mobile/manual/perpl/operations/:operationId", (c) => guard(c, operationStatus));
}
async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
