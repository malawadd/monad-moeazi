export const PERPL_CHAIN_ID = 10143;
export const PERPL_TESTNET_EXCHANGE = "0x1964c32f0be608e7d29302aff5e61268e72080cc";
export const PERPL_TESTNET_AUSD = "0xa9012a055bd4e0edff8ce09f960291c09d5322dc";
export const PERPL_VENUE_ID = "perpl-testnet-v1";
export const PERPL_DIRECT_VENUE_ID = "perpl-direct-testnet-v1";
export const PERPL_API_DEFAULT = "https://testnet.perpl.xyz/api";
export const PERPL_TESTNET_MAX_FUNDING_UNITS_DEFAULT = "1000000000";
export const PERPL_MAX_LEVERAGE_DEFAULT = 3;
export const PERPL_MAX_SLIPPAGE_BPS_DEFAULT = 100;

export class PerplApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly retryable = false) {
    super(message);
  }
}

export function perplApiUrl() {
  const value = process.env.PERPL_TESTNET_API_URL?.trim() || PERPL_API_DEFAULT;
  let url: URL;
  try { url = new URL(value); } catch { throw new PerplApiError("Perpl Testnet API URL is invalid.", 503, "perpl_config_invalid"); }
  if (url.protocol !== "https:" || url.hostname !== "testnet.perpl.xyz" || url.username || url.password
    || url.search || url.hash || !["", "/api", "/api/"].includes(url.pathname)) {
    throw new PerplApiError("Perpl integration is pinned to the Perpl Testnet API.", 503, "perpl_network_rejected");
  }
  return url.origin + "/api";
}

export function perplWhitelistedOrigin() {
  const value = process.env.PERPL_API_ORIGIN?.trim();
  if (!value) throw new PerplApiError("Perpl key enrollment requires a whitelisted PERPL_API_ORIGIN.", 503, "perpl_origin_unconfigured");
  let url: URL;
  try { url = new URL(value); } catch { throw new PerplApiError("PERPL_API_ORIGIN must be an HTTPS origin.", 503, "perpl_origin_invalid"); }
  if (url.protocol !== "https:" || url.origin !== value.replace(/\/$/, "") || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new PerplApiError("PERPL_API_ORIGIN must be a canonical HTTPS origin.", 503, "perpl_origin_invalid");
  }
  return url.origin;
}

export function perplExecutionEnabled() {
  return ["MONAD_TESTNET_ACTIONS_ENABLED", "MONAD_TESTNET_BROADCAST_ENABLED",
    "MONAD_TESTNET_OPERATOR_TRADES_ENABLED", "MONAD_TESTNET_PERPL_AUTONOMY_ENABLED"]
    .every((name) => process.env[name]?.trim().toLowerCase() === "true");
}

export function perplDirectExecutionEnabled() {
  return perplExecutionEnabled()
    && process.env.MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED?.trim().toLowerCase() === "true";
}

export function perplFundingBounds() {
  const raw = process.env.MONAD_TESTNET_PERPL_MAX_FUNDING_UNITS?.trim()
    || PERPL_TESTNET_MAX_FUNDING_UNITS_DEFAULT;
  if (!/^[1-9]\d{0,17}$/.test(raw)) throw new PerplApiError("Perpl maximum funding limit is invalid.", 503, "perpl_config_invalid");
  return { minUnits: 100_000_000n, maxUnits: BigInt(raw) };
}

export function perplMaxSlippageBps() {
  const value = Number(process.env.MONAD_TESTNET_PERPL_MAX_SLIPPAGE_BPS ?? PERPL_MAX_SLIPPAGE_BPS_DEFAULT);
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new PerplApiError("Perpl backend market slippage cap is invalid.", 503, "perpl_config_invalid");
  }
  return value;
}
