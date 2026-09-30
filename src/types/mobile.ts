export type AiState =
  | 'needs_funds'
  | 'needs_credits'
  | 'ready'
  | 'starting'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'emergency_stopped';

export type PrimaryAction =
  | 'deposit'
  | 'buy_credits'
  | 'start'
  | 'stop'
  | 'fix_issue'
  | 'review_safety';

export type LatestAiUpdate = {
  state: 'checking' | 'hold' | 'acted' | 'blocked';
  summary: string;
  occurredAt: string;
  activityId?: string;
};

export type ControllerRef = {
  schemaVersion: 1;
  environment: 'live' | 'experiment';
  strategyAccountId: string;
  controllerKind: 'customer_team' | 'managed_program';
  controllerId: string;
  controllerVersionId: string;
  contentHash: string;
};

export type AssignmentState =
  | 'unassigned'
  | 'paused'
  | 'active'
  | 'ambiguous_assignment'
  | 'invalid_assignment';

export type MobileHomeSnapshot = {
  schemaVersion: '2026-09-01';
  totalBalanceUsd: string;
  managedBalanceUsd: string;
  walletBalanceUsd?: string;
  managedVaultCapitalUsdc?: string | null;
  marketCheckStatus?: 'active' | 'missing' | 'unavailable';
  analysisProviderStatus?: 'available' | 'unavailable' | 'unknown';
  nextMarketCheckAt?: string | null;
  watchedMarkets?: string[];
  availableCredits: number;
  aiState: AiState;
  primaryAction: PrimaryAction;
  statusMessage: string;
  blockingReason?: string;
  staleAt?: string;
  latestAiUpdate?: LatestAiUpdate;
  assignmentState?: AssignmentState;
  assignmentId?: string | null;
  managedPositionClosureUnconfirmed?: boolean;
  programVersionId?: string | null;
  agentReleaseVersionId?: string | null;
  agentModels?: Array<{slot: string; provider: string; model: string}>;
  controllerRef?: ControllerRef | null;
};

export type ManagedCloseResult = {
  status: 'blocked' | 'pending' | 'submitted' | 'confirmed_flat';
  code: string;
  message: string;
  positionClosure: 'unconfirmed' | 'confirmed_flat';
  operationId?: string;
  admissionStopped?: boolean;
  submittedOperationMayStillSettle?: boolean;
  unsettledOperationCount?: number;
  exitGrant?: {verified: boolean; expiresAt: number};
  position?: {wethUnits: string; blockNumber: string; blockHash: string};
  closure?: {confirmed: boolean; zeroExposure: boolean; allOperationsSettled: boolean;
    finalizedBlock: string; finalizedBlockHash: string; receiptId: string};
};

export type AutopilotLimits = {
  managedAmountUsd: string;
  managedVaultCapitalUsdc?: string | null;
  allowedMarkets: string[];
  maxPositionUsd: string;
  maxSingleOrderUsd?: string | null;
  maxDailyLossUsd?: string | null;
  dailyLossStopPercent: string;
  cadenceLabel: string;
  availableCredits: number;
  walletReady: boolean;
  venueReady: boolean;
  authorityReceiptReady?: boolean;
  assignmentState?: AssignmentState;
  assignmentId?: string | null;
  programVersionId?: string | null;
  agentReleaseVersionId?: string | null;
  agentModels?: Array<{slot: string; provider: string; model: string}>;
  controllerRef?: ControllerRef | null;
  assignmentReady?: boolean;
  liveTradingEnabled?: boolean;
  explicitAssignmentReady?: boolean;
  modeConfirmationRequired?: boolean;
  durableStartReady?: boolean;
  activationBlockers?: string[];
  scopedUniswapGrant?: ManagedProgramGrantContext | {contextAvailable: false; code?: string; blockingReason?: string};
};

