import { getAddress } from "ethers";
import { PERPL_MAX_LEVERAGE_DEFAULT, PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE,
  PERPL_CHAIN_ID, perplFundingBounds, PerplApiError } from "./perplConfig.js";
import { PerplApiClient } from "./perplApi.js";
import type { VenueLimits, VenueMarket } from "./venueTypes.js";

export type PerplContext = { chainId: number; exchangeAddress: string; instanceId: number; collateralTokenId: number;
  limits: VenueLimits; markets: VenueMarket[]; raw: any };

function object(value: any) { return value && typeof value === "object" ? value : {}; }
function integer(value: any, fallback = 0) { const parsed = Number(value); return Number.isSafeInteger(parsed) ? parsed : fallback; }
function amount(value: any, field: string) {
  const raw = String(value ?? "");
  if (!/^\d+$/.test(raw)) throw new PerplApiError("Perpl Testnet context has invalid " + field + ".", 503, "perpl_context_invalid");
  return raw;
}
function limitLeverage(initialMarginBps: number) {
  return initialMarginBps > 0 ? Math.floor(10_000 / initialMarginBps) : 0;
}

export async function readPerplContext(api = new PerplApiClient()): Promise<PerplContext> {
  const raw: any = await api.publicGet("/v1/pub/context");
  const chainId = integer(object(raw?.chain).chain_id);
  if (chainId !== PERPL_CHAIN_ID) throw new PerplApiError("Perpl API context is not pinned to Monad Testnet chain 10143.", 503, "perpl_wrong_chain");
  const instance = (Array.isArray(raw.instances) ? raw.instances : []).find((row: any) =>
    integer(row.collateral_token_id) > 0 && String(row.address ?? "").toLowerCase() === PERPL_TESTNET_EXCHANGE);
  if (!instance || String(instance.address).toLowerCase() !== PERPL_TESTNET_EXCHANGE) {
    throw new PerplApiError("Perpl Testnet exchange instance differs from the pinned Monad Testnet deployment.", 503, "perpl_exchange_mismatch");
  }
  const token = (Array.isArray(raw.tokens) ? raw.tokens : []).find((row: any) =>
    integer(row.id) === integer(instance.collateral_token_id));
  if (!token || String(token.symbol).toUpperCase() !== "AUSD" || integer(token.decimals) !== 6
    || String(token.address ?? "").toLowerCase() !== PERPL_TESTNET_AUSD) {
    throw new PerplApiError("Perpl Testnet collateral context does not identify the expected six-decimal AUSD token.", 503, "perpl_collateral_mismatch");
  }
  const marketRows = (Array.isArray(raw.markets) ? raw.markets : []).filter((row: any) =>
    integer(row.instance_id) === integer(instance.id));
  if (!marketRows.length || marketRows.some((row: any) => !Number.isSafeInteger(integer(row.id)) || !row.symbol)) {
    throw new PerplApiError("Perpl Testnet context contains no valid markets.", 503, "perpl_markets_unavailable");
  }
  const bounds = perplFundingBounds();
  const markets: VenueMarket[] = marketRows.map((market: any) => {
    const config = object(market.config);
    const initialMarginBps = integer(config.initial_margin);
    const maxLeverage = limitLeverage(initialMarginBps);
    if (maxLeverage < 1 || maxLeverage > 100) throw new PerplApiError("Perpl market leverage configuration is invalid.", 503, "perpl_context_invalid");
    return { id: integer(market.id), symbol: String(market.symbol), name: String(market.name ?? market.symbol),
      isOpen: Boolean(config.is_open), priceDecimals: integer(config.price_decimals), sizeDecimals: integer(config.size_decimals),
      initialMarginBps, maintenanceMarginBps: integer(config.maintenance_margin), maxLeverage,
      maxMarketSlippageBps: integer(market.order_max_market_slippage_bps),
      makerFeeMicros: integer(config.maker_fee), takerFeeMicros: integer(config.taker_fee),
      fundingRateMicros: integer(object(config.funding).rate ?? object(market.funding).rate ?? config.funding_rate),
      fundingIntervalSeconds: integer(object(config.funding).interval_sec ?? object(market.funding).interval_sec
        ?? config.funding_interval_sec ?? market.funding_interval_sec),
      orderTtlBlocks: integer(market.order_ttl_blocks), price: null };
  });
  const minAccountOpenUnits = amount(instance.min_account_open_amount, "minimum account amount");
  const minDepositUnits = amount(instance.min_deposit_amount, "minimum deposit");
  const minWithdrawalUnits = amount(instance.min_withdraw_amount, "minimum withdrawal");
  const marketMax = Math.min(...markets.map((market) => market.maxLeverage));
  const policyLeverage = Number(process.env.MONAD_TESTNET_PERPL_MAX_LEVERAGE ?? PERPL_MAX_LEVERAGE_DEFAULT);
  if (!Number.isSafeInteger(policyLeverage) || policyLeverage < 1 || policyLeverage > 100) {
    throw new PerplApiError("Perpl policy leverage cap is invalid.", 503, "perpl_config_invalid");
  }
  return { chainId, exchangeAddress: getAddress(instance.address), instanceId: integer(instance.id),
    collateralTokenId: integer(instance.collateral_token_id),
    limits: { collateralSymbol: "AUSD", collateralAddress: getAddress(token.address), collateralDecimals: 6,
      minAccountOpenUnits, minDepositUnits, minWithdrawalUnits, minFundingUnits: minAccountOpenUnits,
      maxFundingUnits: bounds.maxUnits.toString(), minDurationSeconds: 60, maxDurationSeconds: 86_400,
      maxLeverage: Math.min(marketMax, policyLeverage) }, markets, raw };
}

