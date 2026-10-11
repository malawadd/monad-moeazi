import { Contract, formatUnits, getAddress } from "ethers";
import { Hono } from "hono";
import { meraQuery } from "./convex.js";
import { requireMera, routeError } from "./auth.js";
import { configuredAdapter, configuredAutonomyFactory, MonadApiError, venueData } from "./config.js";
import { ADAPTER_ABI, MONAD_CHAIN_ID, USDC_ADDRESS, WMON_ADDRESS } from "./constants.js";
import { monadProvider, finalizedBlockNumber, requireContractCode } from "./provider.js";
import { AUTONOMY_POOL_ABI, readAutonomyDeployment, readAutonomyManifest } from "./autonomyChain.js";
import { foldWalletSpotPositions, verifySpotSwapHistory } from "./spotTradeHistory.js";
import { spotMarketDetail } from "./spotMarketDetail.js";
import { PERPL_DIRECT_VENUE_ID, PERPL_CHAIN_ID, PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE,
  PerplApiError } from "./perplConfig.js";
import { PerplApiClient } from "./perplApi.js";
import { readPerplContext } from "./perplContext.js";
import { listV4PoolRecords, scheduleV4PoolIndexScan, seedV4Pool } from "./v4PoolIndex.js";
import { buildV4MarketRow, resolveV4Markets } from "./v4PoolMarkets.js";
import { MANUAL_PERPL_LEVERAGE_CAP, MANUAL_PERPL_SLIPPAGE_CAP_BPS,
  manualPerplMaxOrderUnits } from "./manualPerplLimits.js";

const MOCK_SPOT_VENUE = "moeazi_mock_pools_testnet";
const RESOLUTIONS = new Set([60, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400]);
const int = (value: any, fallback = 0) => Number.isSafeInteger(Number(value)) ? Number(value) : fallback;
const asObject = (value: any) => value && typeof value === "object" ? value : {};

export function perplDirectoryRow(market: any, ticker: any, funding?: any, globalMaxLeverage?: number) {
  const state = asObject(ticker?.d?.[market.id] ?? ticker?.d?.[String(market.id)]);
  const timestamp = int(asObject(state.at).t);
  const blockNumber = int(asObject(state.at).b);
  const fresh = timestamp > 0 && timestamp <= Date.now() + 5_000 && Date.now() - timestamp <= 60_000 && blockNumber > 0;
  const quote = fresh
    && [state.orl, state.mrk, state.lst, state.mid, state.bid, state.ask].every((value) => int(value) > 0)
    ? { oracle: int(state.orl), mark: int(state.mrk), last: int(state.lst), mid: int(state.mid),
      bid: int(state.bid), ask: int(state.ask), observedAt: timestamp, blockNumber } : undefined;
  const isOpen = Boolean(market.isOpen);
  return { kind: "perpl", venueId: PERPL_DIRECT_VENUE_ID, marketId: String(market.id),
    displayName: "Perpl Testnet", symbol: String(market.symbol), name: String(market.name ?? market.symbol),
    status: isOpen ? "open" : "closed", marketOpen: isOpen, quoteAvailable: Boolean(isOpen && quote),
    available: Boolean(isOpen && quote),
    chainId: PERPL_CHAIN_ID, testOnly: true, priceDecimals: int(market.priceDecimals), sizeDecimals: int(market.sizeDecimals),
    maxLeverage: int(market.maxLeverage), initialMarginBps: int(market.initialMarginBps),
    maintenanceMarginBps: int(market.maintenanceMarginBps), minPostingUnits: String(market.minPostingUnits ?? "0"),
    makerFeeMicros: int(market.makerFeeMicros), takerFeeMicros: int(market.takerFeeMicros),
    maxMarketSlippageBps: int(market.maxMarketSlippageBps),
    manualMaxOrderUnits: manualPerplMaxOrderUnits().toString(),
    manualMaxLeverage: Math.min(MANUAL_PERPL_LEVERAGE_CAP, int(market.maxLeverage),
      Number.isSafeInteger(globalMaxLeverage) ? Number(globalMaxLeverage) : int(market.maxLeverage)),
    manualMaxSlippageBps: MANUAL_PERPL_SLIPPAGE_CAP_BPS,
    capabilities: { marketData: Boolean(quote), buy: false, sell: false, manualLongShort: Boolean(isOpen && quote) },
    ...(quote ? { quote } : { quote: null, reason: isOpen ? "perpl_ticker_stale" : "Perpl market is closed." }),
    fundingRateMicros: funding?.rate ?? market.fundingRateMicros,
    fundingIntervalSeconds: market.fundingIntervalSeconds ?? null,
    ...(funding?.observedAt ? { fundingObservedAt: funding.observedAt } : {}),
  };
}

