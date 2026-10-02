export type TradeVenueId = "hyperliquid" | "lighter" | "orderly" | "gmx" | "ostium";

export type TradeSide = "long" | "short";

export type MarketCategory = "crypto" | "rwa";

export type CostBreakdown = {
  entryFeeUsd: number;
  exitFeeUsd: number;
  transferCostUsd: number;
  entrySlippageUsd: number;
  exitSlippageUsd: number;
  fundingUsd: number;
  totalCostUsd: number;
};

export type VenueLevel = {
  price: number;
  size: number;
};

export type PerpMarket = {
  id: string;
  label: string;
  baseSymbol: string;
  quoteSymbol: "USDC";
  category: MarketCategory;
  pricePrecision: number;
  maxLeverage: number;
  szDecimals?: number;
  assetIndex?: number;
  onlyIsolated?: boolean;
  isDelisted?: boolean;
  markPrice?: number | null;
  oraclePrice?: number | null;
  prevDayPrice?: number | null;
  dayChangePct?: number | null;
  dayBaseVolume?: number | null;
  openInterestUsd?: number | null;
  volume24hUsd?: number | null;
  fundingRateHourly?: number | null;
  fetchedAt?: number;
  venues: TradeVenueId[];
};

export type VenueCapabilities = {
  venue: TradeVenueId;
  label: string;
  kind: "clob" | "onchain";
  maxLeverage: number;
  minNotionalUsd: number;
  takerFeeBps: number;
  makerFeeBps: number;
  transferCostUsd: number;
};

export type VenueSnapshot = {
  venue: TradeVenueId;
  marketId: string;
  coin?: string;
  assetIndex?: number;
  szDecimals?: number;
  maxLeverage?: number;
  midPrice: number;
  markPrice?: number;
  oraclePrice?: number;
  prevDayPrice?: number;
  dayChangePct?: number;
  bidPrice: number;
  askPrice: number;
  bids?: VenueLevel[];
  asks?: VenueLevel[];
  entryImpactBps: number;
  exitImpactBps: number;
  fundingRateHourly: number;
  dayBaseVolume?: number;
  openInterestUsd: number;
  volume24hUsd: number;
  fetchedAt: number;
  source: "public" | "fixture";
};

export type RouteInput = {
  marketId: string;
  coin?: string;
  side: TradeSide;
  marginUsd: number;
  leverage: number;
  holdTimeHours?: number | null;
  slippageCapBps: number;
  now?: number;
};

export type VenueQuote = {
  venue: TradeVenueId;
  venueLabel: string;
  kind: "clob" | "onchain";
  eligible: boolean;
  accountReady?: boolean;
  executable?: boolean;
  setupRequirement?: string | null;
  reason?: string;
  source: "public" | "fixture" | "none";
  midPrice: number | null;
  estimatedEntryPrice: number | null;
  estimatedExitPrice: number | null;
  notionalUsd: number;
  marginUsd: number;
  maxLeverage: number;
  availableDepthUsd?: number | null;
  feeRateBps: number;
  freshnessMs: number | null;
  costs: CostBreakdown;
};

export type BestExecutionQuote = {
  input: RouteInput;
  market: PerpMarket;
  notionalUsd: number;
  benchmarkVenue: TradeVenueId | null;
  winningVenue: TradeVenueId | null;
  bestMarketVenue?: TradeVenueId | null;
  bestExecutableVenue?: TradeVenueId | null;
  selectedVenue?: TradeVenueId | null;
  overrideApplied?: boolean;
  warnings?: string[];
  quotes: VenueQuote[];
  createdAt: number;
};

export type TradeSettings = {
  defaultMarketId: string;
  defaultLeverage: number;
  defaultMarginUsd: number;
  slippageCapBps: number;
  expectedHoldHours: number | null;
  requireConfirmation: boolean;
};

export type TradeIntentStatus =
  | "queued"
  | "quoted"
  | "funding_submitted"
  | "funding_confirmed"
  | "order_submitting"
  | "open"
  | "close_submitting"
  | "closed"
  | "failed"
  | "cancelled";

export type PerpVenueAdapter = {
  venue: TradeVenueId;
  getQuote(input: RouteInput): Promise<VenueSnapshot | null>;
};
