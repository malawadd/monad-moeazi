declare module "@particle-network/universal-account-sdk" {
  export enum CHAIN_ID {
    SOLANA_MAINNET = 101,
    ETHEREUM_MAINNET = 1,
    BSC_MAINNET = 56,
    BASE_MAINNET = 8453,
    XLAYER_MAINNET = 196,
    ARBITRUM_MAINNET_ONE = 42161,
    OPTIMISM_MAINNET = 10,
    POLYGON_MAINNET = 137,
    SONIC_MAINNET = 146,
    BERACHAIN_MAINNET = 80094,
    MANTLE_MAINNET = 5000,
    MONAD_MAINNET = 143,
    LINEA_MAINNET = 59144,
    AVALANCHE_MAINNET = 43114,
    BLAST_MAINNET = 81457,
    MANTA_MAINNET = 169,
    MODE_MAINNET = 34443,
  }

  export enum SUPPORTED_TOKEN_TYPE {
    ETH = "eth",
    USDT = "usdt",
    USDC = "usdc",
    BTC = "btc",
    BNB = "bnb",
    SOL = "sol",
  }

  export const ZeroAddress: string;
  export const UNIVERSAL_ACCOUNT_VERSION: string;

  export type IToken = {
    assetId?: string;
    type?: SUPPORTED_TOKEN_TYPE;
    chainId: number;
    address: string;
    decimals: number;
    realDecimals: number;
    symbol?: string;
    name?: string;
    isPrimaryToken?: boolean;
    price?: number;
  };

  export const SUPPORTED_TARGET_TOKENS: IToken[];
  export const SUPPORTED_PRIMARY_TOKENS: IToken[];

  export type UniversalAccountToken = {
    chainId: number;
    address: string;
  };

  export type ITransferTransaction = {
    token: UniversalAccountToken;
    amount: string;
    receiver: string;
  };

  export type ITokenWithUSD = {
    token: IToken;
    amount: string;
    amountInUSD: string;
    senderAddress: string;
  };

  export type IChainAggregation = {
    token: IToken;
    amount: number;
    amountInUSD: number;
    rawAmount: number;
  };

  export type IAsset = {
    tokenType: string;
    price: number;
    amount: number;
    amountInUSD: number;
    chainAggregation: IChainAggregation[];
  };

  export type IAssetsResponse = {
    totalAmountInUSD: number;
    assets: IAsset[];
  };

  export type IUserOpWithChain = {
    chainId: number;
    userOpHash: string;
    eip7702Auth?: {
      chainId: number;
      nonce: number;
      address: string;
    };
    eip7702Delegated?: boolean;
  };

  export type ITransaction = {
    rootHash: string;
    transactionId: string;
    userOps?: IUserOpWithChain[];
    tokenChanges?: unknown;
    transactionFees?: unknown;
  };

  export type EIP7702Authorization = {
    userOpHash: string;
    signature: string;
  };

  export type IUniversalTransaction = {
    chainId: number;
    expectTokens: Array<{ type?: string; amount: string }>;
    transactions: unknown[];
  };

  export type UniversalAccountConfig = {
    projectId: string;
    projectClientKey: string;
    projectAppUuid: string;
    ownerAddress?: string;
    smartAccountOptions?: {
      useEIP7702?: boolean;
      name: string;
      version: string;
      ownerAddress: string;
      smartAccountAddress?: string;
      solanaSmartAccountAddress?: string;
    };
    tradeConfig?: {
      slippageBps?: number;
      universalGas?: boolean;
      usePrimaryTokens?: string[];
    };
    rpcUrl?: string;
  };

  export class UniversalAccount {
    constructor(config: UniversalAccountConfig);
    getSmartAccountOptions(): Promise<{
      ownerAddress?: string;
      smartAccountAddress?: string;
      solanaSmartAccountAddress?: string;
    }>;
    getPrimaryAssets(): Promise<IAssetsResponse>;
    createTransferTransaction(input: ITransferTransaction): Promise<ITransaction>;
    createUniversalTransaction(input: IUniversalTransaction, tradeConfig?: unknown): Promise<ITransaction>;
    sendTransaction(
      transaction: ITransaction,
      signature: string,
      authorizations?: EIP7702Authorization[],
    ): Promise<{ transactionId?: string }>;
    getEIP7702Deployments(): Promise<unknown>;
    getEIP7702Auth(chainIds: number[]): Promise<unknown>;
  }
}
