import type { ITransaction, IUniversalTransaction } from "@particle-network/universal-account-sdk";
import type { AccountWalletProvider } from "@/lib/eip7702";
import type { TypedDataPayload } from "@/lib/typedDataPayload";

export const STRATEGY_CHAIN_ID = 42161 as const;

export type OwnerCapabilities = {
  shadow: true;
  approval: true;
  autopilot: boolean;
  eip7702Supported: boolean;
  arbitrumDelegated: boolean;
  reason: string;
};

export type OwnerSigner = {
  provider: AccountWalletProvider;
  ownerAddress: string | null;
  uaAddress: string | null;
  capabilities: OwnerCapabilities;
  createCall: (request: IUniversalTransaction) => Promise<ITransaction>;
  send: (transaction: ITransaction) => Promise<unknown>;
  signTypedData: (input: TypedDataPayload) => Promise<string>;
  enableArbitrumDelegation: () => Promise<unknown>;
};

export function ownerCapabilities(input: {
  eip7702Supported: boolean;
  delegatedChainIds: number[];
}): OwnerCapabilities {
  const arbitrumDelegated = input.delegatedChainIds.includes(STRATEGY_CHAIN_ID);
  return {
    shadow: true,
    approval: true,
    autopilot: input.eip7702Supported && arbitrumDelegated,
    eip7702Supported: input.eip7702Supported,
    arbitrumDelegated,
    reason: !input.eip7702Supported
      ? "This wallet can use Shadow and Approval, but it cannot grant an EIP-7702 Autopilot authority."
      : !arbitrumDelegated
        ? "Enable the Arbitrum delegation before activating Autopilot."
        : "Arbitrum delegation is active; deterministic policy checks still apply.",
  };
}
