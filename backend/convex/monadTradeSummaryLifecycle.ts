import { aggregateFills, grossExitPnlCns } from "./tradeSummaryMath";

const parse = (value?: string) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const list = (value?: string) => { const parsed = parse(value); return Array.isArray(parsed) ? parsed : []; };
const integer = (value: unknown) => /^\d+$/.test(String(value ?? "")) ? BigInt(String(value)) : 0n;
const positiveInteger = (value: unknown) => /^\d+$/.test(String(value ?? "")) && BigInt(String(value)) > 0n
  ? BigInt(String(value)).toString() : null;
const priceValue = (fills: any[]) => {
  const valid = fills.filter((fill) => integer(fill.lotLNS) > 0n && integer(fill.pricePNS) > 0n);
  return valid.reduce((sum, fill) => sum + integer(fill.lotLNS) * integer(fill.pricePNS), 0n);
};
function mergedList(raw: string | undefined, value: string) { return [...new Set([...list(raw).map(String), value])]; }

export function matchOptimizerCycleEvidence(summary: any, cycles: any[], ownerAddress: string) {
  if (summary.status !== "closed" || !summary.runId || !summary.transactionHashes?.length) return null;
  const hashes = [...new Set(summary.transactionHashes.map((hash: string) => hash.toLowerCase()))].sort();
  for (const cycle of cycles) {
    if (cycle.ownerAddress !== ownerAddress || cycle.venueId !== summary.venueId) continue;
    const data = parse(cycle.cycleJson) ?? {}; const receipts = Array.isArray(data.orderReceipts) ? data.orderReceipts : [];
    const receiptHashes = [...new Set(receipts.filter((item: any) => ["entry", "exit"].includes(item.role))
      .map((item: any) => String(item.txHash ?? "").toLowerCase())
      .filter((hash: string) => /^0x[a-f0-9]{64}$/.test(hash)))].sort();
    if (data.endingFlat !== true || data.exitFinalized !== true || Number(data.marketId) !== Number(summary.marketId)
        || receiptHashes.length !== hashes.length || !receiptHashes.every((hash: unknown, index: number) => String(hash) === hashes[index])
        || !/^-?\d+$/.test(String(cycle.realizedPnlUnits ?? "")) || !/^\d+$/.test(String(data.feesUnits ?? ""))
        || !/^-?\d+$/.test(String(data.fundingUnits ?? ""))) continue;
    return { cycleId: String(data.cycleId), realizedPnlUnits: String(cycle.realizedPnlUnits),
      feesUnits: String(data.feesUnits), fundingUnits: String(data.fundingUnits) };
  }
  return null;
}

