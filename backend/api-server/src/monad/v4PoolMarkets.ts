import { Contract, formatUnits, getAddress } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { configuredDynamicV4Adapter, MonadApiError } from "./config.js";
import { USDC_ADDRESS, USDC_DECIMALS, V4_QUOTER_ABI, V4_QUOTER_ADDRESS, WMON_ADDRESS, WMON_DECIMALS } from "./constants.js";
import { finalizedBlockNumber, requireContractCode } from "./provider.js";
import { findV4Pool, listV4PoolRecords, normalizePoolId, v4MarketId, v4PoolKey, type V4PoolRecord } from "./v4PoolIndex.js";

const TOKEN_ABI = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function tokenMetadata(provider: JsonRpcProvider, addressValue: string, checkpoint: number) {
  const address = getAddress(addressValue);
  if (address.toLowerCase() === USDC_ADDRESS.toLowerCase()) return { address, symbol: "USDC", decimals: USDC_DECIMALS };
  if (address.toLowerCase() === WMON_ADDRESS.toLowerCase()) return { address, symbol: "WMON", decimals: WMON_DECIMALS };
  try {
    await requireContractCode(provider, address, "Pool token");
    const token = new Contract(address, TOKEN_ABI, provider);
    const [rawSymbol, rawDecimals] = await Promise.all([
      token.symbol({ blockTag: checkpoint }), token.decimals({ blockTag: checkpoint }),
    ]);
    const symbolValue = String(rawSymbol).trim(); const decimals = Number(rawDecimals);
    if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("bad decimals");
    const symbol = /^[A-Za-z0-9._-]{1,20}$/.test(symbolValue) ? symbolValue : `TOKEN_${address.slice(2, 6).toUpperCase()}`;
    return { address, symbol, decimals };
  } catch {
    return { address, symbol: `TOKEN_${address.slice(2, 6).toUpperCase()}`, decimals: null as number | null };
  }
}

export async function v4TokenDecimals(provider: JsonRpcProvider, addressValue: string, checkpoint: number) {
  const metadata = await tokenMetadata(provider, addressValue, checkpoint);
  if (metadata.decimals === null) throw new MonadApiError("Pool token decimals could not be verified on Monad Testnet.",
    409, "pool_token_metadata_unavailable");
  return metadata.decimals;
}

function marketAssets(record: V4PoolRecord, a: any, b: any) {
  const hasUsdc = [a.address, b.address].some((address) => address.toLowerCase() === USDC_ADDRESS.toLowerCase());
  const hasWmon = [a.address, b.address].some((address) => address.toLowerCase() === WMON_ADDRESS.toLowerCase());
  const quote = hasUsdc ? (a.address.toLowerCase() === USDC_ADDRESS.toLowerCase() ? a : b)
    : (a.address.toLowerCase() === WMON_ADDRESS.toLowerCase() ? a : b);
  const base = quote.address.toLowerCase() === a.address.toLowerCase() ? b : a;
  const toAsset = (asset: any) => ({ id: asset.symbol, symbol: asset.symbol, address: asset.address, decimals: asset.decimals,
    metadataAvailable: asset.decimals !== null });
  return { baseAsset: toAsset(base), quoteAsset: toAsset(quote), base, quote,
    symbol: `${base.symbol}/${quote.symbol}`, name: `${base.symbol} / ${quote.symbol}`,
    pairType: hasUsdc ? "USDC" : hasWmon ? "WMON" : "unsupported" };
}

async function directQuote(provider: JsonRpcProvider, record: V4PoolRecord, tokenIn: string, tokenOut: string,
  amountIn: bigint, checkpoint: number) {
  const key = v4PoolKey(record);
  const quoter = new Contract(V4_QUOTER_ADDRESS, V4_QUOTER_ABI, provider);
  const zeroForOne = tokenIn.toLowerCase() === key.currency0.toLowerCase();
  const result: any = await quoter.quoteExactInputSingle.staticCall({
    poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x",
  }, { blockTag: checkpoint });
  const amountOut = BigInt(result[0]); const block = await provider.getBlock(checkpoint);
  const observedAt = block ? Number(block.timestamp) * 1000 : 0;
  return { amountOut, checkpoint, observedAt };
}

