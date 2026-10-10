import { getAddress, Interface } from "ethers";
import { ADAPTER_ABI, MONAD_CHAIN_ID, USDC_ADDRESS, WMON_ADDRESS } from "./constants.js";
import { AUTONOMY_POOL_ABI } from "./autonomyChain.js";
import { finalizedBlockNumber } from "./provider.js";

const transfer = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const adapters = new Interface(ADAPTER_ABI); const pools = new Interface(AUTONOMY_POOL_ABI);
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
  if (venue === "moeazi_mock_pools_testnet") {
    if (!/^MZ[ABG]_USDC$/.test(String(intent.marketId)) || lower(intent.poolAddress) !== lower(expectedTo)) return null;
  } else {
    if (!new Set(["uniswap_v4_testnet", "moeazi_test_amm"]).has(venue)
        || !new Set([USDC_ADDRESS.toLowerCase(), WMON_ADDRESS.toLowerCase()]).has(tokenIn.toLowerCase())
        || !new Set([USDC_ADDRESS.toLowerCase(), WMON_ADDRESS.toLowerCase()]).has(tokenOut.toLowerCase())) return null;
  }
  const parsedTx = (venue === "moeazi_mock_pools_testnet" ? pools : adapters).parseTransaction({ data: String(candidate.transaction.data) });
  if (parsedTx?.name !== "swap" || lower(parsedTx.args[0]) !== tokenIn.toLowerCase()
      || lower(parsedTx.args[1]) !== tokenOut.toLowerCase() || BigInt(parsedTx.args[2]) !== amountIn
      || BigInt(parsedTx.args[3]) !== minOut) return null;
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
  const marketId = venue === "moeazi_mock_pools_testnet" ? String(intent.marketId) : "WMON_USDC";
  const symbol = marketId.replace("_USDC", ""); const buying = tokenOut.toLowerCase() !== USDC_ADDRESS.toLowerCase();
  const quoteUnits = buying ? input.spent : output.received; const baseUnits = buying ? output.received : input.spent;
  return { activityId: String(candidate.activityId), txHash, venueId: venue, marketId, symbol: `${symbol}/USDC`,
    kind: buying ? "buy" : "sell", quoteUnits: quoteUnits.toString(), baseUnits: baseUnits.toString(),
    priceUnits: (quoteUnits * 10n ** 18n / baseUnits).toString(),
    blockNumber: Number(receipt.blockNumber), transactionIndex: Number(receipt.index ?? 0),
    occurredAt: Number(canonical.timestamp) * 1000, priceDecimals: 6, sizeDecimals: 18 };
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
        symbol: trade.symbol, direction: "long", source: "manual", quantity: 0n, cost: 0n, entryQuantity: 0n,
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
    exitSizeUnits: row.exitQuantity.toString(), priceDecimals: 6, sizeDecimals: 18,
    weightedEntryPrice: (row.entryQuote * 10n ** 18n / row.entryQuantity).toString(),
    ...(row.exitQuantity > 0n ? { weightedExitPrice: (row.exitQuote * 10n ** 18n / row.exitQuantity).toString(),
      realizedPricePnlUnits: row.pricePnl.toString(), exitAt: row.exitAt } : {}),
    entryAt: row.entryAt, feesUnits: "0", feesKnown: false, orderIds: [...new Set(row.orderIds)],
    transactionHashes: [...new Set(row.transactionHashes)], activityIds: [...new Set(row.activityIds)], updatedAt: row.updatedAt }));
}
