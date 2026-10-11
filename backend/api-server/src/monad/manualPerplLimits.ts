import { MonadApiError } from "./config.js";

export const MANUAL_PERPL_LEVERAGE_CAP = 3;
export const MANUAL_PERPL_SLIPPAGE_CAP_BPS = 100;

export function manualPerplEntryCollateralUnits(notionalUnits: bigint, leverage: number, takerFeeMicros: number) {
  if (notionalUnits < 0n || !Number.isSafeInteger(leverage) || leverage < 1
      || !Number.isSafeInteger(takerFeeMicros) || takerFeeMicros < 0) {
    throw new MonadApiError("Manual Perpl entry sizing is invalid.", 400, "manual_perpl_amount_invalid");
  }
  const marginUnits = (notionalUnits + BigInt(leverage) - 1n) / BigInt(leverage);
  const feeUnits = (notionalUnits * BigInt(takerFeeMicros) + 999_999n) / 1_000_000n;
  return { marginUnits, feeUnits, requiredUnits: marginUnits + feeUnits };
}

export function manualPerplMaxOrderUnits() {
  const value = process.env.MONAD_TESTNET_MANUAL_PERPL_MAX_ORDER_AUSD_UNITS ?? "10000000";
  if (!/^[1-9]\d{0,23}$/.test(value)) {
    throw new MonadApiError("Manual Perpl order cap configuration is invalid.", 503, "manual_perpl_cap_invalid");
  }
  return BigInt(value);
}
