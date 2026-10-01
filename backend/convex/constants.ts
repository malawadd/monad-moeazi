export const STRATEGY_SLUG = "link_usdc_delta_neutral_v1";

export const VENUE_ROLES = {
  arbitrumOwner: "arbitrum_ua_owner",
  optimismExecution: "optimism_execution_wallet",
  hyperliquidMaster: "hyperliquid_master_wallet",
  hyperliquidAgent: "hyperliquid_agent_wallet",
} as const;

export const STRATEGY_STATUS = {
  provisioning: "provisioning",
  ready: "ready",
  active: "active",
  paused: "paused",
  emergencyStopped: "emergency_stopped",
} as const;

export const VENUE_ACCOUNT_STATUS = {
  provisioning: "provisioning",
  ready: "ready",
  approvalRequired: "approval_required",
  paused: "paused",
} as const;

export const EXECUTION_STATUS = {
  queued: "queued",
  submitted: "submitted",
  confirmed: "confirmed",
  failed: "failed",
  skipped: "skipped",
} as const;

export const ALERT_SEVERITY = {
  info: "info",
  warning: "warning",
  critical: "critical",
} as const;

export const STRATEGY_HEALTH_STATUS = {
  bootstrapping: "bootstrapping",
  ready: "ready",
  degraded: "degraded",
  paused: "paused",
  unwinding: "unwinding",
  withdrawalBlocked: "withdrawal_blocked",
} as const;

export const EXECUTION_MODE = {
  live: "live",
  shadow: "shadow",
} as const;

export const VENUE_SYNC_STATUS = {
  never: "never",
  fresh: "fresh",
  stale: "stale",
  error: "error",
} as const;

export const WITHDRAWAL_STATUS = {
  draft: "draft",
  pendingChecks: "pending_checks",
  queued: "queued",
  signing: "signing",
  submitted: "submitted",
  confirming: "confirming",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
  requested: "requested",
  processing: "processing",
  rejected: "rejected",
} as const;

export const WITHDRAWAL_REVIEW_STATUS = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  notRequired: "not_required",
} as const;

export const DEFAULT_STRATEGY_CONFIG = {
  allowedPairs: ["LINK/USDC"],
  arbThresholdBps: 5,
  hedgeThresholdUsd: 10,
  minArbTradeUsd: 1,
  maxArbTradeUsd: 5,
  pollIntervalSeconds: 2,
  maxDailyDrawdownPct: 8,
  maxSlippageBps: 250,
  executionMode: EXECUTION_MODE.shadow,
  maxSingleActionUsd: 25,
  maxDailyVolumeUsd: 250,
  rebalanceCooldownSeconds: 45,
  hedgeTwapThresholdUsd: 100,
  minLiquidityUsd: 5_000,
  maxMarketDataAgeMs: 15_000,
  maxPositionDriftUsd: 25,
  withdrawCooldownSeconds: 120,
};

export const OPTIMISM_CAIP2 = "eip155:10";
export const ARBITRUM_CAIP2 = "eip155:42161";

export const UNISWAP_LINK_ADDRESS = "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4";
export const UNISWAP_USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
export const UNISWAP_WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
export const UNISWAP_SWAP_ROUTER = "0xa51afafe0263b40edaef0df8781ea9aa03e381a3";
export const UNISWAP_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
// Legacy-only values remain available to read and migrate existing Optimism accounts.
export const LINK_USDC_POOL_FEE = 500;
export const OPTIMISM_ETH_USD_FEED_ADDRESS = "0x13e3Ee699D1909E989722E753853AE30b17e08c5";

export const LINK_ADDRESS = UNISWAP_LINK_ADDRESS;
export const USDC_ADDRESS = UNISWAP_USDC_ADDRESS;
export const SWAP_ROUTER_ADDRESS = UNISWAP_SWAP_ROUTER;
export const OPTIMISM_NATIVE_ASSET = "ETH";
export const OPTIMISM_GAS_RESERVE_WARNING_ETH = 0.002;
export const OPTIMISM_NATIVE_WITHDRAW_BUFFER_ETH = 0.00005;

export const ALLOWED_UNISWAP_TOKENS = [
  LINK_ADDRESS.toLowerCase(),
  USDC_ADDRESS.toLowerCase(),
  UNISWAP_WETH_ADDRESS.toLowerCase(),
];
export const ALLOWED_HYPERLIQUID_COINS = ["LINK"];
export const ALLOWED_UNISWAP_EXECUTORS = [
  SWAP_ROUTER_ADDRESS.toLowerCase(),
  UNISWAP_PERMIT2.toLowerCase(),
];

export const HYPERLIQUID_API_URL = "https://api.hyperliquid.xyz";
export const HYPERLIQUID_SIGNATURE_CHAIN_ID = "0x66eee";

export const DEFAULT_LEASE_TTL_MS = 45_000;
export const DEFAULT_MARKET_DATA_MAX_AGE_MS = DEFAULT_STRATEGY_CONFIG.maxMarketDataAgeMs;
