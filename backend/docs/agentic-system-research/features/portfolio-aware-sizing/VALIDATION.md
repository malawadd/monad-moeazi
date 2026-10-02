# Validation — Portfolio-Aware Sizing and Trade Construction

## Baselines

Compare against the current fixed-notional proposal constructor on byte-identical
chronological replay and live-shadow inputs. Report matched gross exposure as well as
matched proposal opportunity count; neither baseline alone is sufficient.

## Required data checks

- Reconciled positions, collateral, pending orders, and reservations balance to source
  records.
- Return histories are point-in-time, aligned, gap-labeled, and free of future data.
- Contract multipliers, decimals, margin, minimums, fees, funding, gas, and depth are
  fixture-tested for every included venue/instrument.
- Estimator windows, shrinkage, stresses, and haircuts are frozen before holdout runs.

## Test matrix

- high/low volatility and sudden volatility shift;
- ordinary and correlation-to-one stress;
- singular covariance, sparse/new asset, and missing bars;
- deep/thin/empty/stale books and liquidity haircut;
- funding shock, fee-tier drift, gas spike, and negative net benefit;
- isolated/cross margin, liquidation proximity, and incorrect contract units;
- pending order, partial fill, concurrent proposals, and stale reconciliation;
- confidence inflation, contradictory evidence, emergency stop, and policy revision.

## Metrics

- proposal approved, clamped, and abstained counts with reason codes;
- aggregate/cluster/venue/liquidity/margin violations before and after sizing;
- target versus realized gross/net exposure and turnover;
- modeled stress loss, realized Shadow drawdown, and tail outcomes reported separately;
- predicted versus realized fees, impact, funding, gas, and slippage;
- calibration bucket versus allocated risk;
- compute latency, data latency, error rate, and storage/IO cost.

## Promotion thresholds

An evaluation-only sizing policy may advance to a later implementation review when:

- zero released proposals violate a frozen hard aggregate constraint;
- zero decisions use missing, stale, disputed, or unreconciled portfolio inputs;
- zero decisions increase size solely from uncalibrated model confidence;
- modeled stress loss is at least 10% lower than fixed notional at matched gross
  exposure on the held-out set, without higher realized Shadow drawdown;
- predicted all-in cost error stays inside the separately frozen venue-specific
  tolerance;
- sizing computation p95 fits inside the proposal freshness budget;
- all safety and concurrency tests pass.

The researched 40–70% violation and 15–35% stress ranges remain hypotheses, not gates
or claims. Insufficient replay-grade history produces `hold`.

## Kill criteria

- Any live path can bypass sizing or reservation.
- Size/leverage is parsed from prose or raw model confidence.
- Optimizer failure produces a positive fallback size.
- A unit, collateral, or reconciliation mismatch reaches routing.
- Held-out safety, drawdown, or tail results degrade despite a composite improvement.

## Folded proposal-coherence cases

- Exact duplicates, same/opposite directions, disjoint/overlapping horizon boundaries,
  expired/stale revisions, ambiguous instrument aliases, and unit normalization.
- Simultaneous proposals, reordered Temporal delivery, duplicate retries, and partial
  failure between Convex lifecycle state and Redis reservation.
- Pending approval supersession is atomic; approved/executing/submitted/unknown work is
  immutable; cross-account/tenant coalescence is always zero.
- At most one active exact intent key per account/revision and zero reservation for
  held, superseded, or abstained intent.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