export async function buildV4MarketRow(provider: JsonRpcProvider, record: V4PoolRecord) {
  const checkpoint = await finalizedBlockNumber(provider);
  const [a, b] = await Promise.all([tokenMetadata(provider, record.currency0, checkpoint), tokenMetadata(provider, record.currency1, checkpoint)]);
  const assets = marketAssets(record, a, b); const hooks = record.hooks.toLowerCase();
  const noHook = hooks === ZERO_ADDRESS; const supportedAnchor = assets.pairType !== "unsupported";
  const poolKey = v4PoolKey(record); const poolId = normalizePoolId(record.poolId);
  const indexHasTokenDecimals = a.decimals !== null && b.decimals !== null;
  let buy: any = null; let sell: any = null; let quoteError: string | undefined;
  if (supportedAnchor && indexHasTokenDecimals) {
    const quoteDecimals = assets.quote.decimals!; const baseDecimals = assets.base.decimals!;
    // Small executable probes avoid presenting severe one-token price impact as the unit price.
    const buyUnit = 10n ** BigInt(quoteDecimals); const sellUnit = 10n ** BigInt(baseDecimals);
    const buyAmount = buyUnit >= 100n ? buyUnit / 100n : 1n;
    const sellAmount = sellUnit >= 100n ? sellUnit / 100n : 1n;
    const results = await Promise.allSettled([
      directQuote(provider, record, assets.quote.address, assets.base.address, buyAmount, checkpoint),
      directQuote(provider, record, assets.base.address, assets.quote.address, sellAmount, checkpoint),
    ]);
    const toQuote = (item: any, amountIn: bigint, inputDecimals: number, outputDecimals: number) => {
      if (item.status !== "fulfilled" || item.value.amountOut <= 0n) return null;
      const value = item.value;
      const fresh = Number.isSafeInteger(value.observedAt) && value.observedAt > 0
        && value.observedAt <= Date.now() + 5_000 && Date.now() - value.observedAt <= 60_000;
      return fresh ? { amountInUnits: amountIn.toString(), amountOutUnits: value.amountOut.toString(),
        inputDecimals, outputDecimals, observedAt: value.observedAt, blockNumber: value.checkpoint } : null;
    };
    buy = toQuote(results[0], buyAmount, quoteDecimals, baseDecimals);
    sell = toQuote(results[1], sellAmount, baseDecimals, quoteDecimals);
    if (!buy || !sell) quoteError = results.some((item: any) => item.status === "rejected")
      ? "v4_pool_quote_unavailable" : "v4_pool_liquidity_stale_or_insufficient";
  } else quoteError = !supportedAnchor ? "v4_pool_pair_unsupported" : "pool_token_metadata_unavailable";
  const quoteAvailable = Boolean(buy || sell);
  const walletEnabled = process.env.MONAD_TESTNET_ACTIONS_ENABLED?.trim().toLowerCase() === "true"
    && process.env.MONAD_TESTNET_BROADCAST_ENABLED?.trim().toLowerCase() === "true";
  const adapterConfigured = Boolean(configuredDynamicV4Adapter());
  const executable = noHook && supportedAnchor && indexHasTokenDecimals && adapterConfigured;
  const quote = quoteAvailable ? { price: sell ? formatUnits(BigInt(sell.amountOutUnits)
    * (10n ** BigInt(assets.base.decimals!)) / BigInt(sell.amountInUnits), assets.quote.decimals!) : null,
    basePerQuote: buy ? formatUnits(BigInt(buy.amountOutUnits)
      * (10n ** BigInt(assets.quote.decimals!)) / BigInt(buy.amountInUnits), assets.base.decimals!) : null,
    buy, sell, observedAt: Math.max(Number(buy?.observedAt ?? 0), Number(sell?.observedAt ?? 0)),
    blockNumber: Math.min(Number(buy?.blockNumber ?? Number.MAX_SAFE_INTEGER), Number(sell?.blockNumber ?? Number.MAX_SAFE_INTEGER)) }
    : null;
  const reason = quoteAvailable ? !noHook ? "Hook pools are displayed for market data and cannot be traded through the reviewed route."
    : !adapterConfigured ? "The generic no-hook adapter is not configured for executable swaps." : undefined
    : quoteError;
  return { kind: "spot", venueId: "uniswap_v4_testnet", marketId: v4MarketId(poolId), displayName: "Uniswap v4 Testnet",
    symbol: assets.symbol, name: assets.name, status: quoteAvailable ? "open" : "unavailable", available: quoteAvailable,
    chainId: 10143, testOnly: true, poolId, poolKey, hooks: getAddress(record.hooks), verified: record.verified,
    verificationSource: record.verificationSource, ...(record.verificationEvidence ? { verificationEvidence: record.verificationEvidence } : {}),
    initializedBlock: record.initializedBlock, readOnly: !noHook,
    unverifiedPoolWarning: !record.verified, ...(reason ? { reason } : {}),
    baseAsset: assets.baseAsset, quoteAsset: assets.quoteAsset, quote,
    capabilities: { marketData: true, buy: executable && walletEnabled && Boolean(buy), sell: executable && walletEnabled && Boolean(sell),
      walletSwap: executable && walletEnabled, poolBoundSwap: executable && walletEnabled, manualLongShort: false },
  };
}

export async function resolveV4Markets(provider: JsonRpcProvider, queryValue: unknown) {
  if (typeof queryValue !== "string") throw new MonadApiError("Enter a token contract address or v4 PoolId.", 400, "v4_lookup_invalid");
  const query = queryValue.trim(); let records: V4PoolRecord[] = [];
  if (/^0x[a-f0-9]{64}$/i.test(query)) {
    const row = await findV4Pool(query);
    if (row) records = [row];
  } else {
    let token: string;
    try { token = getAddress(query); } catch { throw new MonadApiError("Enter a valid token contract address or v4 PoolId.", 400, "v4_lookup_invalid"); }
    const indexed = await listV4PoolRecords();
    records = indexed.pools.filter((row) => row.currency0.toLowerCase() === token.toLowerCase()
      || row.currency1.toLowerCase() === token.toLowerCase());
    records.sort((left, right) => Number(right.verified) - Number(left.verified) || right.initializedBlock - left.initializedBlock);
    records = records.slice(0, 50);
  }
  const markets = await Promise.all(records.map((record) => buildV4MarketRow(provider, record)));
  const index = (await listV4PoolRecords()).index;
  return { markets, index };
}
