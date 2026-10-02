# Design — Cross-Layer Dependency Safety Envelope

## Contracts

V2 `DependencyHealthReceipt` contains dependency ID, failure domain, canonical scope (`global`,
tenant, account, venue, market, workflow), `observed_at`, `expires_at`, TTL, probe and
adapter version, `HEALTHY | DEGRADED | OPEN | UNKNOWN | STALE`, stable reason, evidence
reference, source revision, canonical hash, and supersession link.

`SafetyEnvelopeDecision` binds receipt IDs/hashes, matrix version, exact operation and
subject, `closed | open | half_open | recovering`, allowed/blocked reasons, incident,
expiry, decision hash, and idempotency key. It is evidence for enforcement and EAD,
never a bearer capability.

V2 decisions also bind a canonical binding hash and normalized request hash. Equal
owner observation times resolve by canonical receipt hash. A matrix-version plus
idempotency-key conflict is rejected durably before current projection. V1 records are
legacy evidence and are deliberately non-enforceable at V2 boundaries.

## Failure domains and operation matrix

Classify dependencies as execution-critical (owner signer, gateway, sidecar, venue),
authority-critical (policy, credits, mode/emergency owner), evidence-critical (market
sources, integrity, model quorum), or observability-only.

The versioned deterministic matrix covers:

`ingest`, `analyze`, `render_previous`, `simulate`, `propose`, `request_approval`,
`preflight`, `submit`, and `reconcile`.

Each cell names required receipt states, fallback display, block reason, recovery probe,
and freshness. A submit outage blocks new preflight/submit but cannot solely block
reconciliation of an outstanding uncertain submission. Evidence outages may permit a
labeled old snapshot while blocking a fresh proposal. No cell relaxes quorum/policy.

## Ownership

- Convex owns current incident/latch and customer/account operation projection.
- Timescale owns immutable receipts, decisions, transitions, and incident timeline.
- Redis holds only expiring local breaker/cache coordination.
- Temporal owns durable recovery, bounded half-open probes, replay, and reconciliation.

Health owners publish through events/outboxes or normal request results. Never add a
worker that polls Convex for health jobs.

## Enforcement and recovery

1. Derive the canonical scope and load owner-current applicable broader and narrower
   receipts; callers cannot author scope keys or TTLs.
2. Missing/expired required receipt becomes `UNKNOWN/STALE`, not healthy.
3. Deterministically evaluate the exact matrix version.
4. Bind exact operation, subject, request, bindings and receipt hashes to the decision.
5. On failure, open/extend the scoped incident idempotently and suppress futile calls.
6. Temporal schedules bounded read-only/idempotent half-open probes with jitter/caps.
7. Require multiple declared recovery observations and any operator latch release.
8. Reconcile uncertain work before lifting related reservations or resuming submit.

Recovery never signs, broadcasts, changes policy/config, lowers quorum, changes mode,
or raises authority. One healthy response cannot close a latched incident.

## Cost, latency, and rollback

Normal cost is local receipt lookup/hash evaluation. Incident savings and storage are
bounded; no provider probe may run without an existing authorized budget. Matrix
evaluation should add low single-digit milliseconds locally. Rollback freezes new
matrix versions, leaves conservative blocks/latches intact, and preserves reconciliation
and incident history for operator resolution.
