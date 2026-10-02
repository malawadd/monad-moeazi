# Validation — Calibrated Selective Prediction and Abstention

## Dataset and leakage controls

- Use chronological blocked/walk-forward splits by market and horizon.
- Labels must mature before the decision/artifact cutoff.
- Embargo overlapping horizons and account for serial dependence with block/bootstrap
  intervals where appropriate.
- Freeze outcome, neutral band, all-in cost, missing/delisted label, correction, and
  pooling definitions.
- At least 200 mature observations per selected market/horizon/version is an eligibility
  floor; effective sample/power analysis may require more.

## Baselines and metrics

Compare raw model confidence, a simple frozen calibration baseline, and each selected
adaptive/conformal method. Report:

- Brier score, log loss, ECE, reliability curves;
- marginal coverage/risk, coverage gap, interval/set size;
- selective-risk versus coverage/abstention curves;
- false positives by side/horizon/neutral band;
- opportunity cost and net Shadow utility after conservative costs;
- results by market, regime, direction, version, and shift state;
- artifact refresh cost, latency, and failure rate.

## Required stress cases

- volatility/liquidity jump, price gap, slow and abrupt regime shift;
- delayed/missing/corrected labels and sparse strata;
- model/prompt/route/evidence-policy change;
- confidence inflation, wrong market, stale evidence, and claim conflict;
- interval widening, calibrator failure, and adversarial predictions.

## Evaluation/Shadow acceptance

- 100% receipts bind exact forecast/evidence/synthesis/artifact hashes;
- zero future/overlapping unavailable labels enter an artifact;
- same inputs produce the same state;
- missing/stale/shifted/failed calibration never increases eligibility;
- adding a severe shift cannot promote a decision;
- held-out primary calibration/selective-risk metric improves with its block-bootstrap
  interval excluding no improvement;
- net Shadow utility and safety metrics meet frozen non-inferiority margins;
- abstention/opportunity cost is reported and cannot be hidden by a composite score.

Production `proposal_eligible` remains held after these results. A later market/horizon
activation plan must pre-register empirical coverage/risk targets and receive explicit
review. The researched 20–45% and 15–35% ranges remain hypotheses.

## Kill criteria

- Claims of distribution-free or individual-trade safety.
- Raw confidence/vote count is treated as calibrated probability.
- One artifact spans undeclared markets/horizons/directions.
- Thresholds relax automatically to maintain trade frequency.
- A calibration receipt bypasses policy, sizing, authority, or execution gates.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.

## Local fixture verification

The Test Center corpus covers deterministic parsing, quantiles, abstention,
observe/enforce separation, zero-attempt ceilings, and the narrow API/UI boundary. It
is not a production, Shadow, or statistical acceptance result.