export type ManagedProgramEnrollment = {
  state: 'disabled' | 'not_allowlisted' | 'blocked' | 'already_enrolled' | 'existing_assignment' | 'enrolled_paused';
  assignmentId?: string;
  programVersionId?: string;
  contentHash?: string;
  reason?: string;
};

export type ManagedProgramGrantContext = {
  contextAvailable: true;
  strategyAccountId: string;
  assignmentId: string;
  programVersionId: string;
  contentHash: string;
  policyHash: string;
  ownerAddress: string;
  venueAccountId: string;
  executionGrantId: string;
  expiresAt: number;
  bounds: {maxUsdcUnits: string; maxWethUnits: string; minWethOutUnits: string; minUsdcOutUnits: string};
  ownerSignaturesRequired: ['buy', 'exit'];
  broadcastEnabled: false;
};

export type ManagedScopedGrant = {
  grantId: string;
  scope: 'buy' | 'exit';
  owner: string;
  state: 'awaiting-owner' | 'active';
  policyHash: string;
  expiresAt: number;
  ownerApproval: {domain: Record<string, unknown>; types: Record<string, Array<{name: string; type: string}>>;
    primaryType: 'Enable'; message: Record<string, unknown>};
  sessionAddress: string;
  review: {chainId: 42161; router: string; tokenIn: string; tokenOut: string; feeTier: number;
    recipient: string; maximumInputUnits: string; minimumOutputUnits: string; earliestDeadline: number;
    latestDeadline: number; maxCalls: 1; callValueWei: '0'};
};

export type ScopedGrantPreparation = {
  grantId: string;
  grants: ManagedScopedGrant[];
  ownerAllowanceCalls: Array<{to: string; value: '0' | 0; data: string; token: string; amount: string}>;
  allowance: {blockNumber: string; blockHash: string; owner: string; usdcBalanceUnits: string;
    usdcAllowanceUnits: string; wethBalanceUnits: string; wethAllowanceUnits: string;
    buyReady: boolean; exitAllowanceReady: boolean};
  ownerActionsRequired: true;
  activationReceiptReady: false;
  liveTradingEnabled: false;
};

export type ScopedGrantAllowance = {
  grantId: string; scope: 'buy' | 'exit'; owner: string; blockNumber: string; blockHash: string;
  token: string; requiredUnits: string; balanceUnits: string; allowanceUnits: string; ready: boolean;
  balanceReady: boolean; allowanceReady: boolean; spendReady: boolean; activationReady: boolean;
  activationReceiptReady: false; liveTradingEnabled: false;
};

export type FundingSnapshot = {
  schemaVersion: '2026-09-01';
  ownerAddress: string;
  depositAddress: string;
  universalAccount: string;
  network: 'Arbitrum';
  chainId: 42161;
  status: 'waiting' | 'available' | 'failed';
  tradingAsset: {
    symbol: 'USDC'; amount: string; amountUsd: string;
    contractAddress: string; decimals: 6;
  };
  feeAsset: {symbol: 'ETH'; amount: string; decimals: 18};
  observedBlock?: number;
  observedAt?: string;
  stale: boolean;
};

export type CreditPack = {
  id: string;
  catalogVersion: string;
  name: string;
  priceLabel: string;
  credits: number;
  usageLabel: string;
  featured?: boolean;
};

export type PurchaseResult =
  | {ok: true; productId: string; purchaseToken: string}
  | {ok: false; code: 'BILLING_NOT_CONFIGURED' | 'CANCELLED' | 'FAILED'; message: string};

export type ActivityItem = {
  id: string;
  category: 'AI' | 'Trades' | 'Money' | 'Credits' | 'Safety';
  title: string;
  summary: string;
  result: string;
  fundsMoved: boolean;
  requiresAction: boolean;
  timeLabel: string;
  details?: Array<{label: string; value: string}>;
};

export type MarketSummary = {
  id: string;
  name: string;
  price: string;
  movement: string;
  explanation: string;
  aiInterest: 'Watching' | 'Low' | 'High';
  exposure: string;
};
