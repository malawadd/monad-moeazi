import type {MonadEip1559Transaction} from './monad';

export type ManualPerplAccountMode = 'direct_wallet' | 'legacy_delegated';
export type ManualPerplCapability = 'approve' | 'open' | 'createAccount' | 'deposit' | 'withdraw' | 'marketOrders' | 'limitOrders'
  | 'cancelOrders' | 'closePosition' | 'reducePosition';
export type ManualPerplCapabilities = Record<ManualPerplCapability, boolean>;

export type ManualPerplPosition = {
  marketId: number | string;
  symbol: string;
  side: 'long' | 'short' | string;
  sizeUnits: string;
  entryPrice: string;
  markPrice: string;
  priceDecimals?: number | null;
  sizeDecimals?: number | null;
  leverage: number;
  unrealizedPnlUnits: string;
  [field: string]: unknown;
};

export type ManualPerplOrder = {
  orderId: string;
  marketId: number | string;
  symbol?: string;
  side: string;
  sizeUnits: string;
  price?: string | null;
  /** Perpl order snapshots may expose both ONS (`price`) and normalized PNS. */
  pricePNS?: string | null;
  priceONS?: string | null;
  priceUnitSystem?: 'PNS' | 'ONS' | string;
  status: string;
  [field: string]: unknown;
};

export type ManualPerplLegacyRecovery = {
  accountMode: 'legacy_delegated' | null;
  status: 'none' | 'created' | 'open' | 'unavailable';
  accountAddress: string | null;
  accountId: number | string | null;
  error?: string;
  collateral: {balanceUnits: string; lockedUnits: string; tokenBalanceUnits: string};
  positions: ManualPerplPosition[];
  orders: ManualPerplOrder[];
  capabilities: {withdraw: boolean; rescueTokens: boolean; marketOrders: boolean; limitOrders: boolean;
    cancelOrders: boolean; closePosition: boolean; reducePosition: boolean};
};

export type ManualPerplAccount = {
  chainId: 10143;
  ownerAddress: string;
  exchangeAddress: string;
  accountMode: 'direct_wallet' | 'not_created' | 'unavailable';
  accountAddress: string | null;
  accountId: number | string | null;
  status: 'not_created' | 'open' | 'unavailable';
  collateral: {symbol: 'AUSD'; address: string; decimals: 6; balanceUnits: string; lockedUnits: string;
    walletBalanceUnits: string; allowanceUnits: string};
  positions: ManualPerplPosition[];
  orders: ManualPerplOrder[];
  observedAt: number | string;
  blockNumber: number | string;
  capabilities: ManualPerplCapabilities;
  legacyRecovery: ManualPerplLegacyRecovery;
  unavailable?: boolean;
};

export type ManualPerplTransaction = Omit<MonadEip1559Transaction, 'type'> & {type: 2 | 'eip1559'};
export type ManualPerplPreparedOperation = {
  operationId: string;
  venueId: string;
  chainId: 10143;
  status: 'prepared' | string;
  action: string;
  review: Record<string, unknown> & {ownerAddress?: string; chainId?: number; accountAddress?: string | null;
    accountMode?: ManualPerplAccountMode; venueId?: string; marketId?: number | string; kind?: string;
    side?: string; sizeUnits?: string; limitPrice?: string; leverage?: number; orderId?: number | string | null;
    transactionTarget?: string; transactionData?: string; transactionNonce?: string; expiresAt?: string | number; [field: string]: unknown};
  transaction: ManualPerplTransaction;
  expiresAt: string | number;
};

export type ManualPerplOperationStatus = {
  operationId: string;
  status: 'prepared' | 'submitted' | 'uncertain' | 'finalized' | 'failed' | 'no_fill' | 'expired';
  chainId?: number;
  venueId?: string;
  expiresAt?: string | number;
  action?: string;
  review?: Record<string, unknown>;
  transactionHash?: string | null;
  receipt?: Record<string, unknown> | null;
  fill?: ManualPerplFill[] | null;
  result?: Record<string, unknown> | null;
  message?: string;
};

export type ManualPerplFill = {
  kind?: string;
  amountCNS?: string;
  feeCNS?: string;
  pricePNS?: string;
  lotLNS?: string;
  [field: string]: unknown;
};
