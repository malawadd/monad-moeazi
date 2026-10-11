import {estimatePerplOpenPnlAtLiveMark, formatAUsdMicroUnits} from '../src/services/perplLivePnl';

const basePosition = {
  verified: true, stateSource: 'finalized_perpl_exchange', finalizedBlockNumber: 120,
  markValid: true, sizeUnits: '20', markPrice: '10000', unrealizedPnlUnits: '50000', side: 'long',
};

test('adds the live mark move to finalized long PnL using market scales', () => {
  expect(estimatePerplOpenPnlAtLiveMark(basePosition, '10100', 2, 2)).toBe('250000');
});

test('reverses the live mark move for a short position', () => {
  expect(estimatePerplOpenPnlAtLiveMark({...basePosition, side: 'short'}, '9900', 2, 2)).toBe('250000');
});

test('does not estimate from unverified or invalid finalized positions', () => {
  expect(estimatePerplOpenPnlAtLiveMark({...basePosition, verified: false}, '10100', 2, 2)).toBeNull();
  expect(estimatePerplOpenPnlAtLiveMark({...basePosition, markValid: false}, '10100', 2, 2)).toBeNull();
});

test('formats signed AUSD micro-units without floating-point rounding', () => {
  expect(formatAUsdMicroUnits('1250001')).toBe('1.250001');
  expect(formatAUsdMicroUnits('-1250001')).toBe('−1.250001');
});
