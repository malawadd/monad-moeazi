import type {MarketDirectoryRow, MarketTradeSummary} from '../types/marketDirectory';
import type {PerplVenue} from '../types/perpl';

const WALLET_SPOT_SUMMARY_VENUES = new Set(['uniswap_v4_testnet', 'moeazi_test_amm', 'moeazi_mock_pools_testnet']);

const KNOWN_AUSD_PERPL_TESTNET_VENUES = new Set(['perpl-direct-testnet-v1', 'perpl-testnet-v1']);

/** Resolve explicit market quote metadata first, then the known AUSD Testnet convention. */
export function perplMarketQuoteUnit(market: MarketDirectoryRow, venue?: PerplVenue | null): string | null {
  if (market.kind !== 'perpl' || (market.chainId !== undefined && market.chainId !== 10143)) return null;
  const symbol = market.symbol.trim();
  if (!symbol || !/^[a-z0-9._-]{1,32}$/i.test(symbol)) return null;
  const explicitQuote = market.quoteAsset?.symbol.trim();
  if (explicitQuote && /^[a-z0-9._-]{1,16}$/i.test(explicitQuote)) return `${explicitQuote} per ${symbol}`;
  if (venue && venue.venueId === market.venueId && venue.chainId === 10143
      && venue.collateral?.symbol === 'AUSD' && venue.collateral.decimals === 6) return `AUSD per ${symbol}`;
  return KNOWN_AUSD_PERPL_TESTNET_VENUES.has(market.venueId) ? `AUSD per ${symbol}` : null;
}

export type WalletSpotSummaryUnits = {priceDecimals: number; sizeDecimals: number; quoteDecimals: number};

/**
 * Resolves wallet-Spot summary units from the exact market token DTO. These
 * summary producers store weighted prices as quote/base multiplied by 1e18,
 * while realized PnL remains raw quote-token units. Ignore their legacy
 * hard-coded priceDecimals metadata, which is wrong when quote decimals differ.
 */
export function walletSpotSummaryUnits(summary: Pick<MarketTradeSummary, 'venueId' | 'marketId'>,
  market: MarketDirectoryRow): WalletSpotSummaryUnits | null {
  if (market.kind !== 'spot' || !WALLET_SPOT_SUMMARY_VENUES.has(summary.venueId)
      || summary.venueId !== market.venueId || String(summary.marketId) !== String(market.marketId)) return null;
  const base = market.baseAsset, quote = market.quoteAsset;
  if (!base || !quote || !isTokenAddress(base.address) || !isTokenAddress(quote.address)
      || base.address.toLowerCase() === quote.address.toLowerCase()
      || !validDecimals(base.decimals) || !validDecimals(quote.decimals)) return null;
  const priceDecimals = 18 + quote.decimals - base.decimals;
  if (!validDecimals(priceDecimals)) return null;
  return {priceDecimals, sizeDecimals: base.decimals, quoteDecimals: quote.decimals};
}

function isTokenAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
}

function validDecimals(value: number): value is number {
  return Number.isSafeInteger(value) && value >= 0 && value <= 30;
}