async function fundingFor(api: PerplApiClient, market: any) {
  const now = Date.now(); const window = Math.max(86_400_000, int(market.fundingIntervalSeconds) * 2_000);
  try {
    const response: any = await api.publicGet(`/v1/market-data/${market.id}/funding/${now - window}-${now}`);
    const rows = Array.isArray(response?.d) ? response.d : [];
    const latest = rows.filter((row: any) => Number.isSafeInteger(int(row?.rate, Number.NaN)))
      .sort((a: any, b: any) => int(asObject(b?.at).t) - int(asObject(a?.at).t))[0];
    return latest ? { rate: int(latest.rate), observedAt: int(asObject(latest.at).t) } : undefined;
  } catch { return undefined; }
}

let perplCache: { expiresAt: number; rows: any[] } | undefined;
let perplLoading: Promise<any[]> | undefined;
async function readPerplDirectory() {
  if (perplCache && perplCache.expiresAt > Date.now()) return perplCache.rows;
  if (perplLoading) return await perplLoading;
  perplLoading = (async () => {
  const api = new PerplApiClient();
  const context = await readPerplContext(api);
  let ticker: any = {};
  try { ticker = await api.publicGet("/v1/market-data/ticker"); } catch { /* preserve context rows as unavailable */ }
  const rows = context.markets.map((market) => {
    const state = ticker?.d?.[market.id] ?? ticker?.d?.[String(market.id)];
    return perplDirectoryRow(market, state ? { d: { [market.id]: state } } : {}, undefined,
      context.limits.maxLeverage);
  });
  perplCache = { expiresAt: Date.now() + 5_000, rows };
  return rows;
  })();
  try { return await perplLoading; }
  finally { perplLoading = undefined; }
}

function asset(id: string, symbol: string, address: string, decimals: number) {
  return { id, symbol, address: getAddress(address), decimals };
}
function spotActionsEnabled() {
  return process.env.MONAD_TESTNET_ACTIONS_ENABLED?.trim().toLowerCase() === "true"
    && process.env.MONAD_TESTNET_BROADCAST_ENABLED?.trim().toLowerCase() === "true";
}

async function safeV4PoolRecords(verifiedOnly = false) {
  try { return await listV4PoolRecords({ verifiedOnly }); }
  catch {
    return { pools: verifiedOnly ? [seedV4Pool()] : [seedV4Pool()],
      index: { status: "unavailable", scannedThrough: 0, latestBlock: 0 } };
  }
}

