type FinalizedPosition = Record<string, unknown>;

const integer = (value: unknown) => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  const text = String(value);
  if (!/^-?\d+$/.test(text)) return null;
  try { return BigInt(text); }
  catch { return null; }
};
const positiveInteger = (value: unknown) => { const parsed = integer(value); return parsed !== null && parsed > 0n ? parsed : null; };

/** Adds the signed mark move since the finalized account snapshot, in AUSD micro-units. */
export function estimatePerplOpenPnlAtLiveMark(position: FinalizedPosition | null | undefined,
  liveMarkRaw: number | string | null | undefined, priceDecimals: number, sizeDecimals: number): string | null {
  if (!position || position.verified !== true || position.stateSource !== 'finalized_perpl_exchange'
      || positiveInteger(position.finalizedBlockNumber) === null || position.markValid !== true) return null;
  if (!Number.isSafeInteger(priceDecimals) || priceDecimals < 0 || priceDecimals > 30
      || !Number.isSafeInteger(sizeDecimals) || sizeDecimals < 0 || sizeDecimals > 30) return null;
  const size = positiveInteger(position.sizeUnits ?? position.size);
  const snapshotMark = positiveInteger(position.markPrice);
  const liveMark = positiveInteger(liveMarkRaw);
  const snapshotPnl = position.unrealizedPnlUnits;
  const direction = String(position.side ?? position.direction ?? '').toLowerCase();
  if (!size || !snapshotMark || !liveMark || snapshotPnl === undefined || snapshotPnl === null
      || (direction !== 'long' && direction !== 'short')) return null;
  try {
    const base = integer(snapshotPnl); const parsedLiveMark = integer(liveMarkRaw); const parsedSnapshotMark = integer(position.markPrice);
    if (base === null || parsedLiveMark === null || parsedSnapshotMark === null) return null;
    const move = parsedLiveMark - parsedSnapshotMark;
    const signedMove = direction === 'short' ? -move : move;
    const denominator = (10n ** BigInt(priceDecimals)) * (10n ** BigInt(sizeDecimals));
    const delta = signedMove * size * 1_000_000n / denominator;
    return (base + delta).toString();
  } catch { return null; }
}

export function formatAUsdMicroUnits(value: string | number | bigint): string {
  try {
    const units = BigInt(String(value)); const negative = units < 0n; const absolute = negative ? -units : units;
    const whole = (absolute / 1_000_000n).toLocaleString();
    const fraction = (absolute % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
    return `${negative ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
  } catch { return 'Unavailable'; }
}
