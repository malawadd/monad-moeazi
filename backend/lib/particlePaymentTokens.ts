import * as ParticleUa from "@particle-network/universal-account-sdk";
import { getParticleEvmChain, isSupportedParticleEvmChain } from "@/lib/particleEvmChains";

export type ParticleToken = {
  assetId?: string;
  type?: string;
  chainId: number;
  address: string;
  decimals?: number;
  realDecimals?: number;
  symbol?: string;
};

const CHAIN = {
  solana: 101,
  ethereum: 1,
  bsc: 56,
  base: 8453,
  arbitrum: 42161,
  optimism: 10,
  polygon: 137,
  avalanche: 43114,
} as const;

const PRIMARY_TYPES = new Set<string>([
  "eth",
  "usdt",
  "usdc",
  "sol",
  "bnb",
]);

const TOKEN_PRIORITY: Record<string, number> = {
  usdc: 0,
  usdt: 1,
  eth: 2,
  sol: 3,
  bnb: 4,
};

const CHAIN_LABELS: Record<number, string> = {
  [CHAIN.solana]: "Solana",
  [CHAIN.ethereum]: "Ethereum",
  [CHAIN.bsc]: "BNB Chain",
  [CHAIN.base]: "Base",
  [CHAIN.arbitrum]: "Arbitrum",
  [CHAIN.optimism]: "Optimism",
  [CHAIN.polygon]: "Polygon",
  [CHAIN.avalanche]: "Avalanche",
};

export type PaymentTokenOption = {
  id: string;
  label: string;
  token: {
    chainId: number;
    address: string;
    symbol: string;
  };
  receiverKind: "evm" | "solana";
};

export type EvmPrimaryDepositTokenOption = {
  id: string;
  label: string;
  chainId: number;
  chainName: string;
  address: string;
  symbol: string;
  assetId: string;
  tokenType: string;
  decimals: number;
  realDecimals: number;
  isNative: boolean;
};

export function isSolanaChain(chainId: number) {
  return chainId === CHAIN.solana;
}

export function chainLabel(chainId: number) {
  return CHAIN_LABELS[chainId] ?? `Chain ${chainId}`;
}

export function getReceiverForPaymentToken(
  token: { chainId: number },
  addresses: { evmUaAddress?: string | null; solanaUaAddress?: string | null },
) {
  if (isSolanaChain(token.chainId)) {
    if (!addresses.solanaUaAddress) {
      throw new Error("Recipient Solana Universal Account address is missing.");
    }
    return { receiver: addresses.solanaUaAddress, receiverKind: "solana" as const };
  }

  if (!addresses.evmUaAddress) {
    throw new Error("Recipient EVM Universal Account address is missing.");
  }
  return { receiver: addresses.evmUaAddress, receiverKind: "evm" as const };
}

function tokenSymbol(token: ParticleToken) {
  return String(token.symbol ?? token.type ?? token.assetId ?? "TOKEN").toUpperCase();
}

function optionId(token: ParticleToken) {
  return `${token.chainId}:${token.address}`;
}

function tokenType(token: ParticleToken) {
  return String(token.type ?? token.assetId ?? "").toLowerCase();
}

function tokenDecimals(token: ParticleToken) {
  return token.realDecimals ?? token.decimals ?? 18;
}

export function getPaymentTokenOptions(): PaymentTokenOption[] {
  const seen = new Set<string>();
  const options: PaymentTokenOption[] = [];
  const particleMetadata = ParticleUa as unknown as {
    SUPPORTED_PRIMARY_TOKENS?: ParticleToken[];
  };

  for (const token of particleMetadata.SUPPORTED_PRIMARY_TOKENS ?? []) {
    if (!PRIMARY_TYPES.has(tokenType(token))) continue;

    const id = optionId(token);
    if (seen.has(id)) continue;
    seen.add(id);

    const symbol = tokenSymbol(token);
    options.push({
      id,
      label: `${symbol} on ${chainLabel(token.chainId)}`,
      receiverKind: isSolanaChain(token.chainId) ? "solana" : "evm",
      token: {
        chainId: token.chainId,
        address: token.address,
        symbol,
      },
    });
  }

  return options.sort((a, b) => {
    const tokenRank = (TOKEN_PRIORITY[a.token.symbol.toLowerCase()] ?? 99) -
      (TOKEN_PRIORITY[b.token.symbol.toLowerCase()] ?? 99);
    if (tokenRank !== 0) return tokenRank;
    return a.label.localeCompare(b.label);
  });
}

