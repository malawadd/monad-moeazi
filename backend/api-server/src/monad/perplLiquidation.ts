export type PerplLiquidationInput = {
  side: "long" | "short";
  entryPriceUnits?: string;
  entryPriceResidueQ16?: string;
  sizeUnits?: string;
  depositUnits?: string;
  fundingPnlUnits?: string;
  maintenanceMarginFactor?: number | string;
  priceDecimals?: number;
  sizeDecimals?: number;
  markPriceUnits?: string;
  markValid?: boolean;
};

export type PerplLiquidationEstimate = {
  status: "estimated" | "unavailable";
  formula: "perpl_position_v1";
  priceUnits: string | null;
  reason?: string;
  caveat: string;
};

const Q16 = 65_536n;
const AUSD_DECIMALS = 6;
const caveat = "Estimate from finalized position inputs and the current Perpl maintenance factor; Perpl's liquidation engine uses mark price and may update funding or margin before execution.";

/**
 * Mirrors Perpl's published Position::liquidation_price formula. Perpl's
 * premiumPnl is signed (positive is credited), and the official formula
 * subtracts it directly. Return price units at the market's PNS precision.
 */
export function estimatePerplLiquidationPrice(input: PerplLiquidationInput): PerplLiquidationEstimate {
  const unavailable = (reason: string): PerplLiquidationEstimate => ({
    status: "unavailable", formula: "perpl_position_v1", priceUnits: null, reason, caveat,
  });
  if (!input.markValid || !positive(input.markPriceUnits)) return unavailable("perpl_mark_invalid");
  if (!positive(input.entryPriceUnits) || !positive(input.sizeUnits) || !positive(input.depositUnits)
      || input.fundingPnlUnits === undefined || input.fundingPnlUnits === null) {
    return unavailable("perpl_position_inputs_missing");
  }
  const factor = safePositiveInteger(input.maintenanceMarginFactor);
  const priceDecimals = safeDecimals(input.priceDecimals);
  const sizeDecimals = safeDecimals(input.sizeDecimals);
  if (!factor || priceDecimals === null || sizeDecimals === null) return unavailable("perpl_market_margin_config_missing");

  try {
    const entry = BigInt(input.entryPriceUnits!);
    const size = BigInt(input.sizeUnits!);
    const deposit = BigInt(input.depositUnits!);
    const premiumPnl = BigInt(input.fundingPnlUnits!);
    const residue = BigInt(input.entryPriceResidueQ16 ?? "0");
    if (residue < 0n || residue >= Q16) return unavailable("perpl_entry_residue_invalid");
    const priceScale = 10n ** BigInt(priceDecimals);
    const sizeScale = 10n ** BigInt(sizeDecimals);
    const collateralScale = 10n ** BigInt(AUSD_DECIMALS);
    const entryQ16 = (entry * Q16) + (input.side === "long" && residue > 0n ? -Q16 + residue : residue);
    if (entryQ16 <= 0n) return unavailable("perpl_entry_price_invalid");

    // MMR = effective entry * size / maintenance factor. Fraction factors
    // are represented in hundredths (for example 2500 means 25.00x).
    const deltaNumerator = entryQ16 * size * collateralScale * 100n
      - (deposit + premiumPnl) * Q16 * priceScale * sizeScale * BigInt(factor);
    const deltaDenominator = BigInt(factor) * size * collateralScale;
    const sideSign = input.side === "long" ? 1n : -1n;
    const liquidationQ16 = entryQ16 + sideSign * (deltaNumerator / deltaDenominator);
    const clampedQ16 = liquidationQ16 > 0n ? liquidationQ16 : 0n;
    return { status: "estimated", formula: "perpl_position_v1",
      priceUnits: (clampedQ16 / Q16).toString(), caveat };
  } catch {
    return unavailable("perpl_position_inputs_invalid");
  }
}

function positive(value?: string) {
  try { return value !== undefined && BigInt(value) > 0n; } catch { return false; }
}
function safePositiveInteger(value: number | string | undefined) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function safeDecimals(value: number | undefined) {
  return Number.isSafeInteger(value) && value! >= 0 && value! <= 30 ? value! : null;
}
