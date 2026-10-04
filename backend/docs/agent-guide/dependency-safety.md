# Dependency Safety Envelope

## Current status

The v2 cross-layer envelope is implemented behind `DEPENDENCY_SAFETY_MODE`. The
tracked development default is `observe`; `enforce` is available for local fixture
acceptance only. Startup rejects `LIVE_EXECUTION_ENABLED=true` unless the envelope is
in `enforce` mode. This does not certify live execution.

The isolated `/agent-lab/test-center` may run checked-in synthetic fixtures in observe
or enforce mode. Its mode is not the product mode: it is operator-allowlisted,
loopback-configured, Manual Guard/Lite Mode ON, Redis-lease bounded, Timescale audited,
and has no Convex/provider/signer/venue/deployment path.

The envelope is deterministic safety reduction, not an authorization source. Manual
Guard, emergency stop, customer mode, policy, certification, signer isolation, quote
freshness, and live gates remain independent and may only reduce authority.

## Contracts and matrix

`DependencyHealthReceipt` records a registered dependency, failure domain, canonical
structured scope, status, owner observation time, registry-owned expiry, reason code, adapter and
source revisions, evidence reference, supersession link, observation key, and SHA-256
canonical hash. `SafetyEnvelopeDecision` binds the applied receipt hashes and incident
keys to an operation, subject, scope, matrix version, idempotency key, proposal/policy/
quote/venue/account references, canonical binding/request hashes, outcome, breaker
state, and bounded expiry. Callers cannot author scope keys; exact binding sets are
operation-owned. Equal-time observations use canonical-hash tie-breaking.

Canonical JSON is sorted and rejects floating-point values. Callers cannot choose
TTLs or attach free-form reason text. The registry in
`dependency_safety_matrix.py` owns dependency TTLs and recovery intervals.

V2 evaluates `ingest`, `analyze`, `render_previous`, `simulate`, `propose`,
`request_approval`, `preflight`, `submit`, and `reconcile`. Missing, expired,
malformed, or owner-unknown inputs block the relevant deterministic outcome. Observe
mode records that block as `would_block`; it does not weaken an existing gate.

## Persistence and ownership

- Timescale stores immutable receipts, decisions, and incident-transition history.
- Convex stores bounded current health, operation, and incident projections. Generic
  `incidentEvents` receives material lifecycle summaries only.
- Temporal owns one signal-driven workflow per active incident. It waits for receipt
  signals and a recovery timer; it never polls Convex or probes a provider.
- Redis stores only expiring breaker coordination and publishes authenticated-client
  updates. Redis loss prevents recovery promotion but cannot erase durable state.

Every assessment loads current owner receipts, then writes Timescale before its Convex
projection. A failed durable write aborts the boundary. Reusing one v2 idempotency key
with different content is a durable conflict. Late observations remain immutable and
equal timestamps resolve deterministically. V1 rows stay readable but cannot enforce.

Scope application is monotonic from global through tenant, account, venue, market,
and workflow. A relevant broader failure remains blocking even if a narrower receipt
is healthy. Unrelated account or venue receipts do not apply.

## Runtime boundaries

- Passive ingestion evaluates each source result before evidence persistence.
- Analysis uses a fresh boundary time and evaluates before credit reservation or provider dispatch.
- Proposal and approval-request creation require exact current decision hashes.
- Shadow fills require an exact simulation decision hash.
- Gateway requires a fresh admission decision before quote/health work, then returns
  post-quote policy, preflight-safety, and submit-safety decisions;
  policy binds the exact submit decision hash.
- Dispatch revalidates hash, operation, subject, the exact binding set, normalized
  request hash, idempotency, matrix version, schema version and expiry immediately
  before any simulation or external mutation.
- Reconciliation has a separate preflight and stays independent of submit-only gates.

Models receive none of the receipts, incident controls, thresholds, or decisions.
Monitoring traces contain only stable reasons and abbreviated hashes.

`recovery_continuity` is authority-critical for propose, request approval, preflight
and submit. Its current product observation is always
`UNKNOWN / recovery_continuity_not_authoritatively_proven`; an isolated Test Center
drill cannot emit a healthy product receipt. Ingest, analyze, previous rendering,
simulation and reconciliation do not require it.

## Visibility and recovery

`/risk` and `/agents/monitoring` show explicit allowed, blocked, observing, stale,
and unknown operation states plus scoped dependency incidents. The authenticated
`/v1/monitoring/safety` endpoint returns tenant-owned projections. Redis/SSE pushes
changes without adding a polling worker. Run graphs place dependency-safety nodes
before the proposal, policy, simulation, and execution nodes they protect.

An unhealthy owner observation opens or reopens an incident idempotently. Recovery
needs Redis coordination and two fresh healthy owner observations separated by the
registered interval. Every non-resolved durable projection remains latched: elapsed
time, restart, Redis restoration/loss, or one aged healthy receipt cannot release
authority. Release begins only after the second distinct owner receipt durably projects
the incident as `resolved`. A new failure resets recovery. Recovery never signs, broadcasts,
changes customer mode, relaxes quorum, or calls an external provider.

## Honest activation-gated unknowns

Authoritative risk snapshots, reconciliation clearance, and certified owner-signer
readiness do not yet have implemented owners. Their receipts are deliberately
`UNKNOWN`. Consequently preflight/submit cannot claim safe live authority. This is
the intended dependency on the later authoritative-risk and reconciliation dossier,
not a placeholder `true`.

The next research integration item is Cross-State-Owner Recovery and Continuity. It
is not part of this implementation.
