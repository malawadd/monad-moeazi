import {perplTradeRouteParams, spotTradeApprovalReturnParams, spotTradeDraftFromParams, spotTradeReviewParams} from '../src/services/marketTradeRoutes';
import type {MarketDirectoryRow} from '../src/types/marketDirectory';

const spot: MarketDirectoryRow = {kind: 'spot', venueId: 'uniswap_v4_testnet', marketId: 'WMON_USDC', displayName: 'Uniswap v4',
  symbol: 'WMON/USDC', name: 'Wrapped MON / USDC', status: 'open', available: true, testOnly: true, verified: false,
  verificationSource: 'operator-reviewed', poolId: `0x${'a'.repeat(64)}`,
  poolKey: {currency0: `0x${'1'.repeat(40)}`, currency1: `0x${'2'.repeat(40)}`, fee: 3000, tickSpacing: 60, hooks: `0x${'0'.repeat(40)}`},
  baseAsset: {id: 'WMON', symbol: 'WMON', address: `0x${'3'.repeat(40)}`, decimals: 18},
  quoteAsset: {id: 'USDC', symbol: 'USDC', address: `0x${'4'.repeat(40)}`, decimals: 6},
  capabilities: {marketData: true, walletSwap: true, buy: true, sell: true}};
const perpl: MarketDirectoryRow = {kind: 'perpl', venueId: 'perpl-direct-testnet-v1', marketId: '32', displayName: 'Perpl Testnet',
  symbol: 'ETH-PERP', name: 'Ether perpetual', status: 'open', available: true, testOnly: true, priceDecimals: 2,
  sizeDecimals: 4, maxLeverage: 10, capabilities: {marketData: true, manualLongShort: true}};

test('Spot review params preserve exact wallet, venue, assets and pool identity for both sides', () => {
  const params = spotTradeReviewParams(spot);
  expect(params).toEqual({marketId: spot.marketId, venue: spot.venueId, accountScope: 'wallet', baseAsset: spot.baseAsset,
    quoteAsset: spot.quoteAsset, poolId: spot.poolId, poolKey: spot.poolKey, verified: false, verificationSource: spot.verificationSource});
  expect(spotTradeReviewParams({...spot, baseAsset: undefined})).toBeNull();
});

test('Spot approval return keeps editable inputs and market identity but never restores a quote', () => {
  const route = {...spotTradeReviewParams(spot)!, quote: {quoteId: 'stale-quote', amountInUnits: '1'}};
  const returnParams = spotTradeApprovalReturnParams(route, {side: 'sell', amount: '0.025', slippage: '75'});
  expect(returnParams).toMatchObject({marketId: spot.marketId, venue: spot.venueId, accountScope: 'wallet',
    swapDraft: {side: 'sell', amount: '0.025', slippage: '75'}});
  expect(returnParams).not.toHaveProperty('quote');
  expect(spotTradeDraftFromParams(returnParams)).toEqual({side: 'sell', amount: '0.025', slippage: '75'});
  expect(spotTradeDraftFromParams({side: 'sell'})).toEqual({side: 'sell', amount: '', slippage: '50'});
});

test('Perpl long, short, and management routes retain identity, precision and action semantics', () => {
  expect(perplTradeRouteParams(perpl)).toEqual({marketId: '32', symbol: 'ETH-PERP', priceDecimals: 2, sizeDecimals: 4, maxLeverage: 10});
  expect(perplTradeRouteParams(perpl, {side: 'short'})).toEqual({marketId: '32', symbol: 'ETH-PERP',
    priceDecimals: 2, sizeDecimals: 4, maxLeverage: 10, side: 'short'});
  expect(perplTradeRouteParams(perpl, {action: 'reduce_size', positionSide: 'short'})).toEqual({marketId: '32', symbol: 'ETH-PERP',
    side: 'short', sizeDecimals: 4, priceDecimals: 2, action: 'reduce_size'});
  expect(perplTradeRouteParams({...perpl, kind: 'spot'})).toBeNull();
});
