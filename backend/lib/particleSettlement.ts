import type { IAssetsResponse, IToken } from "@particle-network/universal-account-sdk";
import {
  getSettlementTarget,
  isSettledToken,
//   SETTLEMENT_TOKEN_SYMBOL,
  type SettlementTarget,
} from "@/lib/particlePaymentTokens";

// ---- types ----

export type SettlementPreview = {
  /** The settlement target (always USDC on Arbitrum). */
  settlement: SettlementTarget;
  /** Whether the source token is already the settlement token. */
  isDirect: boolean;
  /** Estimated USDC amount the recipient will receive. */
  estimatedSettlementAmount: string;
  /** USD value of the source amount. Null when price data is unavailable. */
  sourceAmountUsd: number | null;
  /** Token price in USD. Null when price data is unavailable. */
  sourceTokenPrice: number | null;
  fees?: UaFeeEstimate;
  requiredBalanceUsd?: number | null;
  availableBalanceUsd?: number | null;
};

export type UaFeeEstimate = {
  totalUsd: number | null;
  gasUsd: number | null;
  serviceUsd: number | null;
  lpUsd: number | null;
};

// ---- helpers ----

function tokenType(token: IToken) {
  return String(token.type ?? token.assetId ?? "").toLowerCase();
}

/** Find a specific token's price (USD per unit) from the UA's primary assets response. */
export function findTokenPrice(
  chainId: number,
  symbolOrType: string,
  assets: IAssetsResponse | null,
): number | null {
  if (!assets) return null;
  const normalized = symbolOrType.toLowerCase();
  for (const asset of assets.assets) {
    for (const agg of asset.chainAggregation ?? []) {
      const token = agg.token as IToken | undefined;
      if (!token) continue;
      if (
        token.chainId === chainId &&
        (tokenType(token) === normalized || (token.symbol ?? "").toLowerCase() === normalized)
      ) {
        const price = token.price;
        if (typeof price === "number" && price > 0) return price;
        // fallback: derive from amountInUSD / amount
        if (agg.amount > 0 && agg.amountInUSD > 0) {
          return agg.amountInUSD / agg.amount;
        }
      }
    }
  }
  return null;
}

// ---- public API ----

/**
 * Given a source token + amount and the payer's current assets, produce a
 * preview of the settlement (how much USDC on Arbitrum the recipient will get).
 */
export function estimateSettlement(
  sourceChainId: number,
  sourceSymbol: string,
  sourceAmount: string,
  assets: IAssetsResponse | null,
): SettlementPreview {
  const settlement = getSettlementTarget();
  const isDirect = isSettledToken({ chainId: sourceChainId, symbol: sourceSymbol });

  const parsedAmount = Number(sourceAmount);
  const isValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  // For direct settlement, the amount is 1:1 (both are USDC)
  if (isDirect) {
    return {
      settlement,
      isDirect: true,
      estimatedSettlementAmount: isValid ? sourceAmount : "0",
      sourceAmountUsd: isValid ? parsedAmount : null,
      sourceTokenPrice: 1,
    };
  }

  // For cross-token / cross-chain, look up the source token price
  const price = findTokenPrice(sourceChainId, sourceSymbol, assets);

  if (!isValid || price === null) {
    return {
      settlement,
      isDirect: false,
      estimatedSettlementAmount: "0",
      sourceAmountUsd: null,
      sourceTokenPrice: null,
    };
  }

  const sourceUsd = parsedAmount * price;
  // USDC ≈ 1 USD — use 1:1 conversion (the SDK's execution price may differ slightly)
  const estimatedSettlement = sourceUsd.toFixed(6);

  return {
    settlement,
    isDirect: false,
    estimatedSettlementAmount: estimatedSettlement,
    sourceAmountUsd: sourceUsd,
    sourceTokenPrice: price,
  };
}

// ---- formatting ----

export function formatSettlementAmount(amount: string, symbol: string): string {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) return `0 ${symbol}`;
  return `${Number(parsed).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${symbol}`;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function scaledUsd(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  if (value.includes(".")) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  try {
    return Number(BigInt(value)) / 1e18;
  } catch {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

export function extractUaFeeEstimate(transaction: unknown): UaFeeEstimate | null {
  const tx = readRecord(transaction);
  const feeQuotes = Array.isArray(tx?.feeQuotes) ? tx.feeQuotes : [];
  const fees = readRecord(readRecord(feeQuotes[0])?.fees);
  const totals = readRecord(fees?.totals);
  if (!totals) return null;
  return {
    totalUsd: scaledUsd(totals.feeTokenAmountInUSD),
    gasUsd: scaledUsd(totals.gasFeeTokenAmountInUSD),
    serviceUsd: scaledUsd(totals.transactionServiceFeeTokenAmountInUSD),
    lpUsd: scaledUsd(totals.transactionLPFeeTokenAmountInUSD),
  };
}
