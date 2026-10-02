# Execution Artifact Certification

Feature 05 is a local-only, fixture-backed registry for deciding whether the exact
transitive artifact set required by a named execution-shaped operation remains equal
to its reviewed specification. It is **not** a live execution or venue-certification
feature: product availability remains unavailable and automatic requalification is
forbidden.

The registry uses strict canonical JSON and SHA-256 identities. Timescale records
immutable specifications, observations, graph snapshots, decisions, drift latches,
dependent invalidations, and explicit requalification decisions. A repeated scope and
idempotency key returns only an identical decision; a conflicting retry fails closed.
Tenant/account scopes cannot consume another tenant's artifacts.

The Test Center executes checked-in fixture replays only. It has no RPC, signer,
credential, provider, Convex, Temporal, gateway, or sidecar path. Drift blocks the
requested risk-increasing lane. It may report `close_only` only after independent
close and reconcile roots freshly pass. Returning to previous bytes never clears a
latch: an approved, persisted, distinct-reviewer requalification record is required.

Operational rollback turns the Feature 05 Test Center lease off and preserves all
history; it does not clear latches or restore dependent records. Future activation
requires separately approved, cost-disclosed validation of finalized native reads,
provenance, governance/ownership, reproducible images, monitoring, rollback, and
reconciliation drills.