async function adapterSpotRows(provider: any) {
  const seed = seedV4Pool();
  return await Promise.all((["uniswap_v4_testnet", "moeazi_test_amm"] as const).map(async (venueId) => {
    const displayName = venueId === "uniswap_v4_testnet" ? "Uniswap v4 Testnet" : "Moeazi Test AMM";
    const adapter = configuredAdapter(venueId);
    const baseAsset = asset("WMON", "WMON", WMON_ADDRESS, 18);
    const quoteAsset = asset("USDC", "USDC", USDC_ADDRESS, 6);
    try {
      if (!adapter) throw new Error("Adapter is not configured.");
      await requireContractCode(provider, adapter, `${displayName} adapter`);
      const contract = new Contract(adapter, ADAPTER_ABI, provider);
      const blockNumber = await finalizedBlockNumber(provider);
      const [buy, sell] = await Promise.all([
        contract.quoteExactInput(USDC_ADDRESS, WMON_ADDRESS, 1_000_000n, venueData(venueId), { blockTag: blockNumber }),
        contract.quoteExactInput(WMON_ADDRESS, USDC_ADDRESS, 10n ** 18n, venueData(venueId), { blockTag: blockNumber }),
      ]);
      const finalized = await provider.getBlock(blockNumber);
      const observedAt = Number(finalized?.timestamp) * 1000;
      const fresh = Number.isSafeInteger(observedAt) && observedAt > 0 && observedAt <= Date.now() + 5_000 && Date.now() - observedAt <= 60_000;
      const available = fresh && Boolean(buy[1] && sell[1]) && BigInt(buy[0]) > 0n && BigInt(sell[0]) > 0n;
      return { kind: "spot", venueId, marketId: "WMON_USDC", displayName, symbol: "WMON/USDC", name: "Wrapped MON / USDC",
        status: available ? "open" : "unavailable", available, testOnly: true, chainId: MONAD_CHAIN_ID,
        ...(venueId === "uniswap_v4_testnet" ? { poolId: seed.poolId, poolKey: { currency0: seed.currency0,
          currency1: seed.currency1, fee: seed.fee, tickSpacing: seed.tickSpacing, hooks: seed.hooks }, verified: true,
          verificationSource: seed.verificationSource, unverifiedPoolWarning: false } : {}),
        baseAsset, quoteAsset, capabilities: { marketData: true, buy: available && spotActionsEnabled(), sell: available && spotActionsEnabled(), manualLongShort: false },
        ...(available ? { quote: { price: formatUnits(BigInt(sell[0]), 6), basePerQuote: formatUnits(BigInt(buy[0]), 18),
          buy: { amountInUnits: "1000000", amountOutUnits: String(buy[0]), inputDecimals: 6, outputDecimals: 18 },
          sell: { amountInUnits: "1000000000000000000", amountOutUnits: String(sell[0]), inputDecimals: 18, outputDecimals: 6 },
          observedAt, blockNumber } } : { reason: fresh ? "Testnet pool is unavailable or has insufficient liquidity." : "Finalized spot quote is stale." }),
      };
    } catch {
      return { kind: "spot", venueId, marketId: "WMON_USDC", displayName, symbol: "WMON/USDC", name: "Wrapped MON / USDC",
        status: "unavailable", available: false, testOnly: true, chainId: MONAD_CHAIN_ID, baseAsset, quoteAsset,
        ...(venueId === "uniswap_v4_testnet" ? { poolId: seed.poolId, poolKey: { currency0: seed.currency0,
          currency1: seed.currency1, fee: seed.fee, tickSpacing: seed.tickSpacing, hooks: seed.hooks }, verified: true,
          verificationSource: seed.verificationSource, unverifiedPoolWarning: false } : {}),
        capabilities: { marketData: true, buy: false, sell: false, manualLongShort: false },
        reason: "Testnet adapter is unavailable or the pool has no executable quote." };
    }
  }));
}

async function mockPoolRows(provider: any) {
  const manifest = await readAutonomyManifest();
  const tokens = Array.isArray(manifest?.addresses?.tokens) ? manifest.addresses.tokens : [];
  const usable = manifest?.verified === true && manifest?.deploymentStatus === "verified"
    && Number(manifest?.chainId) === MONAD_CHAIN_ID && tokens.length === 3;
  if (!usable) return [];
  let deployment: any = null;
  try { if (configuredAutonomyFactory()) deployment = await readAutonomyDeployment(provider); } catch { /* keep rows unavailable */ }
  return await Promise.all(tokens.map(async (token: any, index: number) => {
    const symbol = String(token.symbol); const marketId = `${symbol}_USDC`;
    const baseAsset = asset(symbol, symbol, token.address, 18);
    const quoteAsset = asset("USDC", "USDC", USDC_ADDRESS, 6);
    const poolAddress = getAddress(String(token.pool));
    try {
      if (!deployment || String(deployment.pools[index]).toLowerCase() !== poolAddress.toLowerCase()) throw new Error("Unverified pool.");
      const pool = new Contract(poolAddress, AUTONOMY_POOL_ABI, provider);
      const finalized = await provider.getBlock(deployment.checkpoint);
      const observedAt = Number(finalized?.timestamp) * 1000;
      const fresh = Number.isSafeInteger(observedAt) && observedAt > 0 && observedAt <= Date.now() + 5_000 && Date.now() - observedAt <= 60_000;
      const [buy, sell] = await Promise.all([
        pool.quoteExactInput(USDC_ADDRESS, baseAsset.address, 1_000_000n, { blockTag: deployment.checkpoint }),
        pool.quoteExactInput(baseAsset.address, USDC_ADDRESS, 10n ** 18n, { blockTag: deployment.checkpoint }),
      ]);
      const blockNumber = deployment.checkpoint;
      const available = fresh && Boolean(buy[1] && sell[1]) && BigInt(buy[0]) > 0n && BigInt(sell[0]) > 0n;
      return { kind: "spot", venueId: MOCK_SPOT_VENUE, marketId, displayName: `Moeazi ${symbol} Mock Pool`,
        symbol: `${symbol}/USDC`, name: `${token.name} / USDC`, status: available ? "open" : "unavailable", available,
        testOnly: true, chainId: MONAD_CHAIN_ID, poolAddress, baseAsset, quoteAsset,
        capabilities: { marketData: true, buy: available && spotActionsEnabled(), sell: available && spotActionsEnabled(), manualLongShort: false },
        ...(available ? { quote: { price: formatUnits(BigInt(sell[0]), 6), basePerQuote: formatUnits(BigInt(buy[0]), 18),
          buy: { amountInUnits: "1000000", amountOutUnits: String(buy[0]), inputDecimals: 6, outputDecimals: 18 },
          sell: { amountInUnits: "1000000000000000000", amountOutUnits: String(sell[0]), inputDecimals: 18, outputDecimals: 6 },
          observedAt, blockNumber } } : { reason: fresh ? "Mock pool is unavailable or has insufficient liquidity." : "Finalized spot quote is stale." }),
      };
    } catch {
      return { kind: "spot", venueId: MOCK_SPOT_VENUE, marketId, displayName: `Moeazi ${symbol} Mock Pool`,
        symbol: `${symbol}/USDC`, name: `${token.name} / USDC`, status: "unavailable", available: false,
        testOnly: true, chainId: MONAD_CHAIN_ID, poolAddress, baseAsset, quoteAsset,
        capabilities: { marketData: true, buy: false, sell: false, manualLongShort: false },
        reason: "Verified mock pool or executable quote is unavailable." };
    }
  }));
}