export async function recordManualPosition(ctx: any, row: any, details: any, activityId: string, finalizedAt: number) {
  const action = parse(row.actionJson) ?? {}; const fills = Array.isArray(details.fills) ? details.fills : [];
  if (!fills.length || details.verified !== true || !/^\d+$/.test(String(details.afterPositionSize ?? ""))) return;
  const marketId = String(action.marketId ?? row.marketId ?? ""); const direction = String(action.side ?? "unknown");
  if (!/^\d+$/.test(marketId) || !["long", "short"].includes(direction)) return;
  const entry = ["market_entry", "limit_entry"].includes(String(action.kind));
  const aggregate = aggregateFills(fills); const fillSize = BigInt(aggregate.sizeUnits);
  if (fillSize <= 0n) return;
  const candidates = await ctx.db.query("monadTradeSummaries").withIndex("by_owner_venue_market", (q: any) =>
    q.eq("ownerAddress", row.ownerAddress).eq("venueId", row.venueId).eq("marketId", marketId)).collect();
  const current = candidates.filter((item: any) => item.userId === row.userId && item.direction === direction
    && item.status === "open").sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0];
  if (current && list(current.activityIdsJson).includes(activityId)) return;
  const afterSize = integer(details.afterPositionSize);
  if (entry && afterSize <= 0n || !entry && !current && !/^\d+$/.test(String(action.prePositionSize ?? ""))) return;
  const prior = current ?? null;
  const summaryId = prior?.summaryId ?? `manual:${String(row.accountAddress ?? row.ownerAddress).toLowerCase()}:${marketId}:${direction}:${row.operationId}`;
  const oldExitSize = integer(prior?.exitSizeUnits); const newExitSize = entry ? 0n : fillSize;
  const oldExitValue = integer(prior?.exitValueNumerator); const newExitValue = entry ? 0n : priceValue(fills);
  const exitSize = oldExitSize + newExitSize; const exitValue = oldExitValue + newExitValue;
  const observedEntry = integer(details.afterPositionEntryPrice);
  const entryPrice = observedEntry !== null && observedEntry > 0n ? observedEntry.toString()
    : entry ? String(aggregate.weightedPrice ?? "")
      : String(prior?.weightedEntryPrice ?? positiveInteger(action.preEntryPricePNS) ?? "");
  if (!entry && !entryPrice) return;
  const entryBase = prior ? integer(prior.entrySizeUnits ?? prior.sizeUnits)
    : entry ? 0n : integer(action.prePositionSize);
  const entrySize = entryBase + (entry ? fillSize : 0n);
  if (entrySize <= 0n) return;
  const priceDecimals = Number(action.priceDecimals ?? prior?.priceDecimals);
  const sizeDecimals = Number(action.sizeDecimals ?? prior?.sizeDecimals);
  const incrementalPricePnl = entry || !entryPrice ? null : grossExitPnlCns(fills, entryPrice, direction as "long" | "short", priceDecimals, sizeDecimals);
  const previousPricePnl = prior?.realizedPricePnlUnits;
  const pricePnl = incrementalPricePnl === null ? previousPricePnl
    : (integer(previousPricePnl) + BigInt(incrementalPricePnl)).toString();
  const priorFees = integer(prior?.feesUnits); const fees = priorFees + BigInt(aggregate.feesUnits);
  const status = afterSize > 0n ? "open" : "closed";
  const orderRef = String(action.orderId ?? row.requestId ?? row.operationId);
  const hashes = mergedList(prior?.transactionHashesJson, String(row.txHash ?? "")).filter(Boolean);
  const next = { userId: row.userId, ownerAddress: row.ownerAddress, summaryId, venueId: row.venueId, marketId,
    symbol: String(details.symbol ?? action.symbol ?? marketId), direction, sizeUnits: entrySize.toString(),
    entrySizeUnits: entrySize.toString(), remainingSizeUnits: afterSize.toString(),
    accountAddress: row.accountAddress, priceDecimals: Number.isInteger(priceDecimals) ? priceDecimals : undefined,
    sizeDecimals: Number.isInteger(sizeDecimals) ? sizeDecimals : undefined,
    ...(entryPrice ? { weightedEntryPrice: entryPrice } : {}),
    ...(exitSize > 0n ? { exitSizeUnits: exitSize.toString(), exitValueNumerator: exitValue.toString(),
      weightedExitPrice: (exitValue / exitSize).toString() } : {}),
    ...(pricePnl !== undefined ? { realizedPricePnlUnits: pricePnl } : {}),
    ...(prior?.entryAt !== undefined ? { entryAt: prior.entryAt } : entry ? { entryAt: finalizedAt } : {}),
    ...(status === "closed" ? { exitAt: finalizedAt } : {}), feesUnits: fees.toString(),
    ...(details.afterPositionFundingUnits !== undefined ? { fundingUnits: String(details.afterPositionFundingUnits) }
      : prior?.fundingUnits !== undefined ? { fundingUnits: prior.fundingUnits }
        : action.preFundingUnits !== undefined ? { fundingUnits: String(action.preFundingUnits) } : {}),
    ...(typeof details.netRealizedPnlUnits === "string" && /^-?\d+$/.test(details.netRealizedPnlUnits)
      ? { netRealizedPnlUnits: details.netRealizedPnlUnits } : {}),
    status, source: "manual", orderIdsJson: JSON.stringify(mergedList(prior?.orderIdsJson, orderRef)),
    transactionHashesJson: JSON.stringify(mergedList(prior?.transactionHashesJson, String(row.txHash ?? "")).filter(Boolean)),
    activityIdsJson: JSON.stringify(mergedList(prior?.activityIdsJson, activityId)),
    createdAt: prior?.createdAt ?? finalizedAt, updatedAt: finalizedAt };
  if (prior) await ctx.db.patch(prior._id, next); else await ctx.db.insert("monadTradeSummaries", next);
}

