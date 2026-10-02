# Validation and Promotion

## Corpus and experiments

- Frozen wallet, swap, venue order/fill, fee, funding, liquidation, bridge and reorg
  fixtures with an independent exact-unit oracle.
- Property-generated balanced sequences and concurrent groups.
- Seed missing, duplicate, different-payload, wrong-side, wrong-asset/decimal,
  reordered, partial and asymmetric postings.
- Crash/retry, source cursor gap, finality reversal and compensating correction.
- Explicit unsupported fee-on-transfer/rebase cases and backfill opening entries.
- Shadow-write alongside current executions and compare coverage/latency/triage time.

## Acceptance thresholds

- 100% postings balance per exact asset unit in supported clean sequences.
- Zero duplicate logical movements under retry/replay.
- 100% detection of required seeded mutations.
- 100% of certified movement classes have authoritative source/finality mapping.
- Missing coverage or gaps return partial/unknown, never balanced.
- Identical ordered observations/versions reproduce identical hashes.
- Cross-account and cross-tenant posting leakage is zero.
- Every excluded/external adjustment is explicit; no silent plug exists.

Measure unexplained-delta rate, duplicate suppression, observation-to-journal delay and
blinded mismatch-localization time. The 50% hypothesis requires a timed baseline and
confidence interval; otherwise report insufficient evidence.

## Promotion and kill

Promote one exact movement class at a time after source/finality, mutation, retry and
tenant thresholds pass. Demote on unexplained balancing, source drift or false clean
status.

Kill or redesign if the journal becomes authoritative balance truth; unlike assets
balance through USD floats; plug accounts appear; history is rewritten; ERC-20 logs
equal final settlement; unrealized PnL posts as assets; or journal incompleteness
blocks necessary reconciliation.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
