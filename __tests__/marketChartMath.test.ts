import {mapTimeToX, nearestIndex, normalizeCandleTimestamp, priceTicks, visiblePriceRange} from '../src/services/marketChartMath';

describe('market chart scaling', () => {
  it('places unevenly spaced observations by time instead of candle index', () => {
    expect(mapTimeToX([1_000, 2_000, 5_000], 100)).toEqual([0, 25, 100]);
  });

  it('selects the closest candle on a dragged time axis', () => {
    const positions = mapTimeToX([1_000, 2_000, 5_000], 100);
    expect(nearestIndex(20, positions)).toBe(1);
    expect(nearestIndex(92, positions)).toBe(2);
  });

  it('handles second and millisecond candle timestamps', () => {
    expect(normalizeCandleTimestamp(1_700_000_000, 'seconds')).toBe(1_700_000_000_000);
    expect(normalizeCandleTimestamp(1_700_000_000_000, 'milliseconds')).toBe(1_700_000_000_000);
  });

  it('scales price labels across tiny and large values', () => {
    const tiny = priceTicks(0.00000012, 0.00000028);
    const large = priceTicks(120_000, 280_000);
    expect(tiny.length).toBeGreaterThan(1);
    expect(tiny[0]).toBeGreaterThanOrEqual(0.00000012);
    expect(large.length).toBeGreaterThan(1);
    expect(large[0]).toBeGreaterThanOrEqual(120_000);
  });

  it('scales the visible candles instead of distant history', () => {
    const candles = [81_000, 82_900, 82_950, 83_000].map(price => ({o: price, h: price + 15, l: price - 15, c: price}));
    const recent = visiblePriceRange(candles, [0, 100, 200, 300], 180, 130, [82_975]);
    expect(recent.low).toBeGreaterThan(82_800);
    expect(recent.high).toBeLessThan(83_100);
    const old = visiblePriceRange(candles, [0, 100, 200, 300], 0, 80);
    expect(old.low).toBeLessThan(81_000);
  });
});