let spotCache: { expiresAt: number; rows: any[] } | undefined;
let spotLoading: Promise<any[]> | undefined;
async function readSpotDirectory() {
  if (spotCache && spotCache.expiresAt > Date.now()) return spotCache.rows;
  if (spotLoading) return await spotLoading;
  spotLoading = (async () => {
    let provider: any;
    try { provider = await monadProvider(); } catch { /* rows become unavailable per venue */ }
    try {
      scheduleV4PoolIndexScan();
      const [adapters, mockPools, v4Records] = await Promise.all([
        adapterSpotRows(provider), mockPoolRows(provider), safeV4PoolRecords(true),
      ]);
      const staticUniswap = adapters.find((row: any) => row.venueId === "uniswap_v4_testnet");
      const verifiedPools = v4Records.pools.slice(0, 50);
      let v4Rows: any[] = [];
      if (provider) v4Rows = (await Promise.all(verifiedPools.map(async (record) => {
        try { return await buildV4MarketRow(provider, record); } catch { return null; }
      }))).filter(Boolean);
      if (!v4Rows.some((row: any) => row.marketId === "WMON_USDC") && staticUniswap) v4Rows.unshift(staticUniswap);
      const rows = [...adapters.filter((row: any) => row.venueId !== "uniswap_v4_testnet"), ...v4Rows, ...mockPools];
      spotCache = { expiresAt: Date.now() + 5_000, rows }; return rows;
    } finally { await provider?.destroy(); }
  })();
  try { return await spotLoading; } finally { spotLoading = undefined; }
}

async function directory(context: any) {
  await requireMera(context);
  let perpl: any[] = []; let perplReason: string | undefined;
  try { perpl = await readPerplDirectory(); }
  catch (error) { perplReason = error instanceof PerplApiError ? error.code : "perpl_context_unavailable"; }
  const spot = await readSpotDirectory();
  const v4Index = (await safeV4PoolRecords()).index;
  return context.json({ observedAt: Date.now(), chainId: MONAD_CHAIN_ID,
    v4PoolIndex: v4Index,
    ...(perplReason ? { sources: { perpl: { status: "unavailable", reason: perplReason } } } : {}),
    markets: [...perpl, ...spot] });
}

async function resolvePool(context: any) {
  await requireMera(context);
  const body = asObject(await context.req.json());
  scheduleV4PoolIndexScan();
  const provider = await monadProvider();
  try { return context.json(await resolveV4Markets(provider, body.query)); }
  finally { await provider.destroy(); }
}

function candlesQuery(context: any) {
  const resolution = Number(context.req.query("resolution") ?? "3600");
  const now = Date.now(); const to = Number(context.req.query("to") ?? now);
  const from = Number(context.req.query("from") ?? to - 24 * 60 * 60_000);
  if (!RESOLUTIONS.has(resolution) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from <= 0 || to <= from
    || Math.ceil((to - from) / (resolution * 1000)) > 1024) throw new MonadApiError("Candle range or resolution is invalid.", 400, "market_candle_range_invalid");
  return { resolution, from, to };
}

