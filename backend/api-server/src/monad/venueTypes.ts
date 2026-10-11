export type VenueOrderPhase = "accepted_for_forwarding" | "submitted" | "executed" | "partially_filled" | "filled" | "finalized" | "no_fill" | "canceled" | "failed" | "uncertain";
export type VenueCapability = "market_data" | "order_book" | "account_read" | "history" | "market_orders" | "limit_orders" | "linked_exits" | "margin_changes" | "owner_withdrawal";
export type VenueLimits = {
  collateralSymbol: string;
  collateralAddress: string;
  collateralDecimals: number;
  minAccountOpenUnits: string;
  minDepositUnits: string;
  minWithdrawalUnits: string;
  minFundingUnits: string;
  maxFundingUnits: string;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  maxLeverage: number;
};
export type VenueMarket = {
  id: number;
  symbol: string;
  name: string;
  isOpen: boolean;
  priceDecimals: number;
  sizeDecimals: number;
  initialMarginBps: number;
  maintenanceMarginBps: number;
  minPostingUnits?: string;
  maxLeverage: number;
  maxMarketSlippageBps: number;
  makerFeeMicros: number;
  takerFeeMicros: number;
  fundingRateMicros?: number;
  fundingIntervalSeconds?: number;
  fundingObservedAt?: number;
  orderTtlBlocks: number;
  price: { oracle: number; mark: number; last: number; mid: number; bid: number; ask: number; blockNumber: number; observedAt: number } | null;
  book?: { blockNumber: number; observedAt: number; bids: Array<{ price: number; size: number }>; asks: Array<{ price: number; size: number }> };
};
export type VenueAccountSnapshot = {
  accountId: number;
  profileAddress: string;
  balanceUnits: string;
  lockedUnits: string;
  forwardingEnabled: boolean;
  lastRequestId: number;
  positions: unknown[];
  orders: unknown[];
  observedAt: number;
  blockNumber: number;
};
export type VenueAction = { kind: string; marketId: number; accountId: number; side?: "long" | "short"; size: number; price?: number; leverage: number; flags?: number; validThroughBlock?: number; orderId?: number; linkedRequestId?: number; linkedPositionId?: number; triggerPrice?: number; triggerCondition?: number; collateralAmount?: string; requestId?: number; maxCollateralUnits?: string; maxExposureUnits?: string; maxLeverage?: number; maxSlippageBps?: number; allowedMarketIds?: number[]; activePositionCount?: number; expiresAt?: number; optimizerMetadata?: Record<string, unknown> };
export type VenueOrderResult = { requestId: number; phase: VenueOrderPhase; rawResponse: unknown };
export type VenueReconciliation = { phase: VenueOrderPhase; requestId: number; order: unknown | null; fills: unknown[]; events: unknown[]; rawResponse: unknown };

export interface PerplVenueAdapter {
  readonly venueId: string;
  readonly displayName: string;
  readonly chainId: number;
  readonly executionModel: "onchain_mock" | "onchain_exchange" | "offchain_exchange";
  readonly testOnly: boolean;
  readonly capabilities: readonly VenueCapability[];
  readContext(): Promise<{ chainId: number; exchangeAddress: string; instanceId: number; collateralTokenId: number;
    limits: VenueLimits; markets: VenueMarket[]; raw: unknown }>;
  readMarkets(marketIds?: number[], withBook?: boolean): Promise<VenueMarket[]>;
  readFinalizedMarkets(marketIds?: number[]): Promise<VenueMarket[]>;
  readAccount(accountId: number, credentials?: { apiKey: string; privateKeyHex: string; walletAddress?: string }): Promise<VenueAccountSnapshot>;
  submitAction(input: VenueAction, credentials: { apiKey: string; privateKeyHex: string; walletAddress?: string }): Promise<VenueOrderResult>;
  reconcileAction(requestId: number, accountId: number, credentials: { apiKey: string; privateKeyHex: string; walletAddress?: string }): Promise<VenueReconciliation>;
}
