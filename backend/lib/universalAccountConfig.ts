import {
  UNIVERSAL_ACCOUNT_VERSION,
  type UniversalAccountConfig,
} from "@particle-network/universal-account-sdk";

export function buildUniversalAccountConfig(input: {
  ownerAddress: string;
  useEIP7702: boolean;
}): UniversalAccountConfig {
  return {
    projectId: process.env.NEXT_PUBLIC_PROJECT_ID ?? "",
    projectClientKey: process.env.NEXT_PUBLIC_CLIENT_KEY ?? "",
    projectAppUuid: process.env.NEXT_PUBLIC_APP_ID ?? "",
    smartAccountOptions: {
      useEIP7702: input.useEIP7702,
      name: "UNIVERSAL",
      version: UNIVERSAL_ACCOUNT_VERSION,
      ownerAddress: input.ownerAddress,
    },
    tradeConfig: {
      slippageBps: 100,
      universalGas: true,
    },
  };
}
