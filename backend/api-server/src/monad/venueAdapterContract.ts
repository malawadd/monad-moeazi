import type { JsonRpcProvider, Wallet } from "ethers";
import type { PerplContext } from "./perplContext.js";
import type { VenueAccountSnapshot, VenueAction, VenueMarket, VenueOrderResult, VenueReconciliation } from "./venueTypes.js";

export type VenueOperationInput = {
  provider?: JsonRpcProvider;
  wallet?: Wallet;
  ownerAddress?: string;
  run?: unknown;
  deployment?: unknown;
  accountId?: number;
  blockNumber?: number;
  observedAt?: number;
  marketIds?: number[];
  withBook?: boolean;
  finalized?: boolean;
  action?: unknown;
  decision?: unknown;
  tickId?: string;
  order?: unknown;
  requestId?: number;
  finalizedBlock?: number;
  credentials?: { apiKey: string; privateKeyHex: string; walletAddress?: string };
  [key: string]: unknown;
};

export type VenueOperationResult<T = unknown> = {
  venueId: string;
  phase: string;
  data: T | null;
  rawResponse?: unknown;
  reason?: string;
};

export type PerplEnrollmentReview = { ownerAddress: string | null; terms: unknown; limits: PerplContext["limits"];
  eligibleMarkets: VenueMarket[]; requiresOwnerMandate: true; requiresOperatorKey: true };
export type PerplSettlementReview = { flat: boolean; accountId: number; balanceUnits: string; lockedUnits: string; reason: string | null };

export interface VenueAdapter<TContext = unknown, TEnrollment = unknown, TMarket = unknown, TAccount = unknown,
  TAction = unknown, TReconciliation = unknown, TSettlement = unknown> {
  readonly venueId: string;
  readonly displayName: string;
  readonly chainId: number;
  readonly executionModel: "onchain_mock" | "onchain_exchange" | "offchain_exchange";
  readonly testOnly: boolean;
  readonly capabilities: readonly string[];
  readContext(input?: VenueOperationInput): Promise<VenueOperationResult<TContext>>;
  prepareEnrollment(input: VenueOperationInput): Promise<VenueOperationResult<TEnrollment>>;
  readMarkets(input: VenueOperationInput): Promise<VenueOperationResult<TMarket[]>>;
  readAccount(input: VenueOperationInput): Promise<VenueOperationResult<TAccount>>;
  submitAction(input: VenueOperationInput): Promise<VenueOperationResult<TAction>>;
  reconcileAction(input: VenueOperationInput): Promise<VenueOperationResult<TReconciliation>>;
  settleRun(input: VenueOperationInput): Promise<VenueOperationResult<TSettlement>>;
}

export type AnyVenueAdapter = VenueAdapter<any, any, any, any, any, any, any>;
export type PerplRegisteredVenueAdapter = VenueAdapter<PerplContext, PerplEnrollmentReview, VenueMarket,
  VenueAccountSnapshot, VenueOrderResult, VenueReconciliation, PerplSettlementReview>;

export function assertVenueAdapterContract(adapter: AnyVenueAdapter) {
  if (!adapter.venueId || adapter.venueId !== adapter.venueId.trim().toLowerCase()
    || !Number.isSafeInteger(adapter.chainId) || adapter.chainId < 1
    || !["readContext", "prepareEnrollment", "readMarkets", "readAccount", "submitAction", "reconcileAction", "settleRun"]
      .every((method) => typeof adapter[method as keyof VenueAdapter] === "function")) {
    throw new Error("Venue adapter does not implement the shared venue contract.");
  }
}
