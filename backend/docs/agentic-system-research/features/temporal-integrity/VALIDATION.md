# Validation and Promotion

Use fake clocks and frozen sequence/block fixtures: backward/forward steps, slew,
uncertainty growth, restart, leap/smear, expiry equality, adjacent budget epochs,
Temporal replay, delayed/reordered packets, chain reorgs, shared-signer subaccounts,
over 100 in-flight venue nonces, API-wallet deregistration, stale expiry and
submission-unknown recovery.

## Thresholds

- 100% signing operations bind fresh decision and signer-scoped lease.
- Zero duplicate signer/domain/nonce under concurrency, restart or retry.
- Zero signed/possibly-submitted nonce reuse.
- Zero wall-clock-only causal assertion.
- Zero unsafe/unknown/expired state passes risk increase/signing.
- Identical frozen domains/intervals/observations/policy reproduce the decision hash.
- 100% current freshness, approval, deadline and budget comparisons are inventoried
  and assigned a domain.

Report duplicate-nonce rate, expiry misclassification, ambiguous relationships and
blocked unsafe-time cases. Percentage improvement requires a measured mutation
baseline.

Promote per domain/operation after concurrency, replay and safe-close behavior pass.
Kill or redesign for a global timestamp service, NTS-as-accuracy proof, UTC causality,
direct local-clock signed nonces, Redis-only authority, uncertain nonce reuse, model
nonce access or weakened expiry for availability.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