async function detail(context: any) {
  const auth = await requireMera(context);
  const venueId = context.req.param("venueId"); const marketId = context.req.param("marketId");
  const includeCandles = context.req.query("includeCandles") !== "false";
  if (venueId === MOCK_SPOT_VENUE || venueId === "uniswap_v4_testnet" || venueId === "moeazi_test_amm") {
    const response: any = await directory(context);
    const payload = await response.json();
    const market = payload.markets.find((row: any) => row.venueId === venueId && row.marketId === marketId);
    if (!market) throw new MonadApiError("Market was not found.", 404, "market_not_found");
    return spotMarketDetail(context, auth, market, venueId, marketId, candlesQuery(context), includeCandles);
  }
  if (venueId !== PERPL_DIRECT_VENUE_ID || !/^\d{1,8}$/.test(marketId)) throw new MonadApiError("Market venue or ID is unsupported.", 404, "market_not_found");
  const api = new PerplApiClient(); const parsed = candlesQuery(context); const id = Number(marketId);
  const [venueContext, ticker] = await Promise.all([readPerplContext(api), api.publicGet("/v1/market-data/ticker").catch(() => ({}))]);
  const base = venueContext.markets.find((item) => item.id === id);
  if (!base) throw new MonadApiError("Perpl Testnet market was not found.", 404, "market_not_found");
  const row = perplDirectoryRow(base, ticker, undefined, venueContext.limits.maxLeverage);
  const [bookResult, candleResult, funding] = await Promise.allSettled([
    api.publicGet(`/v1/market-data/${id}/book?levels=100`),
    includeCandles ? api.publicGet(`/v1/market-data/${id}/candles/${parsed.resolution}/${parsed.from}-${parsed.to}`)
      : Promise.resolve(null),
    fundingFor(api, base),
  ]);
  const bookRaw: any = bookResult.status === "fulfilled" ? bookResult.value : null;
  const candleRaw: any = candleResult.status === "fulfilled" ? candleResult.value : null;
  const bookObservedAt = int(asObject(bookRaw?.at).t); const bookBlockNumber = int(bookRaw?.sn);
  const bookFresh = bookObservedAt > 0 && bookObservedAt <= Date.now() + 5_000
    && Date.now() - bookObservedAt <= 60_000 && bookBlockNumber > 0;
  const book = bookRaw && bookFresh ? { bids: (Array.isArray(bookRaw.bid) ? bookRaw.bid : []).map((item: any) => ({ price: int(item.p), size: int(item.s) })),
    asks: (Array.isArray(bookRaw.ask) ? bookRaw.ask : []).map((item: any) => ({ price: int(item.p), size: int(item.s) })),
    observedAt: bookObservedAt, blockNumber: bookBlockNumber } : undefined;
  const candles = includeCandles && Array.isArray(candleRaw?.d) ? candleRaw.d.filter((item: any) => [item.t, item.o, item.h, item.l, item.c].every((value) => Number.isFinite(Number(value))))
    .map((item: any) => ({ t: int(item.t), o: int(item.o), h: int(item.h), l: int(item.l), c: int(item.c), v: String(item.v ?? "0"), n: int(item.n) })) : [];
  const market = { ...row, ...(funding.status === "fulfilled" && funding.value ? { fundingRateMicros: funding.value.rate,
    fundingObservedAt: funding.value.observedAt } : {}) };
  return context.json({ market, ...(book ? { book } : { book: null }), candles, candlesIncluded: includeCandles, resolutionSeconds: parsed.resolution,
    candleTimeUnit: "milliseconds",
    observedAt: Date.now(), unavailable: { book: !book, bookReason: bookRaw && !bookFresh ? "perpl_book_stale" : undefined,
      ...(includeCandles ? { candles: !candleRaw } : {}) } });
}

