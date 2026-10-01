import {
  OPTIMISM_GAS_RESERVE_WARNING_ETH,
  OPTIMISM_NATIVE_WITHDRAW_BUFFER_ETH,
} from "../constants";

export const ASSET_PURPOSE = {
  capital: "capital",
  inventory: "inventory",
  gas: "gas",
  unsupported: "unsupported",
} as const;

export type AssetPurpose = (typeof ASSET_PURPOSE)[keyof typeof ASSET_PURPOSE];

type VenueRole =
  | "arbitrum_ua_owner"
  | "arbitrum_managed_vault"
  | "optimism_execution_wallet"
  | "hyperliquid_master_wallet"
  | "hyperliquid_agent_wallet"
  | "lighter_trading_account"
  | "orderly_trading_account"
  | "gmx_trading_wallet"
  | "ostium_trading_wallet";

export type WalletAssetProfile = {
  asset: string;
  purpose: AssetPurpose;
  label: string;
  includedInStrategyEquity: boolean;
  supported: boolean;
};

const SUPPORTED_ASSETS_BY_ROLE: Record<VenueRole, WalletAssetProfile[]> = {
  arbitrum_ua_owner: [
    { asset: "USDC", purpose: ASSET_PURPOSE.capital, label: "Strategy capital", includedInStrategyEquity: true, supported: true },
    { asset: "LINK", purpose: ASSET_PURPOSE.inventory, label: "Strategy inventory", includedInStrategyEquity: true, supported: true },
    { asset: "WETH", purpose: ASSET_PURPOSE.inventory, label: "Wrapped ETH inventory", includedInStrategyEquity: true, supported: true },
    { asset: "ETH", purpose: ASSET_PURPOSE.gas, label: "Arbitrum gas reserve", includedInStrategyEquity: false, supported: true },
  ],
  arbitrum_managed_vault: [
    { asset: "USDC", purpose: ASSET_PURPOSE.capital, label: "Committed spot capital", includedInStrategyEquity: true, supported: true },
    { asset: "WETH", purpose: ASSET_PURPOSE.inventory, label: "Managed spot inventory", includedInStrategyEquity: true, supported: true },
  ],
  optimism_execution_wallet: [
    {
      asset: "USDC",
      purpose: ASSET_PURPOSE.capital,
      label: "Strategy capital",
      includedInStrategyEquity: true,
      supported: true,
    },
    {
      asset: "LINK",
      purpose: ASSET_PURPOSE.inventory,
      label: "Strategy inventory",
      includedInStrategyEquity: true,
      supported: true,
    },
    {
      asset: "ETH",
      purpose: ASSET_PURPOSE.gas,
      label: "Gas reserve",
      includedInStrategyEquity: false,
      supported: true,
    },
  ],
  hyperliquid_master_wallet: [
    {
      asset: "USDC",
      purpose: ASSET_PURPOSE.capital,
      label: "Strategy capital",
      includedInStrategyEquity: true,
      supported: true,
    },
  ],
  hyperliquid_agent_wallet: [],
  lighter_trading_account: [],
  orderly_trading_account: [],
  gmx_trading_wallet: [],
  ostium_trading_wallet: [],
};

function normalizeAmount(value: string | number | null | undefined) {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }
  return amount;
}

function formatAmount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  return value.toString();
}

export function getSupportedWalletAssets(role: VenueRole): WalletAssetProfile[] {
  return SUPPORTED_ASSETS_BY_ROLE[role] ?? [];
}

export function getWalletAssetProfile(role: VenueRole, asset: string): WalletAssetProfile {
  const normalized = asset.toUpperCase();
  return (
    getSupportedWalletAssets(role).find((item) => item.asset === normalized) ?? {
      asset: normalized,
      purpose: ASSET_PURPOSE.unsupported,
      label: "Unsupported asset",
      includedInStrategyEquity: false,
      supported: false,
    }
  );
}

export function computeWithdrawableBalance(args: {
  role: VenueRole;
  asset: string;
  balance: string | number | null | undefined;
}) {
  const balance = normalizeAmount(args.balance);
  const profile = getWalletAssetProfile(args.role, args.asset);

  if (args.role === "optimism_execution_wallet" && profile.asset === "ETH") {
    const withdrawable = Math.max(0, balance - OPTIMISM_NATIVE_WITHDRAW_BUFFER_ETH);
    return {
      amount: formatAmount(withdrawable),
      numericAmount: withdrawable,
      reserveAmount: formatAmount(OPTIMISM_NATIVE_WITHDRAW_BUFFER_ETH),
      note:
        withdrawable < balance
          ? "A small ETH reserve is held back so the withdrawal transaction can still pay Optimism gas."
          : undefined,
    };
  }

  return {
    amount: formatAmount(balance),
    numericAmount: balance,
    reserveAmount: "0",
    note: undefined,
  };
}

export function isLowGasReserve(args: {
  role: VenueRole;
  asset: string;
  balance: string | number | null | undefined;
}) {
  if (args.role !== "optimism_execution_wallet" || args.asset.toUpperCase() !== "ETH") {
    return false;
  }
  return normalizeAmount(args.balance) < OPTIMISM_GAS_RESERVE_WARNING_ETH;
}

export function estimateObservedTransferUsd(args: {
  previousAmount: string | number | null | undefined;
  nextAmount: string | number | null | undefined;
  previousValueUsd?: number | null;
  nextValueUsd?: number | null;
}) {
  const previousAmount = normalizeAmount(args.previousAmount);
  const nextAmount = normalizeAmount(args.nextAmount);
  const delta = Math.abs(nextAmount - previousAmount);
  if (delta <= 0) {
    return 0;
  }

  const nextUnitPrice = nextAmount > 0 ? Number(args.nextValueUsd ?? 0) / nextAmount : 0;
  const previousUnitPrice = previousAmount > 0 ? Number(args.previousValueUsd ?? 0) / previousAmount : 0;
  const unitPrice = nextUnitPrice > 0 ? nextUnitPrice : previousUnitPrice;
  return Number.isFinite(unitPrice) && unitPrice > 0 ? Number((delta * unitPrice).toFixed(2)) : 0;
}