export type AutonomousTradeEvidence = { event: any; action: any; details: any; response: any; run: any; };

export function perplRunMarket(run: any, marketId: unknown) {
  const parsed = parse(run?.marketsJson);
  const markets = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.markets) ? parsed.markets
    : parsed && typeof parsed === "object" ? Object.values(parsed) : [];
  const numericId = Number(marketId);
  return markets.find((item: any) => [item?.id, item?.marketId, item?.mkt, item?.perpId,
    item?.perp_id, item?.market_id].some((value) => Number.isSafeInteger(Number(value)) && Number(value) === numericId));
}

/** Resolves display precision from the immutable market snapshot captured with an autonomous run. */
export function resolvePerplSummaryMetadata(run: any, action: any, details: any = {}) {
  const market = perplRunMarket(run, action?.marketId);
  const response = details?.response ?? {};
  const symbolOf = (...values: unknown[]) => values.map((value) => String(value ?? "").trim())
    .find((value) => value.length > 0 && !/^\d+$/.test(value));
  const decimalsOf = (...values: unknown[]) => values.map(Number)
    .find((value) => Number.isSafeInteger(value) && value >= 0 && value <= 30);
  return {
    ...(symbolOf(market?.symbol, market?.name, response.symbol, details?.symbol, action?.symbol)
      ? { symbol: symbolOf(market?.symbol, market?.name, response.symbol, details?.symbol, action?.symbol) } : {}),
    ...(decimalsOf(market?.priceDecimals, market?.price_decimals, response.priceDecimals,
      details?.priceDecimals, action?.priceDecimals) !== undefined
      ? { priceDecimals: decimalsOf(market?.priceDecimals, market?.price_decimals, response.priceDecimals,
        details?.priceDecimals, action?.priceDecimals) } : {}),
    ...(decimalsOf(market?.sizeDecimals, market?.size_decimals, market?.szDecimals, market?.sz_decimals,
      response.sizeDecimals, details?.sizeDecimals, action?.sizeDecimals) !== undefined
      ? { sizeDecimals: decimalsOf(market?.sizeDecimals, market?.size_decimals, market?.szDecimals,
        market?.sz_decimals, response.sizeDecimals, details?.sizeDecimals, action?.sizeDecimals) } : {}),
  };
}

/** Applies display metadata after folding so this repair cannot alter calculated PnL evidence. */
export function applyPerplSummaryMetadata(summary: any, metadata: any) {
  return { ...summary, ...(metadata?.symbol ? { symbol: metadata.symbol } : {}),
    ...(metadata?.priceDecimals !== undefined ? { priceDecimals: metadata.priceDecimals } : {}),
    ...(metadata?.sizeDecimals !== undefined ? { sizeDecimals: metadata.sizeDecimals } : {}) };
}

