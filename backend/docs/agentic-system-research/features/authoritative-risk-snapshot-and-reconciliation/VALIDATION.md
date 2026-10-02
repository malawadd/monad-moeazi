# Validation — Authoritative Risk Snapshot and Reconciliation Receipt

## Baseline

Record how often each current `RiskContext` field is authoritative, placeholder,
missing, stale, or optimistic. No live or funded execution is required. Existing
fixtures, recorded venue responses, local forks, and Shadow proposals are sufficient.

## Required test matrix

### Contract and hashing

- Canonical serialization produces the same hash across retries and service languages.
- Any policy, quote, risk input, source revision, venue, or adapter change changes the
  hash.
- Secrets, signed payloads, and hidden reasoning cannot enter snapshot or receipt
  schemas.

### Risk completeness and freshness

- Each required input passes with a fresh authoritative source.
- Missing, stale, disputed, malformed, or revision-mismatched inputs fail closed.
- A zero is accepted only when the source explicitly reports zero with a revision and
  timestamp.
- Provider quorum and evidence completeness are revalidated from the frozen analysis,
  not supplied as constants.

### Atomic reservations

- Two concurrent proposals that jointly exceed exposure, daily volume, position, or
  credit ceilings cannot both reserve.
- Duplicate workflow retries return the same reservation.
- Expiry, release, consumption, and reconciliation holds are idempotent.
- Redis restart/missing state fails safe and can reconstruct outstanding reservations
  from durable records before dispatch resumes.
- Concurrent proposals cannot exceed exact direct-economic-cost ceilings; expected
  rebates never offset reservation, and uncertain/partial submission retains cost.

### Submission and reconciliation

- Inject timeout before preparation, after preparation, before broadcast, after
  broadcast, and during confirmation.
- Cover duplicate submission, stale quote, venue rejection, partial fill, delayed
  fill, reorg, cancelled transaction, wrong nonce, and reconciliation mismatch.
- Prove that `submission_unknown` never triggers blind rebroadcast.
- Prove emergency stop blocks new submissions while reconciliation continues.
- Distinguish transport acknowledgement, channel acceptance, inclusion, confirmation,
  revert/reorg and venue-order terminal states; no earlier state may imply execution.
- Cover maker/taker tier drift, inclusive builder fees, positive/negative funding,
  partial fills, Arbitrum gas/data fees, reverted gas, delayed rebate and wrong units;
  actual direct charges settle exactly once and reference journal postings.

## Metrics and acceptance thresholds

| Metric | Promotion threshold |
| --- | --- |
| Required inputs with source, revision, and freshness result | 100% |
| Decisions passing with placeholder/missing/disputed inputs | 0 |
| Lifecycle transitions with receipt or failed receipt | 100% |
| Double reservations in concurrency suite | 0 |
| Blind rebroadcasts after uncertain submission | 0 |
| Possible submissions with complete attempt and inclusion receipt | 100% |
| Unresolved injected scenarios without an explicit operator-visible state | 0 |
| Snapshot/preflight added p95 latency | Establish baseline; dossier owner must set a venue-safe SLA before implementation approval |

No percentage reduction in execution failures is accepted without a measured baseline.

## Promotion and kill criteria

1. Contract and deterministic fault-injection suites pass locally.
2. Shadow mode generates complete snapshots and receipts for every selected case.
3. Approval dry runs show no regression in idempotency, policy rejection, or readable
   errors.
4. Any missing receipt, double reservation, blind rebroadcast, secret leak, or policy
   pass with an unavailable input is an immediate kill condition.
5. Autopilot and live submission remain closed until the separate venue certification
   process and explicitly approved funded canaries complete.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.
