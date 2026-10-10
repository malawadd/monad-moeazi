export type TradeFill = { lotLNS?: unknown; pricePNS?: unknown; feeCNS?: unknown; amountCNS?: unknown };

function integer(value: unknown, allowNegative = false) {
  const text = String(value ?? "");
  if (!(allowNegative ? /^-?\d+$/.test(text) : /^\d+$/.test(text))) return null;
  try { return BigInt(text); } catch { return null; }
}

export function aggregateFills(fills: TradeFill[]) {
  let size = 0n; let priceValue = 0n; let fees = 0n;
  for (const fill of fills) {
    const lot = integer(fill.lotLNS); const price = integer(fill.pricePNS); const fee = integer(fill.feeCNS);
    if (lot === null || price === null || fee === null || lot <= 0n || price <= 0n || fee < 0n) continue;
    size += lot; priceValue += lot * price; fees += fee;
  }
  return { sizeUnits: size.toString(), priceValueNumerator: priceValue.toString(),
    weightedPrice: size > 0n ? (priceValue / size).toString() : null, feesUnits: fees.toString() };
}

/** Gross price-difference PnL in AUSD CNS. Funding is deliberately not inferred here. */
export function grossExitPnlCns(fills: TradeFill[], entryPricePns: unknown,
  direction: "long" | "short", priceDecimals: number, sizeDecimals: number) {
  const entry = integer(entryPricePns);
  if (entry === null || entry <= 0n || !Number.isInteger(priceDecimals) || priceDecimals < 0 || priceDecimals > 30
      || !Number.isInteger(sizeDecimals) || sizeDecimals < 0 || sizeDecimals > 30) return null;
  const denominator = 10n ** BigInt(priceDecimals + sizeDecimals);
  let numerator = 0n;
  for (const fill of fills) {
    const lot = integer(fill.lotLNS); const exit = integer(fill.pricePNS);
    if (lot === null || exit === null || lot <= 0n || exit <= 0n) continue;
    const delta = direction === "long" ? exit - entry : entry - exit;
    numerator += delta * lot * 1_000_000n;
  }
  const pnl = numerator / denominator;
  return pnl.toString();
}
