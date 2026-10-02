# Validation and Promotion

## Baseline and datasets

Compare nominal/current collateral eligibility with the proposed envelope using
recorded venue balances, executable books/price-impact functions, withdrawal states
and historical stress windows. Begin with fixtures, local replay and Shadow; no paid
feed, funded action, bridge, withdrawal or deployment is authorized.

## Experiments

- Depeg ladders, collateral/index/settlement basis divergence and correlated assets.
- Issuer pause, bridge halt, wrapper divergence, custodian/venue outage.
- Withdrawal queue/cap/delay, partial balance, depth loss, spread/impact and stale data.
- Shared-dependency concentration across positions and accounts, preserving tenant
  isolation.
- Prove blocked increases and a separately certified reduce-only close route.
- Replay exit-capacity predictions against later observable close/withdraw outcomes.
- Reproduce envelope hashes from identical policies and observations.

## Acceptance thresholds

- 100% of `allow_new` decisions bind complete exact asset/dependency observations and
  every required scenario.
- Zero missing or stale state is treated as healthy.
- Zero displayed midpoint is accepted as executable exit capacity.
- 100% deterministic hashes and cross-account isolation in the fixture suite.
- 100% of required degradation cases block increases and preserve only valid
  certified close/reconciliation operations.
- False `reduce_only`, unsafe-candidate and capital-efficiency impacts are reported
  separately by asset/venue/scenario.

The 20–60% hypothesis requires preregistered stress cases and reports stressed loss
with and without the envelope plus opportunity cost. If replay outcomes or sample
size are inadequate, report `insufficient evidence`.

## Promotion and demotion

Promote per exact asset × venue × instrument cell after identity, executable-depth,
withdrawal, stress and safe-close coverage pass. Demote on source drift, unexplained
capacity error, stale/missing state pass, unsafe close classification or excessive
false blocking.

## Kill criteria

Kill or redesign if the feature becomes a generic solvency score; issuer material is
treated as continuous proof; a model selects haircuts; thresholds are global across
assets/venues; a midpoint substitutes for exit liquidity; or it automatically moves
assets or duplicates native liquidation math.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
