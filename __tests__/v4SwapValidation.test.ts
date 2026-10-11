import {validatePreparedMonadOperation, validateV4MarketQuote} from '../src/services/monadValidation';
import type {V4PoolKey} from '../src/types/marketDirectory';
import type {MonadQuote, PreparedMonadOperation} from '../src/types/monad';

const ownerAddress = `0x${'9'.repeat(40)}`;
const poolId = `0x${'a'.repeat(64)}`;
const poolKey: V4PoolKey = {currency0: `0x${'1'.repeat(40)}`, currency1: `0x${'2'.repeat(40)}`,
  fee: 3000, tickSpacing: 60, hooks: `0x${'0'.repeat(40)}`};
const gas = {gasLimit: '100000', maxFeePerGas: '2', maxPriorityFeePerGas: '1', maxCostWei: '200000'};
const gasCap = {gasLimit: '120000', maxFeePerGas: '2', maxPriorityFeePerGas: '1', maxCostWei: '240000'};
const quote: MonadQuote = {quoteId: 'quote-1', accountScope: 'wallet', venue: 'uniswap_v4_testnet',
  tokenIn: poolKey.currency0, tokenOut: poolKey.currency1, amountInUnits: '1000', amountOutUnits: '2000',
  minimumAmountOutUnits: '1800', expiresAt: Date.now() + 60_000, feeProvenance: 'finalized pool state', ownerAddress,
  chainId: 10143, poolId, poolKey, gas, gasCap, gasEstimationAvailable: true, unverifiedPoolWarning: true};

describe('Uniswap v4 wallet swap binding', () => {
  it('accepts a fresh quote bound to its owner, chain, tokens, exact pool, and warning state', () => {
    expect(() => validateV4MarketQuote(quote, {ownerAddress, poolId, poolKey, verified: false,
      tokenIn: poolKey.currency0, tokenOut: poolKey.currency1})).not.toThrow();
  });

  it('rejects a quote when the owner, Pool ID, PoolKey, or unverified warning differs', () => {
    expect(() => validateV4MarketQuote({...quote, ownerAddress: `0x${'8'.repeat(40)}`}, {ownerAddress, poolId, poolKey, verified: false,
      tokenIn: poolKey.currency0, tokenOut: poolKey.currency1})).toThrow(/Mera owner/);
    expect(() => validateV4MarketQuote({...quote, poolId: `0x${'b'.repeat(64)}`}, {ownerAddress, poolId, poolKey, verified: false,
      tokenIn: poolKey.currency0, tokenOut: poolKey.currency1})).toThrow(/Pool ID/);
    expect(() => validateV4MarketQuote({...quote, unverifiedPoolWarning: false}, {ownerAddress, poolId, poolKey, verified: false,
      tokenIn: poolKey.currency0, tokenOut: poolKey.currency1})).toThrow(/verification warning/);
  });

  it('accepts a fallback approval-check quote with a valid informational cap and no gas estimate', () => {
    expect(() => validateV4MarketQuote({...quote, gas: null, gasEstimationAvailable: false}, {ownerAddress, poolId, poolKey, verified: false,
      tokenIn: poolKey.currency0, tokenOut: poolKey.currency1})).not.toThrow();
    expect(() => validateV4MarketQuote({...quote, gas: null, gasEstimationAvailable: false, gasCap: undefined}, {ownerAddress, poolId, poolKey, verified: false,
      tokenIn: poolKey.currency0, tokenOut: poolKey.currency1})).toThrow(/valid gas cap/);
  });

  it('blocks preparation review if Pool ID or gas cap changes after quoting', () => {
    const prepared: PreparedMonadOperation = {
      operationId: 'operation-1', chainId: 10143, ownerAddress, kind: 'wallet_swap',
      expiresAt: Date.now() + 60_000, transactionType: 'eip1559',
      transaction: {chainId: 10143, type: 2, to: `0x${'3'.repeat(40)}`, data: '0x', value: '0', nonce: '1', ...gas},
      review: {venue: 'uniswap_v4_testnet', accountScope: 'wallet', tokenIn: poolKey.currency0, tokenOut: poolKey.currency1,
        amountInUnits: '1000', minAmountOutUnits: '1800', inputDecimals: 18, outputDecimals: 6,
        quoteId: 'quote-1', poolId, poolKey},
    };
    const expected = {ownerAddress, kind: 'wallet_swap' as const, venue: 'uniswap_v4_testnet' as const,
      accountScope: 'wallet' as const, tokenIn: poolKey.currency0, tokenOut: poolKey.currency1,
      amountInUnits: '1000', minAmountOutUnits: '1800', inputDecimals: 18, outputDecimals: 6,
      quoteId: 'quote-1', poolId, poolKey, gasCap};
    expect(() => validatePreparedMonadOperation(prepared, expected)).not.toThrow();
    expect(() => validatePreparedMonadOperation({...prepared, review: {...prepared.review, poolId: `0x${'b'.repeat(64)}`}}, expected)).toThrow(/poolId/);
    expect(() => validatePreparedMonadOperation({...prepared, transaction: {...prepared.transaction, gasLimit: '110000'}}, expected)).not.toThrow();
    expect(() => validatePreparedMonadOperation({...prepared, transaction: {...prepared.transaction, gasLimit: '120001'}}, expected)).toThrow(/gas cap/);
    expect(() => validatePreparedMonadOperation({...prepared, transaction: {...prepared.transaction, maxFeePerGas: '3'}}, expected)).toThrow(/gas cap/);
  });
});
