import type { OptimizerDecision } from "./perplOptimizationStrategy.js";
import { PERPL_OPTIMIZER_POLICY, type PerplOptimizerState } from "./perplOptimizerConfig.js";

export function scannerCadenceMs(_state: PerplOptimizerState) {
  return PERPL_OPTIMIZER_POLICY.marketScanIntervalMs;
}

export function scannerMarketIds(allowedIds: number[], positionMarket: number | null, scanDue: boolean) {
  return scanDue ? allowedIds : positionMarket === null ? [] : [positionMarket];
}

export function advancePerplScanner(state: PerplOptimizerState, decision: OptimizerDecision, at: number,
  positionOpen: boolean) {
  const prior = state.scanner; const proposal = decision.kind === "order";
  const consecutiveNoProposal = proposal ? 0 : prior.consecutiveNoProposal + 1;
  const cadenceMs = PERPL_OPTIMIZER_POLICY.marketScanIntervalMs;
  const rejected = decision.kind === "hold" && Array.isArray(decision.details?.rejectedMarkets)
    ? decision.details.rejectedMarkets as Array<{ reason?: string }> : [];
  const reasonCounts = rejected.reduce<Record<string, number>>((counts, item) => {
    const reason = String(item.reason ?? "unknown"); counts[reason] = (counts[reason] ?? 0) + 1; return counts;
  }, {});
  const audit = !proposal && consecutiveNoProposal >= 3 && consecutiveNoProposal % 3 === 0
    ? { at, consecutiveNoProposal, reasonCounts, action: "investigate_scanner_and_market_conditions",
      conclusion: rejected.length && rejected.every((item) => ["insufficient_observations", "stale_or_irregular_observations",
        "five_or_fifteen_minute_history_missing", "stale_market_or_book", "market_or_book_unavailable"].includes(String(item.reason)))
        ? "market_data_quality_needs_attention" : "no_qualified_live_signal" }
    : null;
  const lastProposal = proposal ? { at, marketId: decision.action.marketId, side: decision.action.side,
    reasonCode: decision.reasonCode, blockedByOpenPosition: positionOpen,
    fiveMinuteMoveBps: decision.details.fiveMinuteMoveBps,
    estimatedNetMoveBps: decision.details.estimatedNetMoveBps } : prior.lastProposal ?? null;
  const next = { ...state, lastMarketScanAt: at, scanner: { cadenceMs, consecutiveNoProposal,
    totalScans: prior.totalScans + 1, totalProposals: prior.totalProposals + (proposal ? 1 : 0),
    lastProposal, lastAudit: audit ?? prior.lastAudit ?? null } };
  return { state: next, record: { scannedAt: at, status: proposal ? positionOpen ? "deferred_position_open" : "proposed"
    : "no_proposal", reasonCode: decision.reasonCode, cadenceMs, consecutiveNoProposal,
    proposal: proposal ? lastProposal : null, rejectedMarkets: rejected, audit } };
}
