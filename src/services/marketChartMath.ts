export function normalizeCandleTimestamp(value: number, unit?: 'milliseconds' | 'seconds') {
  if (unit === 'seconds' || (unit === undefined && value > 0 && value < 1_000_000_000_000)) return value * 1000;
  return value;
}

export function mapTimeToX(times: number[], width: number) {
  if (!times.length) return [];
  const first = times[0];
  const last = times[times.length - 1];
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return times.map(() => width / 2);
  return times.map(time => Math.max(0, Math.min(width, (time - first) / (last - first) * width)));
}

export function nearestIndex(position: number, points: number[]) {
  if (!points.length) return -1;
  let nearest = 0;
  for (let index = 1; index < points.length; index++) {
    if (Math.abs(points[index] - position) < Math.abs(points[nearest] - position)) nearest = index;
  }
  return nearest;
}

export function priceTicks(low: number, high: number) {
  const span = high - low;
  if (!Number.isFinite(span) || span <= 0) return [low, high];
  const rawStep = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = factor * magnitude;
  const start = Math.ceil(low / step) * step;
  const result: number[] = [];
  for (let value = start, count = 0; value <= high + step * 1e-8 && count < 6; value += step, count++) result.push(value);
  return result.length ? result : [low, high];
}

export function visiblePriceRange(
  candles: Array<{o: number; h: number; l: number; c: number}>,
  xPositions: number[], offset: number, viewportWidth: number, currentPrices: number[] = [],
) {
  const visible = candles.flatMap((candle, index) => {
    const x = xPositions[index];
    return x >= offset - 12 && x <= offset + viewportWidth + 12
      ? [candle.o, candle.h, candle.l, candle.c] : [];
  });
  const values = [...visible, ...currentPrices].filter(value => Number.isFinite(value) && value > 0);
  if (!values.length) return {low: 0, high: 1};
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, maximum * 0.0005);
  return {low: Math.max(0, minimum - span * 0.12), high: maximum + span * 0.12};
}