// ---- Settlement: force all payer-UA payments to deliver USDC on Arbitrum ----

export const SETTLEMENT_CHAIN_ID = CHAIN.arbitrum;
export const SETTLEMENT_TOKEN_SYMBOL = "USDC";

export type SettlementTarget = {
  chainId: number;
  address: string;
  symbol: string;
  decimals: number;
  realDecimals: number;
};

/** Returns the canonical USDC-on-Arbitrum token from Particle's supported target tokens. */
export function getSettlementToken(): ParticleToken | null {
  const particleMetadata = ParticleUa as unknown as {
    SUPPORTED_TARGET_TOKENS?: ParticleToken[];
  };
  const tokens = particleMetadata.SUPPORTED_TARGET_TOKENS ?? [];

  for (const token of tokens) {
    const type = (token.type ?? token.assetId ?? "").toLowerCase();
    if (type === "usdc" && token.chainId === SETTLEMENT_CHAIN_ID) {
      return token;
    }
  }
  return null;
}

/** Canonical settlement target getter. Throws if the token is not in Particle's list. */
export function getSettlementTarget(): SettlementTarget {
  const token = getSettlementToken();
  if (!token) {
    throw new Error("Settlement token (USDC on Arbitrum) not found in SUPPORTED_TARGET_TOKENS.");
  }
  return {
    chainId: token.chainId,
    address: token.address,
    symbol: SETTLEMENT_TOKEN_SYMBOL,
    decimals: token.decimals ?? 6,
    realDecimals: tokenDecimals(token),
  };
}

/** True when the given token is already the settlement target (no conversion needed). */
export function isSettledToken(token: { chainId: number; symbol?: string }): boolean {
  return (
    token.chainId === SETTLEMENT_CHAIN_ID &&
    (token.symbol ?? "").toUpperCase() === SETTLEMENT_TOKEN_SYMBOL
  );
}

export function getEvmPrimaryDepositTokenOptions(): EvmPrimaryDepositTokenOption[] {
  const seen = new Set<string>();
  const options: EvmPrimaryDepositTokenOption[] = [];
  const particleMetadata = ParticleUa as unknown as {
    SUPPORTED_PRIMARY_TOKENS?: ParticleToken[];
  };

  for (const token of particleMetadata.SUPPORTED_PRIMARY_TOKENS ?? []) {
    if (isSolanaChain(token.chainId) || !isSupportedParticleEvmChain(token.chainId)) continue;
    const chain = getParticleEvmChain(token.chainId);
    if (!chain) continue;

    const id = optionId(token);
    if (seen.has(id)) continue;
    seen.add(id);

    const symbol = tokenSymbol(token);
    const type = tokenType(token);
    options.push({
      id,
      label: `${symbol} on ${chain.name}`,
      chainId: token.chainId,
      chainName: chain.name,
      address: token.address,
      symbol,
      assetId: String(token.assetId ?? type),
      tokenType: type,
      decimals: token.decimals ?? 18,
      realDecimals: tokenDecimals(token),
      isNative: token.address.toLowerCase() === "0x0000000000000000000000000000000000000000",
    });
  }

  return options.sort((a, b) => {
    const tokenRank =
      (TOKEN_PRIORITY[a.symbol.toLowerCase()] ?? 99) -
      (TOKEN_PRIORITY[b.symbol.toLowerCase()] ?? 99);
    if (tokenRank !== 0) return tokenRank;
    return a.label.localeCompare(b.label);
  });
}

export function getReceiverForDirectEvmDeposit(addresses: { evmUaAddress?: string | null }) {
  if (!addresses.evmUaAddress) {
    throw new Error("Recipient EVM Universal Account address is missing.");
  }
  return { receiver: addresses.evmUaAddress, receiverKind: "evm" as const };
}
