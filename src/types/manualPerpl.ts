import type {MonadEip1559Transaction} from './monad';

export type ManualPerplCapability = 'createAccount' | 'fundAccount' | 'openAccount' | 'deposit' | 'withdraw'
  | 'marketOrders' | 'limitOrders' | 'cancelOrders' | 'closePosition' | 'reducePosition';
export type ManualPerplCapabilities = Record<ManualPerplCapability, boolean>;

export type ManualPerplPosition = {
  marketId: number | string;
  symbol: string;
  side: 'long' | 'short' | string;
  sizeUnits: string;
  entryPrice: string;
  markPrice: string;
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
  status: string;
  [field: string]: unknown;
};

export type ManualPerplAccount = {
  chainId: 10143;
  ownerAddress: string;
  accountAddress: string | null;
  accountId: number | string | null;
  status: 'not_created' | 'created' | 'open' | 'unavailable';
  collateral: {symbol: 'AUSD'; address: string; decimals: 6; balanceUnits: string; lockedUnits: string};
  positions: ManualPerplPosition[];
  orders: ManualPerplOrder[];
  observedAt: number | string;
  blockNumber: number | string;
  capabilities: ManualPerplCapabilities;
};

export type ManualPerplTransaction = Omit<MonadEip1559Transaction, 'type'> & {type: 2 | 'eip1559'};
export type ManualPerplPreparedOperation = {
  operationId: string;
  venueId: string;
  chainId: 10143;
  status: 'prepared' | string;
  action: string;
  review: Record<string, unknown> & {ownerAddress?: string; chainId?: number; accountAddress?: string | null;
    venueId?: string; marketId?: number | string; kind?: string; side?: string; sizeUnits?: string;
    limitPrice?: string; leverage?: number; orderId?: number | string | null; [field: string]: unknown};
  transaction: ManualPerplTransaction;
  expiresAt: string | number;
};

export type ManualPerplOperationStatus = {
  operationId: string;
  status: 'prepared' | 'submitted' | 'uncertain' | 'finalized' | 'failed' | 'no_fill';
  receipt?: Record<string, unknown> | null;
  fill?: Record<string, unknown> | null;
  message?: string;
};
