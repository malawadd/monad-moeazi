# Validation and Promotion

With local fake KMS/vault test wrong tenant/context/consumer/class/version/purpose,
ciphertext swapping, stale/revoked handles, crash around rotation cutover, old upstream
credential remaining valid, disabled/deleting/lost KMS, restore without KEK, rewrap/
rollback, concurrent access, plaintext sentinels in every store/trace/model, owner-key
submission, widened recovery and legacy migration rollback.

Thresholds: zero owner material; zero plaintext outside vault; 100% unwraps bind fresh
decision/receipt; 100% envelopes bind tenant/class/version/context; zero local revokes
reported externally verified; each class exercises outcome; idempotency cannot create
multiple active replacements; failed recovery stays disabled.

Kill for fallback/owner recovery, Convex/Timescale long-term vault, one unversioned
master key, plaintext workflows/traces/models, local-as-native revocation, automatic
destructive deletion, widened rotation, false zeroization or unapproved cloud use.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.

The checked-in local corpus contains 41 deterministic cases and covers every listed
hard boundary plus all six recovery outcomes. The verified release keeps
`productOutcome=unavailable`; live validation remains an approval-gated future runbook
in the Feature 04 integration dossier.