async function candles(context: any) {
  const auth = await requireMera(context);
  const venueId = context.req.param("venueId"); const marketId = context.req.param("marketId");
  const parsed = candlesQuery(context);
  if ([MOCK_SPOT_VENUE, "uniswap_v4_testnet", "moeazi_test_amm"].includes(venueId)) {
    const response: any = await directory(context); const payload = await response.json();
    const market = payload.markets.find((row: any) => row.venueId === venueId && row.marketId === marketId);
    if (!market) throw new MonadApiError("Market was not found.", 404, "market_not_found");
    return spotMarketDetail(context, auth, market, venueId, marketId, parsed, true);
  }
  if (venueId !== PERPL_DIRECT_VENUE_ID || !/^\d{1,8}$/.test(marketId)) {
    throw new MonadApiError("Market venue or ID is unsupported.", 404, "market_not_found");
  }
  const api = new PerplApiClient(); const id = Number(marketId); const venueContext = await readPerplContext(api);
  const base = venueContext.markets.find((item) => item.id === id);
  if (!base) throw new MonadApiError("Perpl Testnet market was not found.", 404, "market_not_found");
  let raw: any = null;
  try { raw = await api.publicGet(`/v1/market-data/${id}/candles/${parsed.resolution}/${parsed.from}-${parsed.to}`); }
  catch { /* missing candle history remains explicit */ }
  const rows = Array.isArray(raw?.d) ? raw.d.filter((item: any) => [item.t, item.o, item.h, item.l, item.c].every((value) => Number.isFinite(Number(value))))
    .map((item: any) => ({ t: int(item.t), o: int(item.o), h: int(item.h), l: int(item.l), c: int(item.c), v: String(item.v ?? "0"), n: int(item.n) })) : [];
  const market = perplDirectoryRow(base, {}, undefined, venueContext.limits.maxLeverage);
  return context.json({ market, candles: rows, resolutionSeconds: parsed.resolution, candleTimeUnit: "milliseconds",
    candlesUnavailable: rows.length === 0, observedAt: Date.now(), unavailable: { candles: !raw } });
}

async function trades(context: any) {
  const auth = await requireMera(context);
  const venueId = context.req.query("venueId"); const marketId = context.req.query("marketId");
  const runId = context.req.query("runId");
  if (venueId && !/^[a-z0-9_-]{1,80}$/.test(venueId) || marketId && !/^[A-Za-z0-9/_-]{1,80}$/.test(marketId)
      || runId && !/^[A-Za-z0-9._:-]{1,180}$/.test(runId)) {
    throw new MonadApiError("Trade market filter is invalid.", 400, "trade_filter_invalid");
  }
  const rawLimit = Number(context.req.query("limit") ?? 50);
  const limit = Number.isSafeInteger(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
  const result = await meraQuery(auth.token, "monadManual", "getMarketTrades", {
    ...(venueId ? { venueId } : {}), ...(marketId ? { marketId } : {}), ...(runId ? { runId } : {}), limit,
  }) as any;
  const verifiedSpots: any[] = [];
  let provider: any;
  try {
    if (!runId && (result?.spotCandidates?.length ?? 0) > 0) {
      provider = await monadProvider(); const checkpoint = await finalizedBlockNumber(provider);
      const checked = await Promise.allSettled(result.spotCandidates.slice(0, 20).map((candidate: any) =>
        verifySpotSwapHistory(provider, auth.ownerAddress, candidate, checkpoint)));
      for (const item of checked) if (item.status === "fulfilled" && item.value) verifiedSpots.push(item.value);
    }
  } catch { /* missing RPC history does not hide verified Perpl or autonomous summaries */ }
  finally { await provider?.destroy(); }
  const walletSummaries = foldWalletSpotPositions(verifiedSpots).filter((row: any) =>
    (!venueId || row.venueId === venueId) && (!marketId || row.marketId === marketId));
  const spotActivity = verifiedSpots.map((trade) => ({ id: trade.activityId,
    title: `Spot ${trade.kind} finalized`, summary: `${trade.symbol} ${trade.kind} verified from a canonical receipt`,
    status: "finalized", occurredAt: new Date(trade.occurredAt).toISOString(), transactionHash: trade.txHash }));
  const summaries = [...(result?.summaries ?? []), ...walletSummaries]
    .sort((a: any, b: any) => Number(b.exitAt ?? b.entryAt ?? b.updatedAt ?? 0) - Number(a.exitAt ?? a.entryAt ?? a.updatedAt ?? 0))
    .slice(0, limit);
  const activityById = new Map<string, any>();
  for (const item of [...(result?.activity ?? []), ...spotActivity]) {
    const id = String(item?.id ?? ""); if (id && !activityById.has(id)) activityById.set(id, item);
  }
  return context.json({ summaries, activity: [...activityById.values()] });
}

export function registerMarketRoutes(app: Hono<any>) {
  app.get("/api/mobile/markets", (c) => guard(c, directory));
  app.post("/api/mobile/markets/resolve", (c) => guard(c, resolvePool));
  app.get("/api/mobile/markets/:venueId/:marketId/candles", (c) => guard(c, candles));
  app.get("/api/mobile/markets/:venueId/:marketId", (c) => guard(c, detail));
  app.get("/api/mobile/trades", (c) => guard(c, trades));
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
