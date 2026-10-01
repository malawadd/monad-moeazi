import {
  ALLOWED_HYPERLIQUID_COINS,
  ALLOWED_UNISWAP_TOKENS,
  DEFAULT_STRATEGY_CONFIG,
  EXECUTION_MODE,
} from "../constants";

type StrategyAccountLike = {
  status?: string;
  emergencyStop?: boolean;
};

type StrategyConfigLike = {
  allowedPairs?: string[];
  maxSlippageBps?: number;
  maxSingleActionUsd?: number;
  maxDailyVolumeUsd?: number;
  rebalanceCooldownSeconds?: number;
  executionMode?: string;
};

type RecentExecutionLike = {
  kind?: string;
  status?: string;
  notionalUsd?: number;
  createdAt?: number;
  executedAt?: number;
};

export type ExecutionIntent = {
  kind:
    | "uniswap_pool_swap"
    | "uniswap_rebalance"
    | "hyperliquid_approve_agent"
    | "hyperliquid_order"
    | "withdrawal"
    | "system";
  origin: "viewer" | "supervisor" | "system";
  notionalUsd?: number;
  slippageBps?: number;
  tokenIn?: string;
  tokenOut?: string;
  coin?: string;
  requestedAt?: number;
};

export type ExecutionPolicySnapshot = {
  executionMode: string;
  maxSlippageBps: number;
  maxSingleActionUsd: number;
  maxDailyVolumeUsd: number;
  rebalanceCooldownSeconds: number;
  allowedPairs: string[];
};

export type ExecutionPolicyResult =
  | {
      ok: true;
      mode: string;
      policy: ExecutionPolicySnapshot;
    }
  | {
      ok: false;
      mode: string;
      code: string;
      message: string;
      policy: ExecutionPolicySnapshot;
    };