export async function readPerplMarkets(api = new PerplApiClient(), marketIds?: number[], withBook = false): Promise<VenueMarket[]> {
  const context = await readPerplContext(api);
  const selected = context.markets.filter((market) => !marketIds || marketIds.includes(market.id));
  if (marketIds && selected.length !== new Set(marketIds).size) {
    throw new PerplApiError("Requested Perpl market is not available on Testnet.", 400, "perpl_market_unknown");
  }
  const ticker: any = await api.publicGet("/v1/market-data/ticker");
  return await Promise.all(selected.map(async (market) => {
    const state = object(ticker?.d?.[market.id] ?? ticker?.d?.[String(market.id)]);
    const timestamp = integer(object(state.at).t);
    if (!timestamp || !integer(object(state.at).b)) throw new PerplApiError("Perpl market state is not available.", 503, "perpl_market_state_unavailable", true);
    const price = { oracle: integer(state.orl), mark: integer(state.mrk), last: integer(state.lst), mid: integer(state.mid),
      bid: integer(state.bid), ask: integer(state.ask), blockNumber: integer(object(state.at).b), observedAt: timestamp };
    if ([price.oracle, price.mark, price.last, price.bid, price.ask].some((value) => value <= 0)) {
      throw new PerplApiError("Perpl market returned an invalid executable price.", 503, "perpl_market_state_invalid");
    }
    let updated: VenueMarket = { ...market, price };
    if (!withBook) return updated;
    const funding = await latestFunding(api, market);
    updated = { ...updated, fundingRateMicros: funding?.rate, fundingObservedAt: funding?.observedAt };
    const book: any = await api.publicGet("/v1/market-data/" + market.id + "/book?levels=100");
    return { ...updated, book: { blockNumber: integer(book?.sn), observedAt: integer(object(book?.at).t),
      bids: (Array.isArray(book?.bid) ? book.bid : []).map((row: any) => ({ price: integer(row.p), size: integer(row.s) })),
      asks: (Array.isArray(book?.ask) ? book.ask : []).map((row: any) => ({ price: integer(row.p), size: integer(row.s) })) } };
  }));
}

async function latestFunding(api: PerplApiClient, market: VenueMarket): Promise<{rate: number; observedAt: number} | null> {
  const now = Date.now(); const interval = Number(market.fundingIntervalSeconds ?? 0);
  const from = now - Math.max(24 * 60 * 60_000, Number.isSafeInteger(interval) && interval > 0 ? interval * 2 * 1_000 : 0);
  try {
    const response: any = await api.publicGet(`/v1/market-data/${market.id}/funding/${from}-${now}`);
    const rows = Array.isArray(response?.d) ? response.d : [];
    const latest = rows.filter((item: any) => Number.isSafeInteger(integer(item?.rate, Number.NaN)))
      .sort((a: any, b: any) => integer(object(b?.at).t) - integer(object(a?.at).t)).at(0);
    return latest ? { rate: integer(latest.rate), observedAt: now } : null;
  } catch { return null; }
}
