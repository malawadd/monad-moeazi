import type {MonadTypedData} from './monad';

export type PerpMarket = {index: number; name: string; symbol: string; tokenAddress: string; poolAddress: string};
export type PerpPolicy = {
  version: number; minLeverage: number; maxLeverage: number; maxMarginUnits: string;
  maxPayoutMultiple: number; reserveMultiple: number; maxConcurrentPositions: number;
  allowedDirections: Array<'long' | 'short'>; markets: string[];
};
export type PreparedPerpEnrollment = {
  runId: string; enrollmentId: string; ownerAddress: string; vaultAddress: string; chainId: number;
  nonce: string; amountUnits: string; durationSeconds: number; setupDeadline: number;
  preparedExpiresAt: number; policy: PerpPolicy; markets: PerpMarket[];
  usdcAuthorizationTypedData: MonadTypedData; mandateTypedData: MonadTypedData;
};
export type PerpEvent = {
  id?: string; eventId?: string; type: string; status: string; summary: string; timestamp: string;
  txHash?: string | null; transactionHash?: string | null; orderId?: string | null;
  finalizedBlockNumber?: string | null; blockNumber?: string | null; timestampIso?: string;
  realizedPnlUsdcUnits?: string | null; amountUnits?: string | null;
  details?: Record<string, unknown>; payload?: Record<string, unknown>;
};
export type PerpPosition = {
  isOpen?: boolean; isLong?: boolean; marketIndex?: number; market?: string; symbol?: string;
  direction?: 'long' | 'short'; sizeWad?: string; marginUsdc?: string; leverage?: number; entryPriceWad?: string;
  markPriceWad?: string; unrealizedPnlUsdcUnits?: string; liquidationPriceWad?: string;
  takeProfitWad?: string | null; stopLossWad?: string | null; openedAt?: number;
  fundingAccruedUsdc?: string;
};
export type PerpPendingOrder = {
  orderId: string; type?: string; side?: string; market?: string; status?: string; marketIndex?: number;
  isLong?: boolean; leverage?: number; marginUsdc?: string; limitPriceWad?: string; goodUntil?: number;
};
export type PerpRun = {
  runId: string; enrollmentId?: string; ownerAddress: string; vaultAddress: string; chainId: 10143;
  status: string; startingUsdcUnits: string; availableUsdcUnits: string; realizedPnlUsdcUnits: string;
  returnedUsdcUnits?: string | null;
  unrealizedPnlUsdcUnits?: string; operatorGasMonWei: string; equityUsdcUnits?: string;
  markPriceWad?: string; startedAt?: string; activatedAt?: number | null; expiresAt?: string | null; observedAt?: string;
  lastFinalizedBlock?: string | null; position?: PerpPosition | null; pendingOrder?: PerpPendingOrder | null;
  fundingStatus?: string; fundingHash?: string | null; fundingTransactionHash?: string | null; markets: PerpMarket[]; events: PerpEvent[];
};
export type PerpCurrentResponse = {current: PerpRun | null};
export type PerpRunsPage = {runs: PerpRun[]; nextCursor: string | null; hasMore: boolean};
export type PerpRunEventsPage = {run: PerpRun; events: PerpEvent[]; nextCursor: string | null; hasMore: boolean};
export type PerpStopReview = {runId: string; vaultAddress: string; chainId: number; idempotencyKey: string; typedData: MonadTypedData};
export type PerpStopResult = {runId: string; status: string; phase: string; transactionHash: string | null; orderId?: string};
