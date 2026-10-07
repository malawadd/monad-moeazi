export const MONAD_TESTNET_USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3';

export type AutonomyTypedData = {
  domain: Record<string, unknown>;
  types: Record<string, Array<{name: string; type: string}>>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type PreparedAutonomyEnrollment = {
  enrollmentId: string;
  ownerAddress: string;
  vaultAddress: string;
  chainId: number;
  nonce: string;
  startBy: string | number;
  preparedExpiresAt: string | number;
  amountUnits: string;
  durationSeconds: number;
  maxCycles: number;
  maxBuyUnits: string;
  buySlippageBps: number;
  sellSlippageBps: number;
  tokens: string[];
  pools: string[];
  usdcAuthorizationTypedData: AutonomyTypedData;
  mandateTypedData: AutonomyTypedData;
};

export type AutonomyEnrollmentResult = {
  enrollmentId: string;
  status: string;
  ownerAddress: string;
  vaultAddress: string;
  chainId: 10143;
  fundingTransactionHash?: string | null;
  fundingBlockNumber?: string | null;
  message?: string;
};

export type AutonomyRunState =
  | 'prepared' | 'activation_pending' | 'active' | 'settling' | 'completed'
  | 'incomplete_settlement' | 'recovered' | 'uncertain' | 'failed' | 'expired';

export type AutonomyDecision = {
  action?: 'buy' | 'sell' | 'hold';
  reasonCode?: string;
  signal?: AutonomyPriceSignal | null;
  ruleVersion?: string | null;
  evaluatedAt?: string;
  rejected?: Array<{tokenIndex: number; reasonCode: string}>;
  finalizedBlockNumber?: string | null;
};

export type AutonomyPriceSignal = {tokenIndex: number; changeBps: number; priceUsdcPerTokenWad: string};

export type AutonomyReceipt = {
  transactionHash: string;
  status: 'submitted' | 'confirmed' | 'finalized' | 'failed' | 'reverted';
  blockNumber?: string | null;
  finalizedAt?: string | null;
};

export type AutonomyEvent = {
  id: string;
  type: string;
  status: string;
  timestamp: string;
  summary: string;
  signal?: AutonomyPriceSignal | null;
  ruleVersion?: string | null;
  tokenAddress?: string | null;
  poolAddress?: string | null;
  amountInUnits?: string | null;
  amountOutUnits?: string | null;
  realizedPnlUsdcUnits?: string | null;
  finalizedBlockNumber?: string | null;
  txHash?: string | null;
  rejectedReason?: string | null;
  orderId?: string | null;
};

export type AutonomyRun = {
  enrollmentId: string;
  runId: string;
  ownerAddress: string;
  vaultAddress: string;
  chainId: 10143;
  status: string;
  startingUsdcUnits: string;
  availableUsdcUnits: string;
  realizedPnlUsdcUnits: string;
  operatorGasMonWei: string;
  cyclesCompleted: number;
  maxCycles: 3;
  startedAt?: string;
  expiresAt: string | null;
  observedAt?: string;
  finalizedBlockNumber?: string | null;
  openPosition?: {
    tokenIndex: number;
    tokenAddress: string;
    tokenSymbol: string;
    amountUnits: string;
    entryPriceUsdcPerTokenWad: string;
    peakPriceUsdcPerTokenWad: string;
    enteredAt: string;
    cycle: number;
  } | null;
  latestDecision?: AutonomyDecision | null;
  latestReceipt?: AutonomyReceipt | null;
  events: AutonomyEvent[];
};

export type AutonomyCurrentResponse = {current: AutonomyRun | null};
export type AutonomyHistoryResponse = {runs: AutonomyRun[]};
