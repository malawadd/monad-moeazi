import type { Chain } from "viem";
import {
  arbitrum,
  avalanche,
  base,
  berachain,
  blast,
  bsc,
  linea,
  mainnet,
  manta,
  mantle,
  mode,
  optimism,
  polygon,
  sonic,
  xLayer,
} from "viem/chains";

export const PARTICLE_EVM_CHAINS = [
  mainnet,
  bsc,
  base,
  xLayer,
  arbitrum,
  optimism,
  polygon,
  sonic,
  berachain,
  mantle,
  linea,
  avalanche,
  blast,
  manta,
  mode,
] as const satisfies readonly Chain[];

const CHAIN_BY_ID = new Map<number, Chain>(PARTICLE_EVM_CHAINS.map((chain) => [chain.id, chain]));

export function getParticleEvmChain(chainId: number) {
  return CHAIN_BY_ID.get(chainId) ?? null;
}

export function isSupportedParticleEvmChain(chainId: number) {
  return CHAIN_BY_ID.has(chainId);
}
