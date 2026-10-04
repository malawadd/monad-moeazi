import type { IAssetsResponse, IToken } from "@particle-network/universal-account-sdk";
import {
  chainLabel,
  getPaymentTokenOptions,
  isSolanaChain,
  type PaymentTokenOption,
} from "@/lib/particlePaymentTokens";

export type PaymentAccountAssetOption = PaymentTokenOption & {
  chainId: number;
  chainName: string;
  address: string;
  symbol: string;
  tokenType: string;
  amount: number;
  amountUsd: number;
  rawAmount: number | null;
  formattedAmount: string;
  formattedUsd: string;
  hasBalance: boolean;
};

export type PaymentAccountAssetBreakdown = {
  id: string;
  label: string;
  amount: number;
  amountUsd: number;
  formattedAmount: string;
  formattedUsd: string;
};

function tokenSymbol(token: Partial<IToken>) {
  return String(token.symbol ?? token.type ?? token.assetId ?? "TOKEN").toUpperCase();
}

function tokenType(token: Partial<IToken>) {
  return String(token.type ?? token.assetId ?? token.symbol ?? "token").toLowerCase();
}

function tokenAddress(token: Partial<IToken>) {
  return String(token.address ?? "").toLowerCase();
}

function tokenKey(chainId: number, address: string) {
  return `${chainId}:${address.toLowerCase()}`;
}

function formatTokenAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1 ? 6 : 8,
  }).format(value);
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1 ? 2 : 4,
  }).format(Number.isFinite(value) ? value : 0);
}

export function getPaymentAccountAssetOptions(
  assets: IAssetsResponse | null | undefined,
): PaymentAccountAssetOption[] {
  const balances = new Map<string, PaymentAccountAssetOption>();

  for (const asset of assets?.assets ?? []) {
    for (const aggregation of asset.chainAggregation ?? []) {
      const token = aggregation.token as IToken | undefined;
      if (!token) continue;

      const chainId = token.chainId;
      const address = tokenAddress(token);
      const symbol = tokenSymbol(token);
      const amount = Number(aggregation.amount ?? 0);
      const amountUsd = Number(aggregation.amountInUSD ?? 0);
      const id = tokenKey(chainId, address);
      balances.set(id, {
        id,
        label: `${symbol} on ${chainLabel(chainId)}`,
        receiverKind: isSolanaChain(chainId) ? "solana" : "evm",
        token: { chainId, address, symbol },
        chainId,
        chainName: chainLabel(chainId),
        address,
        symbol,
        tokenType: tokenType(token),
        amount,
        amountUsd,
        rawAmount: Number.isFinite(Number(aggregation.rawAmount)) ? Number(aggregation.rawAmount) : null,
        formattedAmount: formatTokenAmount(amount),
        formattedUsd: formatUsd(amountUsd),
        hasBalance: amount > 0 || amountUsd > 0,
      });
    }
  }

  const supportedIds = new Set<string>();
  const supportedOptions = getPaymentTokenOptions().map((option) => {
    const id = tokenKey(option.token.chainId, option.token.address);
    supportedIds.add(id);
    const existing = balances.get(id);
    if (existing) return existing;

    return {
      ...option,
      id,
      label: option.label,
      chainId: option.token.chainId,
      chainName: chainLabel(option.token.chainId),
      address: option.token.address.toLowerCase(),
      symbol: option.token.symbol,
      tokenType: option.token.symbol.toLowerCase(),
      amount: 0,
      amountUsd: 0,
      rawAmount: null,
      formattedAmount: "0",
      formattedUsd: formatUsd(0),
      hasBalance: false,
    };
  });
  const extraBalances = Array.from(balances.values()).filter((option) => !supportedIds.has(option.id));

  return [...supportedOptions, ...extraBalances].sort((a, b) => {
    if (a.hasBalance !== b.hasBalance) return a.hasBalance ? -1 : 1;
    const usdRank = b.amountUsd - a.amountUsd;
    if (usdRank !== 0) return usdRank;
    return a.label.localeCompare(b.label);
  });
}

export function getFundedPaymentAccountAssets(
  assets: IAssetsResponse | null | undefined,
) {
  return getPaymentAccountAssetOptions(assets).filter((option) => option.hasBalance);
}

export function getPaymentAccountBreakdown(
  assets: IAssetsResponse | null | undefined,
): PaymentAccountAssetBreakdown[] {
  return getFundedPaymentAccountAssets(assets).map((option) => ({
    id: option.id,
    label: option.label,
    amount: option.amount,
    amountUsd: option.amountUsd,
    formattedAmount: option.formattedAmount,
    formattedUsd: option.formattedUsd,
  }));
}
