import { getAddress, Interface } from "ethers";
import { ADAPTER_ABI, DYNAMIC_V4_ADAPTER_ABI, MONAD_CHAIN_ID, USDC_ADDRESS, WMON_ADDRESS } from "./constants.js";
import { configuredDynamicV4Adapter } from "./config.js";
import { AUTONOMY_POOL_ABI } from "./autonomyChain.js";
import { finalizedBlockNumber } from "./provider.js";
import { isNoHook, poolKeysEqual, v4MarketId, v4PoolId, type PoolKey } from "./v4PoolIndex.js";

const transfer = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const adapters = new Interface(ADAPTER_ABI); const dynamicAdapters = new Interface(DYNAMIC_V4_ADAPTER_ABI);
const pools = new Interface(AUTONOMY_POOL_ABI);
const uint = (value: unknown) => /^\d+$/.test(String(value ?? "")) ? BigInt(String(value)) : null;
const lower = (value: unknown) => String(value ?? "").toLowerCase();

function transferTotals(receipt: any, token: string, owner: string) {
  let spent = 0n; let received = 0n;
  for (const log of receipt.logs ?? []) {
    if (lower(log.address) !== lower(token)) continue;
    try {
      const parsed = transfer.parseLog(log);
      if (parsed && lower(parsed.args.from) === lower(owner)) spent += BigInt(parsed.args.value);
      if (parsed && lower(parsed.args.to) === lower(owner)) received += BigInt(parsed.args.value);
    } catch { /* ignore non-Transfer logs */ }
  }
  return { spent, received };
}

