# Validation and Promotion

Test wrong/stale session, replay/concurrent download, mutations during collection,
skewed cutoffs, owner outage, rights/hold denial, contested/corrected data, large/
Unicode/exact-integer histories, truncation, checksum tamper, zip/path traversal,
interrupted assembly, cleanup failure and tenant-existence leakage.

Thresholds: 100% configured domains represented; 100% files/manifests verify; zero
secret/cross-tenant escape; zero complete result with required nonterminal domain; zero
delivery-token reuse; every file binds schema/cutoff/governing decisions; deterministic
frozen manifest; zero untracked transient files after cleanup.

Kill for raw database dump, universal all-data/global-snapshot claim, public/reusable
URL, email attachment, remote fetch, secrets/CoT, unbounded history, Redis-only state
or unapproved paid storage.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
# Local fixture validation boundary

The implementation validates closed registry inputs, native per-domain cutoffs, canonical
JSON/CSV/path rules, ten-domain manifest closure, verification, grant replay/expiry/revoke
states, and zero-residual virtual buffers. These are local synthetic properties only; real
privacy, retention, legal, Usage Rights, source, staging, egress and delivery validation
remain separately authorized gates.
