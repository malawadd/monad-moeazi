import {perplMarketQuoteUnit, walletSpotSummaryUnits} from '../src/services/marketPriceUnits';
import type {MarketDirectoryRow} from '../src/types/marketDirectory';
import type {PerplVenue} from '../src/types/perpl';

const market: MarketDirectoryRow = {kind: 'perpl', venueId: 'perpl-direct-testnet-v1', marketId: '16',
  displayName: 'Perpl Testnet', symbol: 'BTC-PERP', name: 'Bitcoin perpetual', status: 'open', available: true,
  chainId: 10143, priceDecimals: 2, testOnly: true, capabilities: {marketData: true}};
const venue: PerplVenue = {venueId: 'perpl-direct-testnet-v1', displayName: 'Perpl Testnet', chainId: 10143,
  executionModel: 'direct', enabled: true, collateral: {symbol: 'AUSD', address: `0x${'1'.repeat(40)}`, decimals: 6}};
const spotMarket: MarketDirectoryRow = {kind: 'spot', venueId: 'uniswap_v4_testnet', marketId: 'pool-1', displayName: 'Uniswap v4 Testnet',
  symbol: 'TOKEN/WMON', name: 'Token quoted in WMON', status: 'open', available: true, testOnly: true,
  baseAsset: {id: 'TOKEN', symbol: 'TOKEN', address: `0x${'2'.repeat(40)}`, decimals: 18},
  quoteAsset: {id: 'WMON', symbol: 'WMON', address: `0x${'3'.repeat(40)}`, decimals: 18},
  capabilities: {marketData: true, walletSwap: true}};

describe('Perpl market quote units', () => {
  it('uses the pinned AUSD convention immediately without venue-query timing', () => {
    expect(perplMarketQuoteUnit(market, venue)).toBe('AUSD per BTC-PERP');
    expect(perplMarketQuoteUnit(market, null)).toBe('AUSD per BTC-PERP');
    expect(perplMarketQuoteUnit(market, {...venue, venueId: 'perpl-testnet-v1'})).toBe('AUSD per BTC-PERP');
  });

  it('prefers explicit quote-currency metadata over the AUSD fallback', () => {
    expect(perplMarketQuoteUnit({...market, quoteAsset: {id: 'USDC', symbol: 'USDC', address: `0x${'4'.repeat(40)}`, decimals: 6}}, null))
      .toBe('USDC per BTC-PERP');
  });

  it('does not label Spot or unknown venues as AUSD Perpl markets', () => {
    expect(perplMarketQuoteUnit({...market, kind: 'spot'}, null)).toBeNull();
    expect(perplMarketQuoteUnit({...market, venueId: 'future-unknown-perp'}, null)).toBeNull();
    expect(perplMarketQuoteUnit({...market, chainId: 1}, null)).toBeNull();
  });

  it('keeps the known unit stable even while price precision is unavailable', () => {
    expect(perplMarketQuoteUnit({...market, priceDecimals: undefined}, null)).toBe('AUSD per BTC-PERP');
    expect(perplMarketQuoteUnit({...market, priceDecimals: 31}, null)).toBe('AUSD per BTC-PERP');
  });
});

describe('wallet Spot summary units', () => {
  it('derives weighted price and quote PnL decimals from exact WMON-quoted 18/18 token metadata', () => {
    const units = walletSpotSummaryUnits({venueId: spotMarket.venueId, marketId: spotMarket.marketId}, spotMarket);
    expect(units).toEqual({priceDecimals: 18, sizeDecimals: 18, quoteDecimals: 18});
  });

  it('derives six price decimals for 6-decimal USDC quoted against an 18-decimal base', () => {
    const usdcMarket = {...spotMarket, symbol: 'TOKEN/USDC', quoteAsset: {...spotMarket.quoteAsset!, id: 'USDC',
      symbol: 'USDC', decimals: 6}};
    expect(walletSpotSummaryUnits({venueId: usdcMarket.venueId, marketId: usdcMarket.marketId}, usdcMarket))
      .toEqual({priceDecimals: 6, sizeDecimals: 18, quoteDecimals: 6});
  });

  it('leaves summary units unavailable for mismatched identity, unsupported venue, or missing token precision', () => {
    expect(walletSpotSummaryUnits({venueId: spotMarket.venueId, marketId: 'another-pool'}, spotMarket)).toBeNull();
    expect(walletSpotSummaryUnits({venueId: 'other-venue', marketId: spotMarket.marketId}, spotMarket)).toBeNull();
    expect(walletSpotSummaryUnits({venueId: spotMarket.venueId, marketId: spotMarket.marketId},
      {...spotMarket, quoteAsset: {...spotMarket.quoteAsset!, decimals: undefined as any}})).toBeNull();
  });
});