/** Revalidates a saved Mera wallet swap against canonical finality and receipt transfers. */
export async function verifySpotSwapHistory(provider: any, ownerValue: string, candidate: any, checkpoint?: number) {
  const intent = candidate.intent ?? {}; const txHash = String(candidate.txHash ?? "");
  if (!/^0x[a-f0-9]{64}$/i.test(txHash) || !candidate.transaction
      || !Number.isSafeInteger(candidate.finalizedBlockNumber) || candidate.finalizedBlockNumber <= 0
      || !Number.isSafeInteger(candidate.blockNumber) || !/^0x[a-f0-9]{64}$/i.test(String(candidate.blockHash ?? ""))) return null;
  let owner: string; let tokenIn: string; let tokenOut: string;
  try { owner = getAddress(ownerValue); tokenIn = getAddress(intent.tokenIn); tokenOut = getAddress(intent.tokenOut); }
  catch { return null; }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) return null;
  const amountIn = uint(intent.amountInUnits); const minOut = uint(intent.minAmountOutUnits);
  if (amountIn === null || minOut === null || amountIn <= 0n || minOut <= 0n) return null;
  const venue = String(candidate.venueId); if (intent.venue !== venue) return null;
  let expectedTo: string; try { expectedTo = getAddress(String(candidate.transaction.to ?? "")); } catch { return null; }
  const dynamicV4 = venue === "uniswap_v4_testnet" && typeof intent.poolId === "string";
  let parsed: any; let marketId = "WMON_USDC"; let inputDecimals = tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18;
  let outputDecimals = tokenOut.toLowerCase() === USDC_ADDRESS.toLowerCase() ? 6 : 18;
  if (dynamicV4) {
    let expectedAdapter: string;
    try { expectedAdapter = getAddress(configuredDynamicV4Adapter() ?? ""); } catch { return null; }
    if (expectedTo.toLowerCase() !== expectedAdapter.toLowerCase()) return null;
    parsed = dynamicAdapters.parseTransaction({ data: String(candidate.transaction.data) });
    if (parsed?.name !== "swap") return null;
    const poolId = lower(parsed.args[0]); const keyArgs = parsed.args[1];
    const key: PoolKey = { currency0: getAddress(keyArgs.currency0), currency1: getAddress(keyArgs.currency1),
      fee: Number(keyArgs.fee), tickSpacing: Number(keyArgs.tickSpacing), hooks: getAddress(keyArgs.hooks) };
    if (poolId !== lower(intent.poolId) || poolId !== v4PoolId(key) || !isNoHook(key)
        || !poolKeysEqual(intent.poolKey, key) || ![key.currency0.toLowerCase(), key.currency1.toLowerCase()].includes(tokenIn.toLowerCase())
        || ![key.currency0.toLowerCase(), key.currency1.toLowerCase()].includes(tokenOut.toLowerCase())
        || v4MarketId(poolId) !== intent.marketId) return null;
    inputDecimals = Number(intent.inputDecimals); outputDecimals = Number(intent.outputDecimals);
    if (!Number.isSafeInteger(inputDecimals) || inputDecimals < 0 || inputDecimals > 36
        || !Number.isSafeInteger(outputDecimals) || outputDecimals < 0 || outputDecimals > 36) return null;
    marketId = String(intent.marketId);
  } else if (venue === "moeazi_mock_pools_testnet") {
    if (!/^MZ[ABG]_USDC$/.test(String(intent.marketId)) || lower(intent.poolAddress) !== lower(expectedTo)) return null;
  } else {
    if (!new Set(["uniswap_v4_testnet", "moeazi_test_amm"]).has(venue)
        || !new Set([USDC_ADDRESS.toLowerCase(), WMON_ADDRESS.toLowerCase()]).has(tokenIn.toLowerCase())
        || !new Set([USDC_ADDRESS.toLowerCase(), WMON_ADDRESS.toLowerCase()]).has(tokenOut.toLowerCase())) return null;
  }
  if (!dynamicV4) {
    parsed = (venue === "moeazi_mock_pools_testnet" ? pools : adapters).parseTransaction({ data: String(candidate.transaction.data) });
    if (parsed?.name !== "swap" || lower(parsed.args[0]) !== tokenIn.toLowerCase()
        || lower(parsed.args[1]) !== tokenOut.toLowerCase() || BigInt(parsed.args[2]) !== amountIn
        || BigInt(parsed.args[3]) !== minOut) return null;
  } else if (lower(parsed.args[2]) !== tokenIn.toLowerCase() || lower(parsed.args[3]) !== tokenOut.toLowerCase()
      || BigInt(parsed.args[4]) !== amountIn || BigInt(parsed.args[5]) !== minOut) return null;
  const [receipt, tx, finalized] = await Promise.all([provider.getTransactionReceipt(txHash), provider.getTransaction(txHash),
    checkpoint === undefined ? finalizedBlockNumber(provider) : Promise.resolve(checkpoint)]);
  if (!receipt || receipt.status !== 1 || receipt.blockNumber !== candidate.blockNumber
      || receipt.blockNumber > candidate.finalizedBlockNumber || receipt.blockNumber > finalized
      || lower(receipt.blockHash) !== lower(candidate.blockHash) || !tx || lower(tx.from) !== owner.toLowerCase()
      || tx.chainId !== BigInt(MONAD_CHAIN_ID) || tx.value !== 0n
      || lower(tx.to) !== expectedTo.toLowerCase() || lower(tx.data) !== lower(candidate.transaction.data)
      || tx.nonce !== Number(candidate.transaction.nonce)) return null;
  const canonical = await provider.getBlock(receipt.blockNumber);
  if (!canonical || lower(canonical.hash) !== lower(receipt.blockHash)
      || !Number.isSafeInteger(Number(canonical.timestamp)) || Number(canonical.timestamp) <= 0) return null;
  const input = transferTotals(receipt, tokenIn, owner); const output = transferTotals(receipt, tokenOut, owner);
  if (input.spent !== amountIn || output.received < minOut || output.received <= 0n) return null;
  if (!dynamicV4) marketId = venue === "moeazi_mock_pools_testnet" ? String(intent.marketId) : "WMON_USDC";
  const quoteToken = [tokenIn, tokenOut].some((token) => token.toLowerCase() === USDC_ADDRESS.toLowerCase())
    ? USDC_ADDRESS : WMON_ADDRESS;
  const symbol = dynamicV4 ? marketId : marketId.replace("_USDC", "");
  const buying = tokenOut.toLowerCase() !== quoteToken.toLowerCase();
  const quoteUnits = buying ? input.spent : output.received; const baseUnits = buying ? output.received : input.spent;
  const quoteDecimals = buying ? inputDecimals : outputDecimals; const baseDecimals = buying ? outputDecimals : inputDecimals;
  const exponent = baseDecimals + 6 - quoteDecimals;
  const priceNumerator = exponent >= 0 ? quoteUnits * 10n ** BigInt(exponent) : quoteUnits;
  const priceDenominator = exponent >= 0 ? baseUnits : baseUnits * 10n ** BigInt(-exponent);
  const priceUnits = priceNumerator / priceDenominator;
  if (priceUnits <= 0n) return null;
  return { activityId: String(candidate.activityId), txHash, venueId: venue, marketId, symbol: `${symbol}/USDC`,
    kind: buying ? "buy" : "sell", quoteUnits: quoteUnits.toString(), baseUnits: baseUnits.toString(),
    priceUnits: priceUnits.toString(), blockNumber: Number(receipt.blockNumber), transactionIndex: Number(receipt.index ?? 0),
    occurredAt: Number(canonical.timestamp) * 1000, priceDecimals: 6, sizeDecimals: baseDecimals };
}

