# Evidence Lifecycle Boundary

## Current status

Feature 03 is locally implemented, implementation-verified, and activation-gated.
Its historical implementation audits are archived for a later roadmap-wide remediation
goal; findings do not promote product authority. Push and continuous ingestion
use a checked-in producer/purpose/sink registry before Timescale or Redis writes.
Analysis snapshots and proposals require a canonical, payload-bound Convex lifecycle decision.
Checked-in Test Center fixtures may run in synthetic observe or isolated enforce mode.
Product activation remains unavailable, and the isolated surface retains Manual Guard,
Lite Mode, closed live/setup gates, and no external network or mutation capability.
Monitoring collections bind every returned run to its authoritative lifecycle state,
and Timescale lifecycle identity is canonical-scope safe across duplicate artifact IDs
and timestamps. Monitoring SSE treats Redis as identity-only notification transport,
reloads the exact durable admitted trace body, and revalidates its decision, body hash,
freshness, scope, and authoritative account lifecycle immediately before disclosure.
Dependency-safety SSE follows the same fail-closed pattern: Redis carries only strict
account/scope and decision/projection identity, while disclosure reloads the exact
Timescale decision and current Convex projection, verifies both canonical hashes and
all duplicated fields, rejects stale or superseded state, records an immutable governed
access receipt, then rechecks the projection before emitting an allowlisted body. It
never copies durable safety reason text: a versioned stable-code registry validates the
internal reason grammar and reconstructs only bounded dependency/status display enums.
The Timescale payload must also pass the shared canonical dependency-safety verifier;
a forged outer decision hash cannot hide an invalid canonical binding digest or another
matrix invariant. Exact sink inventory metadata uses a strict multipart v5 contract;
Python and TypeScript reject duplicate JSON object keys before normalization, missing,
extra, malformed or duplicate part declarations, and duplicate sink IDs, groups,
fingerprints or logical provider entries across every part.
Evaluation replay preserves historical evidence time separately from its workflow-frozen
current run time. Analysis and Evaluation reload the exact decision, canonical payload,
scope, policy route, retention artifact, and frozen retry identity from Timescale at the
real specialist, synthesis, and structured-model dispatch boundaries. The full strict
retention schedule is also reloaded, canonical-hash checked, compared with every duplicated
authority column and its frozen binding, and bounded by the earlier decision/body expiry.
Missing, tampered, mismatched, blocked, or exactly expired authority stops before a call
or usage charge.

Disclosure authorization uses exact-cardinality row sets and PostgreSQL row locks inside
one transaction. Zero or multiple analysis/trace identities fail closed, while locked
state cannot be changed between authorization and receipt/body handling. These queries
are exercised against the local Timescale/PostgreSQL service, not only connection fakes.
Test Center safe defaults derive from canonical implementation verification and isolated
availability. Audit severity is displayed and frozen into runs but cannot enable product
authority; no caller-provided flag can make an unverified feature available.

Analysis archives now bind the exact verified retention schedule and decision contract
inside the same transaction that writes the admitted body, expiry, and decision hash.
All lifecycle disclosure and state-writer paths share a deterministic transaction-scoped
lock keyed by canonical scope and artifact, with collection locks acquired in stable
order. Detail, export, and SSE revalidate every trace event against its immutable
decision, schedule, admitted-body hash, current expiry, hold, tombstone, and latest
schedule-specific copy state. One unverifiable member withholds the whole response.
These bindings and hold/tombstone/copy serialization are exercised end to end against
the real local PostgreSQL service.

This is an engineering safeguard, not a legal-compliance or guaranteed-erasure claim.
Production sink/copy inventories, backup behavior, provider deletion contracts, KMS
proof, legal review, deployment, and activation remain outside local acceptance.

## Ownership

| Owner | Lifecycle responsibility |
| --- | --- |
| Timescale | Immutable decisions, transforms, schedules, commands, copy receipts, holds, tombstones and detailed history |
| Convex | Authenticated current decision, copy and aggregate projections |
| Redis | Transformed expiring bodies and connected-client notifications only |
| Temporal | Durable expiry timers and owner-command coordination; bounded Timescale outbox polling only |
| Provider/backup owner | May report its own disposition; local code cannot promote that report to verified erasure |
| Public chain | Always remains `public_onchain`; never represented as erased |

