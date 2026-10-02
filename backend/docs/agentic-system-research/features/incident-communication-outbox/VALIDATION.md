# Validation and Promotion

Replay dependency outage, uncertain submission, reconciliation mismatch, clock fault,
instrument delisting, evidence correction and emergency stop. Inject crash before/
after commit, duplicate dispatch, lost/replayed ack, out-of-order/corrected/resolved
revisions, membership change, stale session, missing template, retry exhaustion,
escalation race, outage, cross-tenant audience and redaction mutation.

## Thresholds

- 100% material revisions atomically create or deduplicate exact outbox rows.
- Zero cross-tenant/secret delivery.
- Zero acknowledgement-driven incident, latch or authority transition.
- 100% terminal dispatch failures become explicit dead letters.
- 100% templates pass field allowlist/redaction checks.
- Zero effective duplicate delivery per revision/audience/channel.
- In-app visibility p95 below five seconds from committed revision.

Measure revision-to-display, acknowledgement latency, duplicate/unresolved rate and
drill response. Do not claim percentage improvement before a baseline and confidence
interval.

Kill or redesign if acknowledgement changes safety; synchronous delivery blocks
containment; LLMs author/select messages; diagnostics leak; provider acceptance equals
human receipt; delivery is non-durable; queues merge unrelated semantics; or external
fan-out runs without cost/privacy authorization.

## Baseline, datasets, and sample requirements

The baseline is the current repository behavior or the same frozen plan with this
feature disabled. Datasets begin with versioned local fixtures, adversarial cases and
chronological replay that satisfies Evidence Lifecycle and Usage Rights. Deterministic
safety invariants are checked on every enumerated case, not a statistical sample. Any
percentage or quality hypothesis requires a preregistered power analysis and held-out
chronological cohort; an underpowered result is inconclusive. Promotion requires every
feature-specific threshold plus replayability and cost/latency bounds. One hard-gate or
safety-invariant breach triggers kill/demotion and preserved evidence.

Local checks cover deterministic fixture replay, immutable intent persistence and Test
Center projection only; they do not validate an external delivery provider or product path.
