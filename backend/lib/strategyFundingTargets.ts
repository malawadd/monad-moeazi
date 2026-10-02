import { CHAIN_ID, ZeroAddress } from "@particle-network/universal-account-sdk";

type WalletAssetRow = {
  asset: string;
  label?: string;
  purpose?: string;
};

export type DepositInstructionForFunding = {
  venueAccountId: string;
  role: string;
  venue: string;
  walletAddress: string;
  strategyAssets: WalletAssetRow[];
  operationalAssets: WalletAssetRow[];
};

export type StrategyFundingTarget = {
  id: string;
  label: string;
  role: string;
  venue: string;
  receiver: string;
  token: {
    chainId: number;
    address: string;
  };
};

const ARBITRUM_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";

export function tokenForStrategyFundingTarget(role: string, asset: string) {
  if ((role === "arbitrum_ua_owner" || role === "hyperliquid_master_wallet") && asset === "USDC") {
    return { chainId: CHAIN_ID.ARBITRUM_MAINNET_ONE, address: ARBITRUM_USDC };
  }
  if (role === "arbitrum_ua_owner" && asset === "ETH") {
    return { chainId: CHAIN_ID.ARBITRUM_MAINNET_ONE, address: ZeroAddress };
  }
  return null;
}

export function buildStrategyFundingTargets(instructions: DepositInstructionForFunding[]) {
  const rows: StrategyFundingTarget[] = [];
  for (const instruction of instructions) {
    for (const asset of [...instruction.strategyAssets, ...instruction.operationalAssets]) {
      const token = tokenForStrategyFundingTarget(instruction.role, asset.asset);
      if (!token) continue;
      rows.push({
        id: `${instruction.venueAccountId}:${asset.asset}`,
        label: `${instruction.role.replaceAll("_", " ")} - ${asset.asset}`,
        role: instruction.role,
        venue: instruction.venue,
        receiver: instruction.walletAddress,
        token,
      });
    }
  }
  return rows;
}