/** Folds verified autonomous spot fills into per-token inventory lifecycles. */
export function foldAutonomousSpotPositions(orders: any[], activityIds: Map<string, string> = new Map()) {
  const symbols = ["MZA", "MZB", "MZG"];
  const ordered = [...orders].sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber)
    || Number(a.finalizedAt) - Number(b.finalizedAt));
  const states = new Map<string, any>(); const completed: any[] = [];
  for (const order of ordered) {
    if (order.status !== "finalized" || order.receiptStatus !== 1 || !/^0x[a-f0-9]{64}$/i.test(String(order.blockHash ?? ""))
        || !["buy", "sell"].includes(String(order.kind)) || !Number.isInteger(order.tokenIndex)
        || order.tokenIndex < 0 || order.tokenIndex > 2 || !/^\d+$/.test(String(order.amountInUnits ?? ""))
        || !/^\d+$/.test(String(order.amountOutUnits ?? "")) || !order.txHash) continue;
    const key = `${order.enrollmentId}:${order.tokenIndex}`; let state = states.get(key);
    const buy = order.kind === "buy"; const baseUnits = BigInt(buy ? order.amountOutUnits : order.amountInUnits);
    const quoteUnits = BigInt(buy ? order.amountInUnits : order.amountOutUnits);
    if (baseUnits <= 0n || quoteUnits <= 0n) continue;
    if (buy && (!state || state.quantity === 0n)) {
      if (state?.entryQuantity > 0n) completed.push(state);
      state = { summaryId: `${order.enrollmentId}:${order.tokenIndex}:${order.orderId}`, runId: order.enrollmentId,
        venueId: "moeazi_mock_pools_testnet", marketId: `${symbols[order.tokenIndex]}_USDC`,
        symbol: `${symbols[order.tokenIndex]}/USDC`, direction: "long", source: "autonomous", quantity: 0n,
        costBasis: 0n, entryQuantity: 0n, entryQuote: 0n, exitQuantity: 0n, exitQuote: 0n,
        pricePnl: 0n, netPnl: 0n, netKnown: true, orderIds: [], transactionHashes: [], activityIds: [],
        entryAt: Number(order.finalizedAt), exitAt: undefined };
      states.set(key, state);
    }
    if (!state || !buy && baseUnits > state.quantity) continue;
    const time = Number(order.finalizedAt);
    if (buy) {
      state.quantity += baseUnits; state.costBasis += quoteUnits;
      state.entryQuantity += baseUnits; state.entryQuote += quoteUnits;
      state.entryAt ??= time;
    } else {
      const soldCost = state.costBasis * baseUnits / state.quantity;
      state.quantity -= baseUnits; state.costBasis -= soldCost;
      state.exitQuantity += baseUnits; state.exitQuote += quoteUnits; state.pricePnl += quoteUnits - soldCost;
      state.exitAt = time;
      if (/^-?\d+$/.test(String(order.realizedProfitLossUnits ?? ""))) state.netPnl += BigInt(order.realizedProfitLossUnits);
      else state.netKnown = false;
    }
    state.orderIds.push(String(order.orderId)); state.transactionHashes.push(String(order.txHash));
    if (activityIds.has(order.orderId)) state.activityIds.push(activityIds.get(order.orderId));
    state.updatedAt = time;
  }
  return [...completed, ...states.values()].filter((row) => row.entryQuantity > 0n).map((row) => ({
    summaryId: row.summaryId, runId: row.runId, venueId: row.venueId, marketId: row.marketId, symbol: row.symbol,
    direction: row.direction, source: row.source, status: row.quantity > 0n ? "open" : "closed",
    sizeUnits: row.entryQuantity.toString(), entrySizeUnits: row.entryQuantity.toString(),
    remainingSizeUnits: row.quantity.toString(), exitSizeUnits: row.exitQuantity.toString(),
    priceDecimals: 6, sizeDecimals: 18,
    weightedEntryPrice: (row.entryQuote * 10n ** 18n / row.entryQuantity).toString(),
    ...(row.exitQuantity > 0n ? { weightedExitPrice: (row.exitQuote * 10n ** 18n / row.exitQuantity).toString(),
      realizedPricePnlUnits: row.pricePnl.toString(), exitAt: row.exitAt } : {}),
    entryAt: row.entryAt, feesUnits: "0", feesKnown: false,
    ...(row.netKnown && row.exitQuantity > 0n ? { netRealizedPnlUnits: row.netPnl.toString() } : {}),
    orderIds: [...new Set(row.orderIds)], transactionHashes: [...new Set(row.transactionHashes)],
    activityIds: [...new Set(row.activityIds)], updatedAt: row.updatedAt,
  }));
}

