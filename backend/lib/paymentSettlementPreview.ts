import type { SettlementPreview } from "@/lib/particleSettlement";
import { extractUaFeeEstimate } from "@/lib/particleSettlement";
import type { SettlementTarget } from "@/lib/particlePaymentTokens";
import type { PaymentAccountAssetOption } from "@/lib/paymentAccountAssets";

const SETTLEMENT_EPSILON = 0.000001;
const DEFAULT_UA_FEE_RESERVE_USD = 0.05;
const UA_FEE_RESERVE_PADDING_USD = 0.005;

export function canCoverSettlementAmount(
  source: PaymentAccountAssetOption | null,
  amount: number,
) {
  if (!source?.hasBalance || !Number.isFinite(amount) || amount <= 0) return false;
  return source.amountUsd <= 0 || amount <= source.amountUsd + SETTLEMENT_EPSILON;
}

export function canCoverSettlementWithFees(input: {
  amountUsd: number;
  availableUsd: number | null | undefined;
  feeUsd: number | null | undefined;
}) {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) return false;
  if (typeof input.availableUsd !== "number" || !Number.isFinite(input.availableUsd)) return true;
  const totalRequired = input.amountUsd + (input.feeUsd ?? 0);
  return totalRequired <= input.availableUsd + SETTLEMENT_EPSILON;
}

export function estimateSpendableSettlementMax(input: {
  availableUsd: number | null | undefined;
  lastFeeUsd?: number | null;
}) {
  if (typeof input.availableUsd !== "number" || !Number.isFinite(input.availableUsd) || input.availableUsd <= 0) {
    return { amount: "0", amountNumber: 0, reserveUsd: 0 };
  }
  const quotedReserve =
    typeof input.lastFeeUsd === "number" && Number.isFinite(input.lastFeeUsd)
      ? input.lastFeeUsd + UA_FEE_RESERVE_PADDING_USD
      : 0;
  const reserveUsd = Math.min(
    input.availableUsd,
    Math.max(DEFAULT_UA_FEE_RESERVE_USD, quotedReserve),
  );
  const amountNumber = Number(Math.max(0, input.availableUsd - reserveUsd).toFixed(6));
  return {
    amount: formatMaxSettlementAmount(amountNumber),
    amountNumber,
    reserveUsd,
  };
}

export function buildPaymentSettlementPreview(
  source: PaymentAccountAssetOption,
  settlement: SettlementTarget,
  amount: string,
  amountNumber: number,
): SettlementPreview {
  return {
    settlement,
    isDirect:
      source.token.chainId === settlement.chainId &&
      source.token.symbol.toLowerCase() === settlement.symbol.toLowerCase(),
    estimatedSettlementAmount: amount,
    sourceAmountUsd: amountNumber,
    sourceTokenPrice: source.amount > 0 && source.amountUsd > 0 ? source.amountUsd / source.amount : null,
  };
}

export function addTransactionFeesToPreview(
  preview: SettlementPreview,
  transaction: unknown,
  availableBalanceUsd: number | null | undefined,
): SettlementPreview {
  const fees = extractUaFeeEstimate(transaction) ?? undefined;
  const totalFee = fees?.totalUsd ?? 0;
  return {
    ...preview,
    availableBalanceUsd: typeof availableBalanceUsd === "number" ? availableBalanceUsd : null,
    fees,
    requiredBalanceUsd: preview.sourceAmountUsd === null ? null : preview.sourceAmountUsd + totalFee,
  };
}

export function formatMaxSettlementAmount(value: number) {
  return value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: 6,
  });
}

export function safeJsonDetails(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
