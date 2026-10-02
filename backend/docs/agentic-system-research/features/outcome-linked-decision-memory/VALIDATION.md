# Validation — Outcome-Linked Immutable Decision Memory

## Local verification status

The local fixture slice passed its focused and repository regression suites, strict
type/build checks, boundary and inventory checks, disposable migration rerun, and
Test Center image build. These checks validate deterministic mechanics and isolation;
the statistical eligibility and promotion thresholds below remain unmet activation
gates.

## Eligibility before experimentation

Do not start a memory-effect experiment until:

- a power analysis is recorded for the primary calibration metric;
- there are at least 200 mature comparable episodes overall and adequate effective
  samples per selected market/regime/horizon stratum;
- point-in-time evidence, prices, cost assumptions, and outcome corrections are
  reproducible;
- training, validation, and chronological held-out windows are frozen;
- overlapping forecast labels are accounted for in effective sample size.

The `200` floor is not sufficient by itself.

## Experiment subjects

1. Current champion without memory.
2. Same champion with retrieved mature episodes only.
3. Same champion with operator-approved lesson candidates.

All subjects use identical route, prompt base, evidence, price inputs, and strategy
settings. The memory bundle is the only variable. Walk-forward splits and an embargo
between fitting/retrieval construction and evaluation prevent future leakage.

## Metrics

- Brier score, log loss, ECE, directional accuracy, and abstention coverage;
- repeated-error rate using a frozen deterministic taxonomy;
- calibration and errors by market, regime, horizon, and role;
- simulated net outcome after conservative fees, funding, gas, slippage, and turnover;
- drawdown and tail loss reported separately from forecast quality;
- retrieval precision, empty-retrieval rate, counterexample coverage, token use,
  latency, and provider cost;
- safety-case regression for injection, wrong market, stale/missing evidence,
  contradiction, and confidence inflation.

## Error taxonomy

Freeze error definitions before the run: stale-evidence reliance, wrong-market
reference, unsupported confidence, missed invalidation, repeated false catalyst,
directional error, horizon mismatch, cost omission, and unsafe non-abstention. A model
does not decide whether it repeated an error.

## Promotion thresholds

An evaluation-only memory asset may be proposed for later production review only when
the chronological held-out result shows:

- at least 5% relative improvement in the preselected primary calibration metric with
  a bootstrap confidence interval excluding no improvement;
- at least 10% relative reduction in repeated classified errors;
- no safety-case, grounding, tail-loss, or drawdown regression;
- 100% provenance and counterexample linkage for retrieved lessons;
- no cross-tenant, future, wrong-market, or wrong-horizon retrieval;
- no more than 15% added input tokens and 10% added p95 end-to-end latency unless a
  separately reviewed benefit/cost case justifies the excess.

PnL is secondary and cannot override failed calibration or safety gates. If statistical
power is inadequate, the decision is `hold`.

## Adversarial and failure tests

- Inject a profitable but causally wrong episode.
- Inject many duplicates from one model family.
- Correct historical price/outcome data after bundle creation.
- Shift volatility/liquidity regime and expire old lessons.
- Attempt cross-tenant, cross-market, future-dated, and wrong-horizon retrieval.
- Remove counterexamples and falsifiers.
- Fail the embedding index, Redis cache, and offline critic independently.

## Demotion and kill criteria

Deactivate the memory asset when live-shadow monitoring breaches the frozen
calibration, error, safety, latency, or cost margin for two consecutive evaluation
windows, or immediately for data leakage, provenance loss, poisoning, or cross-tenant
access. Demotion restores the exact memory-off champion without changing customer
authority.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