export function foldAutonomousPositions(sources: AutonomousTradeEvidence[]) {
  const ordered = [...sources].sort((a, b) => Number(a.event.timestamp) - Number(b.event.timestamp));
  const open = new Map<string, any>(); const output: any[] = [];
  for (const source of ordered) {
    const { event, action, details, response, run } = source; const fills = Array.isArray(details.fills) ? details.fills : [];
    if (event.status !== "finalized" || !fills.length || !/^[0-9]+$/.test(String(response.afterPositionSize ?? ""))
        || !["long", "short"].includes(String(action.side))) continue;
    const marketId = String(action.marketId); if (!/^\d+$/.test(marketId)) continue;
    const direction = String(action.side); const key = `${run.runId}:${marketId}:${direction}`;
    const entry = ["market_entry", "limit_entry"].includes(String(action.kind));
    let prior = open.get(key);
    if (!prior || prior.status === "closed") {
      const knownEntryPrice = positiveInteger(entry ? response.afterPositionEntryPrice
        : response.beforePositionEntryPrice ?? action.prePositionEntryPrice)
        ?? (entry ? positiveInteger(aggregateFills(fills).weightedPrice) : null);
      const newLifecycle = !prior || prior.status === "closed";
      if (entry && integer(response.afterPositionSize) <= 0n
          || !entry && newLifecycle && !/^\d+$/.test(String(response.beforePositionSize ?? action.prePositionSize ?? ""))) continue;
      if (!entry && !knownEntryPrice) continue;
      prior = { summaryId: `${run.runId}:${marketId}:${direction}:${event.eventId}`, runId: run.runId,
        venueId: event.venueId, marketId, symbol: String(action.symbol ?? marketId), direction,
        _entrySize: entry ? 0n : integer(response.beforePositionSize ?? action.prePositionSize),
        status: "open", source: "autonomous", feesUnits: "0",
        ...(knownEntryPrice ? { weightedEntryPrice: knownEntryPrice } : {}), _exitValue: 0n,
        _exitSize: 0n, _pricePnl: 0n, orderIds: [], transactionHashes: [], activityIds: [] };
      open.set(key, prior); output.push(prior);
    }
    const aggregate = aggregateFills(fills); const fillSize = BigInt(aggregate.sizeUnits);
    if (fillSize <= 0n) continue;
    const afterSize = integer(response.afterPositionSize);
    if (entry) prior._entrySize += fillSize;
    prior.entrySizeUnits = prior._entrySize.toString(); prior.sizeUnits = prior.entrySizeUnits;
    prior.remainingSizeUnits = afterSize.toString(); prior.status = afterSize > 0n ? "open" : "closed";
    prior.priceDecimals = Number(action.priceDecimals ?? prior.priceDecimals);
    prior.sizeDecimals = Number(action.sizeDecimals ?? prior.sizeDecimals);
    const afterEntry = response.afterPositionEntryPrice;
    if (afterEntry && String(afterEntry) !== "0") prior.weightedEntryPrice = String(afterEntry);
    if (entry && !prior.entryAt) prior.entryAt = Number(event.timestamp);
    if (!entry) {
      const value = priceValue(fills); prior._exitValue += value; prior._exitSize += fillSize;
      if (prior._exitSize > 0n) prior.weightedExitPrice = (prior._exitValue / prior._exitSize).toString();
      if (prior.weightedEntryPrice) {
        const pnl = grossExitPnlCns(fills, prior.weightedEntryPrice, direction as "long" | "short",
          prior.priceDecimals, prior.sizeDecimals);
        if (pnl !== null) prior._pricePnl += BigInt(pnl);
      }
      prior.exitSizeUnits = prior._exitSize.toString();
      prior.realizedPricePnlUnits = prior._pricePnl.toString();
      if (prior.status === "closed") prior.exitAt = Number(event.timestamp);
    }
    if (afterSize > 0n && response.afterPositionFundingUnits !== undefined) prior.fundingUnits = String(response.afterPositionFundingUnits);
    else if (prior.fundingUnits === undefined && action.prePositionFundingUnits !== undefined) prior.fundingUnits = String(action.prePositionFundingUnits);
    prior.feesUnits = (integer(prior.feesUnits) + BigInt(aggregate.feesUnits)).toString();
    prior.orderIds = [...new Set([...prior.orderIds, String(details.requestId ?? action.requestId ?? event.orderId ?? "")].filter(Boolean))];
    prior.transactionHashes = [...new Set([...prior.transactionHashes, String(event.txHash ?? "")].filter(Boolean))];
    prior.activityIds = [...new Set([...prior.activityIds, String(event.eventId)])];
  }
  return output.map(({ _entrySize: _d, _exitValue: _a, _exitSize: _b, _pricePnl: _c, ...row }) => row);
}
