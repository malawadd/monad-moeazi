export type MonadAsset = 'MON' | 'AUSD' | 'USDC' | 'WMON';
export type MonadAccountScope = 'wallet' | 'vault';
export type MonadVenueId = 'uniswap_v4_testnet' | 'moeazi_test_amm';
export type PerpVenueId = 'monad-mock-clearinghouse-v1' | 'perpl-testnet-v1' | 'perpl-direct-testnet-v1';

export type MonadBalance = {
  asset: MonadAsset;
  tokenAddress: string | null;
  amountUnits: string;
  decimals: number;
};

export type MonadWalletSnapshot = {
  ownerAddress: string;
  chainId: 10143;
  observedBlock: number;
  observedAt: string;
  stale: boolean;
  balances: MonadBalance[];
};

export type MonadEip1559Transaction = {
  chainId: number;
  type: 2;
  to: string;
  data: string;
  value: string;
  nonce: string;
  gasLimit: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
};

export type MonadOperationKind =
  | 'send_mon' | 'send_usdc' | 'claim_ausd_faucet' | 'wrap' | 'unwrap'
  | 'vault_deposit' | 'vault_return' | 'wallet_swap'
  | 'approve_token' | 'mandate_authorize' | 'mandate_revoke' | 'vault_stop' | 'vault_resume'
  | 'autonomy_recovery';

export type PreparedMonadOperation = {
  operationId: string;
  chainId: number;
  ownerAddress: string;
  kind: MonadOperationKind;
  expiresAt: string | number;
  transactionType: 'eip1559';
  transaction: MonadEip1559Transaction;
  review?: {
    summary?: string; amount?: string; asset?: string; recipient?: string; vaultAddress?: string;
    venue?: MonadVenueId; accountScope?: MonadAccountScope; tokenIn?: string; tokenOut?: string;
    pair?: string; tokenAddress?: string; spender?: string; amountUnits?: string; amountInUnits?: string;
    minAmountOutUnits?: string; inputDecimals?: number; outputDecimals?: number; quoteId?: string;
    faucetAddress?: string; method?: string; [key: string]: unknown;
  };
};

export type MonadOperationStatus = {
  operationId: string;
  status: 'prepared' | 'verified' | 'submitted' | 'executed' | 'finalized' | 'failed' | 'expired' | 'reverted';
  transactionHash?: string | null;
  blockNumber?: number | null;
  message?: string;
  faucetTransferVerified?: boolean;
  verifiedAmountUnits?: string;
};

export type MonadQuote = {
  quoteId: string;
  accountScope: MonadAccountScope;
  venue: MonadVenueId;
  tokenIn: string;
  tokenOut: string;
  amountInUnits: string;
  amountOutUnits: string;
  minimumAmountOutUnits: string;
  expiresAt: string | number;
  feeAmountUnits?: string;
  feeAsset?: string;
  feeProvenance: string;
  gas?: {gasLimit: string; maxFeePerGas: string; maxPriorityFeePerGas: string; maxCostWei: string};
};

export type MonadVenueCapability = {
  id: MonadVenueId;
  name: string;
  enabled: boolean;
  reason?: string | null;
  capabilities: {wallet: boolean; vault: boolean};
};

export type MonadMarketAsset = {id: string; symbol: string; address: string; decimals: number};

export type MonadMarket = {
  id: string;
  baseAsset: MonadMarketAsset;
  quoteAsset: MonadMarketAsset;
  venues: MonadVenueCapability[];
};

export type MonadMarketsResponse = {markets: MonadMarket[]};

export type MonadActivityEvent = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  status: string;
  occurredAt: string;
  fundsMoved: boolean;
  transactionHash?: string | null;
  amount?: string | null;
  asset?: string | null;
  venueId?: PerpVenueId | null;
  blockNumber?: number | null;
  details?: Array<{label: string; value: string}>;
};
export type MonadActivityPage = {events: MonadActivityEvent[]; nextCursor: string | null; hasMore: boolean};

export type MonadAgentSnapshot = {
  state: 'inactive' | 'blocked' | 'scheduled' | 'running';
  enabled: false;
  summary: string;
  blockers: string[];
  observedAt?: string;
};

export type MonadTypedData = {
  domain: {chainId?: number | string; verifyingContract?: string; [key: string]: unknown};
  types: Record<string, Array<{name: string; type: string}>>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type PreparedMonadMandate = {
  mandateId: string;
  ownerAddress: string;
  vaultAddress: string;
  chainId: number;
  expiresAt: string | number;
  nonce: string;
  validAfter?: string | number;
  review?: {
    amount?: string; amountUnits?: string; amountPerTradeUnits?: string; asset?: string;
    durationDays?: number; validAfter?: string | number; expiresAt?: string | number;
    assets?: unknown; adapters?: unknown; allowedAdapters?: unknown; caps?: unknown;
    tokenIn?: string; tokenOut?: string; [key: string]: unknown;
  };
  typedData: MonadTypedData;
};

export type MonadMandate = {
  mandateId: string;
  ownerAddress: string;
  vaultAddress: string | null;
  status: 'signed' | 'active' | 'revoked' | 'stopped' | 'inactive' | 'expired';
  vaultStopped?: boolean;
  authorizedAt?: string | null;
  expiresAt?: string | number | null;
  limits?: Record<string, string | number>;
  vaultBalances?: Array<{asset: 'USDC' | 'WMON'; tokenAddress: string | null; amountUnits: string; decimals: number; observedBlock: number; stale: boolean}>;
};

export type MonadMandateResponse = {mandate: MonadMandate | null};
