export const PERPL_OPTIMIZER_VERSION = "perpl-deterministic-v2";
export const PERPL_OPTIMIZER_POLICY = Object.freeze({
  runDurationSeconds: 43_200,
  maxCycles: 15,
  targetWinStreak: 2,
  minimumPositivePnlUnits: "10000",
  marketScanIntervalMs: 300_000,
  observationIntervalMs: 60_000,
  exitCheckIntervalMs: 60_000,
  minimumHoldMs: 600_000,
  maximumHoldMs: 1_800_000,
  initialMomentumThresholdBps: 40,
  maximumMomentumThresholdBps: 70,
  plannedLossUnits: "150000",
  maximumNotionalUnits: "30000000",
  maximumMarginUnits: "25000000",
  maximumLeverage: 4,
  maximumDepthConsumptionBps: 2_000,
  initialExecutionConservatismBps: 10_000,
  maximumExecutionConservatismBps: 15_000,
  executionConservatismStepBps: 1_000,
  highVolatilityBps: 60,
  highSpreadBps: 20,
  takeProfitUnits: "20000",
  staleMarketMs: 90_000,
  observationTargetToleranceMs: 90_000,
  requiredTrendSpanMs: 14 * 60_000,
  roundTripImpactCapBps: 100,
  depthConsumptionDenominatorBps: 10_000,
});

export type PerplOptimizerParams = {
  momentumThresholdBps: number;
  executionConservatismBps: number;
};
export type PerplOptimizerState = {
  version: string;
  status: "running" | "target_reached_awaiting_settlement" | "cycle_cap_reached_awaiting_settlement";
  cycles: number;
  winStreak: number;
  positiveCycles: number;
  params: PerplOptimizerParams;
  lastObservationAt: number;
  lastMarketScanAt: number;
  lastExitCheckAt: number;
  scanner: { cadenceMs: number; consecutiveNoProposal: number; totalScans: number; totalProposals: number;
    lastProposal?: Record<string, unknown> | null; lastAudit?: Record<string, unknown> | null };
  activeCycle?: Record<string, unknown> | null;
  lastCycle?: Record<string, unknown> | null;
};

export function perplOptimizerReview() {
  return { version: PERPL_OPTIMIZER_VERSION, maxCycles: PERPL_OPTIMIZER_POLICY.maxCycles,
    targetWinStreak: PERPL_OPTIMIZER_POLICY.targetWinStreak, minimumPositivePnlUnits: PERPL_OPTIMIZER_POLICY.minimumPositivePnlUnits,
    maxDurationSeconds: PERPL_OPTIMIZER_POLICY.runDurationSeconds, marketScanIntervalMs: PERPL_OPTIMIZER_POLICY.marketScanIntervalMs,
    scannerReviewAfterMisses: 3,
    observationIntervalMs: PERPL_OPTIMIZER_POLICY.observationIntervalMs, exitCheckIntervalMs: PERPL_OPTIMIZER_POLICY.exitCheckIntervalMs,
    cycleHoldMinMs: PERPL_OPTIMIZER_POLICY.minimumHoldMs, cycleHoldMaxMs: PERPL_OPTIMIZER_POLICY.maximumHoldMs,
    plannedLossUnits: PERPL_OPTIMIZER_POLICY.plannedLossUnits, maxNotionalUnits: PERPL_OPTIMIZER_POLICY.maximumNotionalUnits,
    maxMarginUnits: PERPL_OPTIMIZER_POLICY.maximumMarginUnits, maxLeverage: PERPL_OPTIMIZER_POLICY.maximumLeverage,
    maxDepthConsumptionBps: PERPL_OPTIMIZER_POLICY.maximumDepthConsumptionBps,
    initialMomentumThresholdBps: PERPL_OPTIMIZER_POLICY.initialMomentumThresholdBps };
}

export function createPerplOptimizerState(): PerplOptimizerState {
  return { version: PERPL_OPTIMIZER_VERSION, status: "running", cycles: 0, winStreak: 0, positiveCycles: 0,
    params: { momentumThresholdBps: PERPL_OPTIMIZER_POLICY.initialMomentumThresholdBps,
      executionConservatismBps: PERPL_OPTIMIZER_POLICY.initialExecutionConservatismBps },
    lastObservationAt: 0, lastMarketScanAt: 0, lastExitCheckAt: 0,
    scanner: { cadenceMs: PERPL_OPTIMIZER_POLICY.marketScanIntervalMs, consecutiveNoProposal: 0,
      totalScans: 0, totalProposals: 0, lastProposal: null, lastAudit: null }, activeCycle: null };
}

export function parsePerplOptimizerState(raw?: string): PerplOptimizerState | null {
  try {
    const state = JSON.parse(raw ?? "null");
    if (!state || state.version !== PERPL_OPTIMIZER_VERSION || !Number.isSafeInteger(state.cycles)
      || state.cycles < 0 || state.cycles > PERPL_OPTIMIZER_POLICY.maxCycles
      || !Number.isSafeInteger(state.winStreak) || !Number.isSafeInteger(state.positiveCycles)
      || !["running", "target_reached_awaiting_settlement", "cycle_cap_reached_awaiting_settlement"].includes(state.status)
      || !validParams(state.params)) return null;
    const initial = createPerplOptimizerState();
    return { ...initial, ...state, scanner: { ...initial.scanner, ...(state.scanner ?? {}) } } as PerplOptimizerState;
  } catch { return null; }
}

export function validParams(value: any): value is PerplOptimizerParams {
  return Number.isSafeInteger(value?.momentumThresholdBps)
    && value.momentumThresholdBps >= PERPL_OPTIMIZER_POLICY.initialMomentumThresholdBps
    && value.momentumThresholdBps <= PERPL_OPTIMIZER_POLICY.maximumMomentumThresholdBps
    && Number.isSafeInteger(value?.executionConservatismBps)
    && value.executionConservatismBps >= PERPL_OPTIMIZER_POLICY.initialExecutionConservatismBps
    && value.executionConservatismBps <= PERPL_OPTIMIZER_POLICY.maximumExecutionConservatismBps;
}

export function adaptPerplOptimizerAfterCycle(state: PerplOptimizerState, pnlUnits: bigint,
  classification: "execution_costs" | "trend_reversal_or_stall" | "small_or_zero") {
  const before = { ...state.params }; const after = { ...before }; let changed: string | null = null;
  if (pnlUnits < 0n && classification === "execution_costs"
    && after.executionConservatismBps < PERPL_OPTIMIZER_POLICY.maximumExecutionConservatismBps) {
    after.executionConservatismBps = Math.min(PERPL_OPTIMIZER_POLICY.maximumExecutionConservatismBps,
      after.executionConservatismBps + PERPL_OPTIMIZER_POLICY.executionConservatismStepBps);
    changed = "executionConservatismBps";
  } else if (pnlUnits < 0n && classification === "trend_reversal_or_stall"
    && after.momentumThresholdBps < PERPL_OPTIMIZER_POLICY.maximumMomentumThresholdBps) {
    after.momentumThresholdBps = Math.min(PERPL_OPTIMIZER_POLICY.maximumMomentumThresholdBps, after.momentumThresholdBps + 10);
    changed = "momentumThresholdBps";
  }
  return { before, after, changed, classification };
}
