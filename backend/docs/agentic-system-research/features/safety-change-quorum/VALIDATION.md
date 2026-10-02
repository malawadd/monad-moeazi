# Validation and Promotion

## Experiments

- Same human with multiple accounts, self-approval, shared credential, wrong role,
  stale qualification, expiry, replay and exact-hash/environment mutation.
- Concurrent requests, state drift, mixed diff, partial application and unsafe rollback.
- Quorum/threshold/gate change, approver removal and loss-of-quorum recovery.
- Break-glass replay, escalation, self-renewal, post-expiry use and identity outage.
- Prove emergency stop and monotonic restriction remain usable without quorum.
- Shadow-generate decisions for the complete privileged-mutation inventory.

## Acceptance thresholds

- 100% of enumerated relaxing changes require fresh valid independent quorum.
- Zero unknown/unmapped privileged mutation paths apply.
- Zero single human or non-human principal satisfies multiple roles.
- Zero break-glass operations increase wallet, delegation, trading or policy authority.
- Every attempted apply/lease use has a durable success/failure/partial receipt.
- 100% leases expire and revoke in clock/restart/outage fixtures; failed revoke pauses.
- Normal analysis/trade execution adds zero latency.

Measure bypass acceptance, catalog coverage, approval latency, abandonment and
emergency recovery time. Do not report incident-reduction percentages without real
history.

## Promotion and kill

Promote only after two independently authenticated qualified humans exist and the
mutation inventory, state machine and tabletop thresholds pass. Demote on identity
ambiguity, catalog bypass or revoke failure.

Kill or redesign if applied to every trade; Particle/Magic is replaced; two accounts
from one human pass; a one-person fallback exists; shutdown needs quorum; approvals
are reusable; break-glass trades/expands delegation/self-renews; or evaluation triggers
billable CI/probes without explicit approval.

## Local verification status

Local verification covers fixtures, append-only persistence and Test Center rendering.
It does not promote production enforcement: authoritative staffing/Feature 17,
complete mutation inventory, product owners, durable Temporal lease operations and a
separate activation review remain required.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
