# Cycle 02 — Promotion, Portfolio Construction, and Venue Routing

## Research question

How should Unimoazi promote evaluated configurations, construct portfolio-aware
proposals, and choose execution venues without transferring authority to a model?

## Candidate results

| Candidate | Result | Score | Audit conclusion |
| --- | --- | ---: | --- |
| Outcome-calibrated promotion and demotion | Approved, evaluation first | 90 | Formalize deterministic eligibility and pre-authorized rollback over existing Evaluation Lab subjects |
| Portfolio-aware sizing and trade construction | Approved design; production held | 92 | Highest cycle priority, gated on authoritative portfolio and reconciliation state |
| Multi-venue execution-quality routing | Approved narrowed extension | 85 | Reuse and productionize the existing all-in router; do not build a parallel router |

## Evidence boundaries

- Google canary guidance supports bounded comparison and rollback, not trading alpha or
  the proposed containment percentages.
- Deflated Sharpe Ratio supports multiple-testing correction for return metrics; it
  does not replace independent calibration, grounding, safety, latency, and cost gates.
- Volatility scaling, covariance shrinkage, and transaction-cost-aware allocation have
  credible conventional-finance research support, but their effect sizes cannot be
  transferred to crypto.
- Venue documentation establishes available quote/book interfaces and operational
  caveats. It does not establish lower realized execution cost.

## Corrected hypotheses

- Promotion: false-promotion and containment ranges remain unvalidated until current
  manual baselines and post-promotion mature outcomes exist.
- Sizing: measure proposal adjustment/abstention and modeled stress loss. Do not call
  modeled stress reduction actual loss reduction.
- Routing: compare against Unimoazi's current all-in router, not a spread-only
  strawman. Receipt coverage is an invariant; realized cost needs certified fills.

## Changes to the research direction

Cycle 02 confirms that authoritative state is a shared prerequisite for risk snapshots,
portfolio sizing, and venue routing. Cycle 03 therefore moves upstream: event-driven
replay-grade evidence, per-source value/quality, and efficient orchestration.
