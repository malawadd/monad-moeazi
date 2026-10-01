export type AutomationPolicy = {
  allowedMarkets: string[];
  allowedVenues: string[];
  maxOrderUsd: number;
  maxDailyVolumeUsd: number;
  maxLeverage: number;
  maxExposureUsd: number;
  maxDailyLossUsd: number;
  maxDailyDrawdownPct: number;
  maxSlippageBps: number;
  maxAnalysisAgeMs: number;
  minConfidence: number;
  minConsensus: number;
  cooldownSeconds: number;
  maxConcurrentPositions: number;
  requireStopLoss: boolean;
  requireTakeProfit: boolean;
  dailyCreditBudget: number;
};

const VENUES = new Set(["hyperliquid", "lighter", "orderly", "gmx", "ostium", "uniswap"]);

export const DEFAULT_AUTOMATION_POLICY: AutomationPolicy = {
  allowedMarkets: ["BTC-PERP", "ETH-PERP", "SOL-PERP", "LINK-PERP"],
  allowedVenues: ["hyperliquid"],
  maxOrderUsd: 25,
  maxDailyVolumeUsd: 250,
  maxLeverage: 5,
  maxExposureUsd: 100,
  maxDailyLossUsd: 50,
  maxDailyDrawdownPct: 8,
  maxSlippageBps: 75,
  maxAnalysisAgeMs: 120_000,
  minConfidence: 0.65,
  minConsensus: 0.6,
  cooldownSeconds: 60,
  maxConcurrentPositions: 3,
  requireStopLoss: true,
  requireTakeProfit: false,
  dailyCreditBudget: 10_000,
};

export function parseAutomationPolicy(value: string): AutomationPolicy {
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(value) as Record<string, unknown>;
  } catch {
    throw new Error("Policy must be valid JSON.");
  }

  const policy = { ...DEFAULT_AUTOMATION_POLICY, ...row } as AutomationPolicy;
  if (!Array.isArray(policy.allowedMarkets) || policy.allowedMarkets.length === 0) {
    throw new Error("Policy requires at least one allowed market.");
  }
  if (!Array.isArray(policy.allowedVenues) || policy.allowedVenues.some((venue) => !VENUES.has(venue))) {
    throw new Error("Policy contains an unsupported venue.");
  }
  for (const [key, min, max] of [
    ["maxOrderUsd", 0.01, 10_000_000],
    ["maxDailyVolumeUsd", 0.01, 100_000_000],
    ["maxLeverage", 1, 200],
    ["maxExposureUsd", 0.01, 100_000_000],
    ["maxDailyLossUsd", 0.01, 100_000_000],
    ["maxDailyDrawdownPct", 0.01, 100],
    ["maxSlippageBps", 0, 5_000],
    ["maxAnalysisAgeMs", 1_000, 3_600_000],
    ["minConfidence", 0, 1],
    ["minConsensus", 0, 1],
    ["cooldownSeconds", 0, 86_400],
    ["maxConcurrentPositions", 1, 100],
    ["dailyCreditBudget", 0, 1_000_000_000],
  ] as const) {
    const next = Number(policy[key]);
    if (!Number.isFinite(next) || next < min || next > max) {
      throw new Error(`${key} must be between ${min} and ${max}.`);
    }
  }
  return {
    ...policy,
    allowedMarkets: policy.allowedMarkets.map((market) => String(market).trim().toUpperCase()),
    allowedVenues: policy.allowedVenues.map((venue) => String(venue).trim().toLowerCase()),
  };
}

export function validateProfileInput(args: {
  watchMarkets: string[];
  eventTriggers: string[];
  dailyCreditLimit: number;
}) {
  if (args.watchMarkets.length > 100) throw new Error("At most 100 watched markets are allowed.");
  if (args.eventTriggers.length > 20) throw new Error("At most 20 event triggers are allowed.");
  if (!Number.isInteger(args.dailyCreditLimit) || args.dailyCreditLimit < 0) {
    throw new Error("Daily credit limit must be a non-negative integer.");
  }
}