function numberOr(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function buildExecutionPolicySnapshot(config?: StrategyConfigLike | null): ExecutionPolicySnapshot {
  return {
    executionMode: config?.executionMode ?? DEFAULT_STRATEGY_CONFIG.executionMode,
    maxSlippageBps: numberOr(config?.maxSlippageBps, DEFAULT_STRATEGY_CONFIG.maxSlippageBps),
    maxSingleActionUsd: numberOr(config?.maxSingleActionUsd, DEFAULT_STRATEGY_CONFIG.maxSingleActionUsd),
    maxDailyVolumeUsd: numberOr(config?.maxDailyVolumeUsd, DEFAULT_STRATEGY_CONFIG.maxDailyVolumeUsd),
    rebalanceCooldownSeconds: numberOr(
      config?.rebalanceCooldownSeconds,
      DEFAULT_STRATEGY_CONFIG.rebalanceCooldownSeconds,
    ),
    allowedPairs: config?.allowedPairs?.length ? config.allowedPairs : DEFAULT_STRATEGY_CONFIG.allowedPairs,
  };
}

function allowedSpotPair(_policy: ExecutionPolicySnapshot, tokenIn?: string, tokenOut?: string) {
  if (!tokenIn || !tokenOut) return true;
  const nextIn = tokenIn.toLowerCase();
  const nextOut = tokenOut.toLowerCase();
  return ALLOWED_UNISWAP_TOKENS.includes(nextIn) && ALLOWED_UNISWAP_TOKENS.includes(nextOut) && nextIn !== nextOut;
}

function allowedPerpCoin(policy: ExecutionPolicySnapshot, coin?: string) {
  if (!coin) return false;
  const normalizedCoin = coin.toUpperCase();
  return ALLOWED_HYPERLIQUID_COINS.includes(normalizedCoin) && policy.allowedPairs.some((pair) => pair.includes(normalizedCoin));
}

function recentDailyNotional(recentExecutions: RecentExecutionLike[], now: number) {
  const oneDayAgo = now - 86_400_000;
  return recentExecutions.reduce((sum, execution) => {
    const at = execution.executedAt ?? execution.createdAt ?? 0;
    if (at < oneDayAgo) return sum;
    if (!["pending", "submitted", "filled"].includes(execution.status ?? "")) return sum;
    return sum + (execution.notionalUsd ?? 0);
  }, 0);
}

function mostRecentExecutionOfKind(recentExecutions: RecentExecutionLike[], kind: string) {
  return recentExecutions.find((execution) => execution.kind === kind);
}

export function evaluateExecutionPolicy(args: {
  strategyAccount: StrategyAccountLike;
  config?: StrategyConfigLike | null;
  recentExecutions?: RecentExecutionLike[];
  intent: ExecutionIntent;
  now?: number;
}): ExecutionPolicyResult {
  const now = args.now ?? Date.now();
  const policy = buildExecutionPolicySnapshot(args.config);
  const recentExecutions = args.recentExecutions ?? [];

  if (args.strategyAccount.emergencyStop) {
    return {
      ok: false,
      mode: policy.executionMode,
      code: "EMERGENCY_STOP",
      message: "Execution blocked because the strategy is in emergency stop mode.",
      policy,
    };
  }

  if (
    args.strategyAccount.status &&
    !["ready", "active", "paused", "emergency_stopped"].includes(args.strategyAccount.status)
  ) {
    return {
      ok: false,
      mode: policy.executionMode,
      code: "STRATEGY_NOT_READY",
      message: `Execution blocked while strategy status is ${args.strategyAccount.status}.`,
      policy,
    };
  }

  if (
    !["withdrawal", "hyperliquid_approve_agent", "system"].includes(args.intent.kind) &&
    args.strategyAccount.status !== "active"
  ) {
    return {
      ok: false,
      mode: policy.executionMode,
      code: "STRATEGY_NOT_ACTIVE",
      message: "Execution blocked because the strategy is not active.",
      policy,
    };
  }

  if (args.intent.slippageBps !== undefined && args.intent.slippageBps > policy.maxSlippageBps) {
    return {
      ok: false,
      mode: policy.executionMode,
      code: "SLIPPAGE_TOO_HIGH",
      message: `Requested slippage ${args.intent.slippageBps} bps exceeds policy cap ${policy.maxSlippageBps} bps.`,
      policy,
    };
  }

  if (args.intent.notionalUsd !== undefined && args.intent.notionalUsd > policy.maxSingleActionUsd) {
    return {
      ok: false,
      mode: policy.executionMode,
      code: "ACTION_NOTIONAL_TOO_HIGH",
      message: `Requested notional ${args.intent.notionalUsd} exceeds single-action cap ${policy.maxSingleActionUsd}.`,
      policy,
    };
  }

  const dailyNotional = recentDailyNotional(recentExecutions, now);
  if ((args.intent.notionalUsd ?? 0) + dailyNotional > policy.maxDailyVolumeUsd) {
    return {
      ok: false,
      mode: policy.executionMode,
      code: "DAILY_VOLUME_CAP",
      message: "Execution blocked because the daily notional cap would be exceeded.",
      policy,
    };
  }

  if (["uniswap_pool_swap", "uniswap_rebalance"].includes(args.intent.kind)) {
    if (!allowedSpotPair(policy, args.intent.tokenIn, args.intent.tokenOut)) {
      return {
        ok: false,
        mode: policy.executionMode,
        code: "TOKEN_NOT_ALLOWED",
        message: "Uniswap execution is restricted to the managed LINK/USDC pair.",
        policy,
      };
    }
  }

  if (args.intent.kind === "hyperliquid_order" && !allowedPerpCoin(policy, args.intent.coin)) {
    return {
      ok: false,
      mode: policy.executionMode,
      code: "COIN_NOT_ALLOWED",
      message: "HyperLiquid execution is restricted to configured managed hedge coins.",
      policy,
    };
  }

  if (["uniswap_rebalance", "hyperliquid_order", "withdrawal"].includes(args.intent.kind)) {
    const previous = mostRecentExecutionOfKind(recentExecutions, args.intent.kind);
    const previousAt = previous?.executedAt ?? previous?.createdAt;
    if (previousAt && now - previousAt < policy.rebalanceCooldownSeconds * 1000) {
      return {
        ok: false,
        mode: policy.executionMode,
        code: "COOLDOWN_ACTIVE",
        message: "Execution blocked because the cooldown window has not elapsed.",
        policy,
      };
    }
  }

  return {
    ok: true,
    mode: policy.executionMode ?? EXECUTION_MODE.live,
    policy,
  };
}