The boundary is pre-sink. Prohibited content, unknown fields, unknown sinks, malformed
payloads and scope mismatches fail closed. Registry transformations run before hashing,
persistence, transmission, caching, or projection. A decision binds the sanitized
payload hash, policy, copy inventory, scope, expiry, and idempotency key.

## Retention and recovery

Body expiry is separate from minimal safety roots. Evaluation cases are admitted as a
first-class, tenant-scoped Timescale sink before case persistence or model dispatch;
case retries use a separate idempotency root and reads hide deleted snapshot bodies.
Reads also hide case bodies at the exact registered expiry, independently of delayed
physical clearing. The case decision tenant must equal the experiment owner's
registry-derived tenant; a confused worker cannot attach another owner's decision.
A bounded hold pauses body deletion without widening access and cannot restore a
deleted body. Each registered copy receives a durable command and advances an
append-only receipt sequence. Local Timescale and Redis adapters report logical
deletion only after their mutation commits. Temporal history, providers, backups, and
unauthenticated Convex projections remain `unverifiable`; notification-only copies are
`not_applicable`, and public-chain references remain `public_onchain`.

The implemented local runtime operations are classify, persist, provider request,
project, expire, access receipt, local export receipt, bounded hold, owner-scoped body
deletion, and restore validation. Monitoring reads, streams, and exports return only
the exact admitted output bound to a real decision and immutable operation receipt.
Finite confidence, disagreement, and score values use the shared tagged request
normalization; non-finite values fail before any decision or receipt. For retained
artifacts, access/export locks the operation, checks the authoritative lifecycle row,
active holds, tombstones, and latest schedule-bound copy receipts, then stores the
decision and minimal receipt in one transaction. Expired, deleted, quarantined, held,
partial, unverifiable, or erased artifacts disclose no body before cleanup.
Authenticated hold and deletion routes first prove that the artifact belongs
to the caller's strategy account; cross-account and missing artifacts return not found.
These are internal local controls, not a production privacy portal or an external-copy
deletion guarantee.

Retention schedule creation and dispatch use a Timescale transactional outbox. A
singleton Temporal dispatcher polls only that Timescale outbox at a bounded ten-second
interval and starts deterministic child workflows; it never polls Convex or a provider.
Failed starts stay retryable and a duplicate child start is an acknowledged retry.
Hold expiry is prepared durably, projected by revision, then acknowledged; projection
failure leaves it retryable and an old expiry cannot override a renewal or terminal
state. Due expiry clears evidence, analysis, report, provider-call,
evaluation-case/run, and trace bodies while
preserving immutable lifecycle and safety roots. An active hold always wins.

Restore candidates are checked against canonical tombstone IDs, payload/column/hash
agreement, current policy, scope and copy
inventory. Deleted, stale, cross-scope or ambiguous content is quarantined and cannot
enter product projections, caches, monitoring, provider requests, proposals, or
execution evidence.

## Test Center

Feature ID: `evidence-lifecycle-boundary`. Default mode is `off`; off means unknown or
blocked, never raw pass-through. Checked-in scenarios cover successful minimization,
secret and unknown-field blocking, provider minimization, partial/provider deletion,
public-chain non-erasure, deleted-body restore quarantine, and explicit frozen
baseline-versus-candidate outcomes.

No Test Center mode exposes provider dispatch, signing, broadcasting, external
deletion, backup mutation, deployment, or funded/onchain capability.

Sink closure uses Python AST discovery over the complete `moeazi_agent` package and
TypeScript compiler discovery over Convex plus lifecycle-facing Next routes. Redis-backed
monitoring streams are audited as notification-only transports; raw trace or safety
payload forwarding is prohibited. Checked-in
fingerprint roots drift when a write/output boundary is added, removed, or changed;
comments and hand-selected source lists cannot satisfy the check. Provider coverage
includes request, parse, send, invoke, and sync/async streaming dispatch shapes, each
mapped to an exact reviewed policy route.

## Rollback

Freeze the registry and disable new lifecycle workflows. Keep prohibited-content hard
blocks, tombstones, holds, immutable receipts, conservative product bindings, and
existing body deletion. Never restore an expired body, erase receipt history, clear an
unresolved copy, or reclassify legacy rows as governed during rollback.
