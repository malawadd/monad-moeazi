import type {MarketDirectoryRow, MarketTradeSummary} from '../types/marketDirectory';
import type {PerplVenue} from '../types/perpl';

const WALLET_SPOT_SUMMARY_VENUES = new Set(['uniswap_v4_testnet', 'moeazi_test_amm', 'moeazi_mock_pools_testnet']);

/** Returns a Perpl quote unit only when the live venue context matches this exact market. */
export function perplMarketQuoteUnit(market: MarketDirectoryRow, venue: PerplVenue | null | undefined): string | null {
  if (market.kind !== 'perpl' || !venue || venue.venueId !== market.venueId
      || venue.chainId !== 10143 || (market.chainId !== undefined && market.chainId !== 10143)) return null;
  const collateral = venue.collateral;
  if (!collateral || collateral.symbol !== 'AUSD' || collateral.decimals !== 6
      || !market.symbol.trim() || !Number.isSafeInteger(market.priceDecimals)
      || (market.priceDecimals ?? -1) < 0 || (market.priceDecimals ?? 31) > 30) return null;
  return `${collateral.symbol} per ${market.symbol.trim()}`;
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
