# Validation — Analytical Diversity and Correlated-Error Audit

## Fixture corpus

The local Test Center inventory contains 96 deterministic scenarios and 256 semantic
mutation identifiers. Its results remain fixture-only and product-unavailable.

Create deterministic cases for:

- same model, prompt, route, and evidence with duplicated output;
- same family through different gateways/providers;
- different families with identical evidence clusters;
- same family with independent evidence and different families with independent evidence;
- common high-confidence wrong outcomes, correct consensus, useful disagreement,
  irrelevant contrarian noise, abstention, and correlated failures;
- overlapping outcomes, regime imbalance, version drift, missing lineage, and
  Simpson's-paradox aggregates.

## Metrics

Report lineage completeness, pair/group sample and effective sample, residual
correlation, disagreement, double-fault, common-wrong and wrong-consensus rates,
claim/evidence overlap, effective-member estimator/method/interval, detection recall
and false-positive rate, calibration/selective risk, abstention/coverage, calls, cost,
and latency.

## Audit thresholds

- Start exploratory reporting at 100 raw mature point-in-time cases per predeclared
  cohort; label it exploratory and report effective sample.
- Require 100% exact lineage for scorable observations and zero false family
  diversification across gateway/provider fixtures.
- Detect deterministic duplicate/shared-output/common-wrong fixtures 100%.
- On preregistered noisy dependence fixtures, require at least 90% recall and no more
  than 5% false positives.
- Quorum relaxation and any authority increase remain zero in property tests.

## Production-policy gate

A `DiversityPolicy` requires at least 200 raw and 100 effective cases after dependence
adjustment per cohort, a 95% interval half-width no greater than 10 percentage points
for the primary common-mode rate, chronological held-out replication, and no material
regime/version drift. Activate only if the wrong-consensus reduction interval's lower
bound is above zero and grounding, safety, abstention, cost, latency, and reserved-spend
gates pass. Otherwise remain audit-only.

## Kill criteria

Kill or reject any variant that reconstructs residuals from freeform output, rewards
disagreement, counts gateways as families, hides sample uncertainty, chooses a winner,
alters routes, relaxes quorum, auto-promotes, exposes chain-of-thought, or grants
execution authority.

All initial work uses immutable fixtures, chronological replay, and existing Shadow
outcomes. Paid provider collection requires separate disclosure and approval.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