/** Buckets actual finalized prices into OHLC candles; it never fills missing intervals. */
export function buildSpotCandles(points: any[], resolutionSeconds: number, from: number, to: number) {
  const width = resolutionSeconds * 1000; const buckets = new Map<number, any>();
  const valid = points.filter((point) => Number.isSafeInteger(Number(point.t)) && Number(point.t) >= from
    && Number(point.t) <= to && /^\d+$/.test(String(point.priceUnits ?? "")) && BigInt(point.priceUnits) > 0n)
    .sort((a, b) => Number(a.t) - Number(b.t) || Number(a.blockNumber ?? 0) - Number(b.blockNumber ?? 0));
  for (const point of valid) {
    const time = Number(point.t); const price = BigInt(point.priceUnits); const bucketTime = Math.floor(time / width) * width;
    const current = buckets.get(bucketTime);
    if (!current) buckets.set(bucketTime, { t: bucketTime, o: price, h: price, l: price, c: price,
      v: uint(point.quoteUnits) ?? 0n, n: 1 });
    else { current.h = price > current.h ? price : current.h; current.l = price < current.l ? price : current.l;
      current.c = price; current.v += (uint(point.quoteUnits) ?? 0n); current.n += 1; }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t).map((row) => ({ t: row.t, o: row.o.toString(),
    h: row.h.toString(), l: row.l.toString(), c: row.c.toString(), v: row.v.toString(), n: row.n }));
}

/** Builds weighted-cost lifecycle summaries only where every close has a known entry. */
export function foldWalletSpotPositions(trades: any[]) {
  const ordered = [...trades].sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex);
  const open = new Map<string, any>(); const closed: any[] = [];
  for (const trade of ordered) {
    const key = `${trade.venueId}:${trade.marketId}`; let row = open.get(key);
    const quantity = uint(trade.baseUnits); const quote = uint(trade.quoteUnits);
    if (quantity === null || quote === null || quantity <= 0n || quote <= 0n) continue;
    if (trade.kind === "buy") {
      if (!row) row = { summaryId: `wallet:${key}:${trade.txHash}`, venueId: trade.venueId, marketId: trade.marketId,
        symbol: trade.symbol, direction: "long", source: "manual", priceDecimals: trade.priceDecimals ?? 6,
        sizeDecimals: trade.sizeDecimals ?? 18, quantity: 0n, cost: 0n, entryQuantity: 0n,
        entryQuote: 0n, exitQuantity: 0n, exitQuote: 0n, pricePnl: 0n, entryAt: trade.occurredAt,
        orderIds: [], transactionHashes: [], activityIds: [], runId: undefined };
      row.quantity += quantity; row.cost += quote; row.entryQuantity += quantity; row.entryQuote += quote;
      row.entryAt ??= trade.occurredAt; open.set(key, row);
    } else {
      if (!row || quantity > row.quantity) continue;
      const costSold = row.cost * quantity / row.quantity;
      row.quantity -= quantity; row.cost -= costSold; row.exitQuantity += quantity; row.exitQuote += quote;
      row.pricePnl += quote - costSold; row.exitAt = trade.occurredAt;
    }
    row.orderIds.push(trade.activityId); row.transactionHashes.push(trade.txHash); row.activityIds.push(trade.activityId);
    row.updatedAt = trade.occurredAt;
    if (row.quantity === 0n && row.exitQuantity > 0n) { closed.push(row); open.delete(key); }
  }
  return [...closed, ...open.values()].map((row) => ({ summaryId: row.summaryId, venueId: row.venueId,
    marketId: row.marketId, symbol: row.symbol, direction: row.direction, source: row.source,
    status: row.quantity > 0n ? "open" : "closed", sizeUnits: row.entryQuantity.toString(),
    entrySizeUnits: row.entryQuantity.toString(), remainingSizeUnits: row.quantity.toString(),
    exitSizeUnits: row.exitQuantity.toString(), priceDecimals: row.priceDecimals ?? 6, sizeDecimals: row.sizeDecimals ?? 18,
    weightedEntryPrice: (row.entryQuote * 10n ** 18n / row.entryQuantity).toString(),
    ...(row.exitQuantity > 0n ? { weightedExitPrice: (row.exitQuote * 10n ** 18n / row.exitQuantity).toString(),
      realizedPricePnlUnits: row.pricePnl.toString(), exitAt: row.exitAt } : {}),
    entryAt: row.entryAt, feesUnits: "0", feesKnown: false, orderIds: [...new Set(row.orderIds)],
    transactionHashes: [...new Set(row.transactionHashes)], activityIds: [...new Set(row.activityIds)], updatedAt: row.updatedAt }));
}
