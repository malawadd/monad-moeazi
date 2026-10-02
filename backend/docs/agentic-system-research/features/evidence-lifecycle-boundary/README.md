# Evidence Lifecycle Boundary

## Decision

**Approved as a shared data-policy/enforcement layer — 93/100.**

## Implementation status — 2026-08-09

**Implemented locally / implementation verification PASS / audit findings deferred.**

Product activation remains unavailable. Synthetic observe and isolated enforcement are
available only inside the isolated Test Center, where Manual Guard and Lite Mode remain
on and provider, wallet, venue, Convex, deployment, production-write and external-network
capabilities remain absent. Historical findings are preserved in the local deferred-audit
package for the later roadmap audit goal; they do not trigger remediation in this goal.

The user-authorized sixteenth remediation round removes durable safety reason strings
from SSE output. The shared canonical verifier accepts only matrix-owned dependency IDs,
a fixed internal grammar, and registered stable owner codes, then reconstructs bounded
`dependency_*` display enums. An exact outer-hash-valid blocked decision containing a
confidential marker is withheld before lifecycle access in portable and real PostgreSQL
tests. The sink inventory is now multipart v5. Both language loaders reject duplicate
JSON keys before parse normalization and enforce exact part closure plus globally unique
sink IDs, group kinds, provider fingerprints, and logical entries. Cross-part collision,
missing, extra, malformed, and duplicate-key fixtures fail closed while honest discovery
closure remains 231 Python sinks, 260 TypeScript sinks, and 39 provider callsites.

The user-authorized fifteenth remediation round routes safety-stream decisions through
the shared canonical dependency-safety verifier before applying persisted-row,
projection, account, freshness, lifecycle-access, and post-access checks. This catches
a self-consistent forged outer decision hash whose embedded binding hash is not the
canonical sorted-bindings digest; portable and real PostgreSQL tests prove it emits no
event and stores no access receipt. An audit found the other Python execution boundaries
already use this verifier; the Convex verifier remains a separate runtime-specific
request/projection check because its persisted representation is intentionally camelCase
and millisecond-based. Round fifteen first split the generated inventory to satisfy the
line ceiling; round sixteen replaces that format with the duplicate-strict multipart v5
closure described above.

The user-authorized fourteenth remediation round closes the dependency-safety SSE
disclosure bypass. Redis now publishes a strict identity-only notification bound to an
account scope and durable decision/projection IDs, hashes, revision, and timestamps.
The consumer rejects unknown fields and cross-account or ambiguous scopes, reloads the
exact Timescale decision and current Convex projection, verifies canonical hashes,
duplicated authority fields, expiry and supersession, records an immutable lifecycle
access receipt, rechecks current projection state, and emits only a reconstructed
allowlisted body. Missing, stale, expired, superseded, tampered, malformed, or uncertain
owner state produces no event. Adversarial fixtures include a synthetic secret field,
prefix-confusable accounts, and a projection change after the stream opens.

The user-authorized thirteenth remediation round closes the exact archive binding,
cross-writer serialization, and per-trace disclosure findings without changing
acceptance criteria. `AnalysisRepository.save_run` accepts and reloads the complete
strict decision and retention schedule, verifies their canonical hashes and duplicated
authority columns, and atomically stores the admitted body, exact expiry, and decision
hash. Every lifecycle disclosure and state writer uses the same transaction-scoped
advisory lock derived from canonical scope and artifact; multi-artifact collections use
stable ordering. Detail, export, and SSE validate every event's exact durable decision,
schedule, admitted-body hash, expiry, hold, tombstone, and latest schedule-specific copy
state, withholding the complete response when any member is missing, forged, expired,
held, partial, unverifiable, quarantined, or deleted. Real PostgreSQL tests exercise the
full evaluator-to-schedule-to-archive-to-list/detail/export/SSE path without manual
expiry injection and prove hold, tombstone, and copy writers wait for disclosure locks.

The earlier twelfth remediation round closed disclosure-SQL and safe-default findings.
Disclosure checks replace
windowed locking with exact-cardinality Timescale/PostgreSQL row locks inside one
transaction. Zero, duplicate, expired, deleted, held, disputed, or copy-blocked state
fails closed; governed list, detail, export, and SSE paths now have real local database
coverage, including a concurrent mutation that remains blocked until transaction release.
Test Center safe defaults derive availability only from canonical implementation
verification and isolated-surface metadata, with no trusted caller enable flag. Analysis specialist and
synthesis calls and every Evaluation v2 provider branch asynchronously reload both the
exact Timescale lifecycle decision and complete strict retention schedule immediately
before dispatch. Verification recomputes both canonical hashes, compares every duplicated
authority column and exact frozen contract, checks decision-to-schedule policy/scope/hash
bindings, and requires current time to precede both expiries. Missing, malformed,
mismatched, tampered, blocked, or exactly expired rows stop before provider calls,
credits, or cost accounting. Unverified or non-isolated features remain unavailable at
the registry, CAS, snapshot-freeze, direct runtime, and API-state layers. Feature 03 is
product-unavailable but locally implementation-verified, so its frozen synthetic fixtures
may run in observe and isolated enforce modes with audit metadata bound into each run.
Populated migrations 010–013, real local migration 013, and their reruns pass.

The uncommitted local implementation provides strict contracts, checked-in classification and sink
policy, pre-sink evidence enforcement, immutable Timescale lifecycle history, Convex
current decision bindings, Redis-safe transformed caching, Temporal expiry
coordination, durable per-copy owner commands, governed Evaluation case and trace sinks,
payload-bound access/export, retry-safe hold expiry, copy-level deletion aggregation, eleven Test Center
fixtures, restore quarantine, and a baseline-versus-candidate lifecycle result UI.
Redis evidence-copy disposition now uses the exact ingestion locator and verifies the
delete result; every command and copy receipt is schedule-bound. Monitoring bodies are
returned ephemerally and immutable history retains only decision/output hashes.
Evaluation cases bind the exact owner tenant and become unreadable at expiry even
before asynchronous clearing. Dedicated operation idempotency columns, exact provider
dispatch fingerprints, and causally ordered Convex status transitions close retry and
late-event races. Monitoring-shaped finite floats use the shared tagged request
normalization before float-free receipt construction. Access/export synchronously
check authoritative expiry, deletion, quarantine, hold, tombstone, and copy state in
the same locked transaction that stores the decision and receipt. Legacy schedule-null
receipts remain quarantined history, and legacy output bodies are removed during the
populated migration. Streaming provider methods are included in exact callsite review.
Production sink/copy inventory, legal/privacy review, provider and backup proof, KMS
evidence, deployment, and activation remain gated.

Score: fit 14, evidence 11, safety 14, execution boundary 13, benefit 10,
evaluation 10, data 7, cost 7, latency 7.

## Problem and causal argument

Current traces redact known keys and truncate content, but settings alone do not prove
purpose-specific minimization, retention or deletion across every sink. Classifying
and transforming before persistence/export reduces both copy count and exposure time;
durable per-copy receipts prevent a failed deletion from appearing complete.

## Why implement it

- Default-denies prohibited content and unknown producer/purpose/sink combinations.
- Applies allowlisted transforms before Timescale, Convex, Redis, Temporal, logs or
  provider/model requests.
- Makes classification, governed persistence, provider requests, product projections,
  expiry, and restore validation observable in the implemented runtime paths.
- Records monitoring access and local export as immutable receipts, and provides
  authenticated account-scoped hold and body-deletion controls. External copy deletion
  remains provider-reported or unverifiable and is never presented as complete.
- Dispatches retention schedules through a transactional Timescale outbox and a
  deterministic Temporal child workflow. One singleton polls the Timescale outbox at
  a bounded ten-second interval, never Convex; start failures remain retryable.
- Preserves minimal safety roots while allowing raw bodies to expire lawfully.

## Benefit and confidence

| Target | Range or invariant | Confidence |
| --- | --- | --- |
| Enabled persistence/export paths invoking the boundary | 100% | High |
| Seeded prohibited fields reaching an enabled sink | Zero | High for enumerated corpus |
| Retained evidence/trace body bytes | At least 30% reduction | Medium hypothesis |
| Restricted-field copies | At least 50% reduction | Medium hypothesis |

No legal-compliance, anonymization or guaranteed-erasure claim is made. Percentages
require a measured local before/after corpus and non-inferior safety observability.

## Boundaries

Evidence Fabric retains event identity/lineage; tracing retains trace semantics. This
feature is a shared policy gate, not a second store or event lifecycle. It cannot erase
public onchain data or compel an external provider to delete. Paid KMS/vendor deletion
APIs require separate cost approval.

See [EVIDENCE.md](./EVIDENCE.md), [DESIGN.md](./DESIGN.md), and
[VALIDATION.md](./VALIDATION.md).

## Assumptions, costs, risks, and confidence

This recommendation assumes its named authoritative owners can supply versioned,
fresh inputs while the existing signer, service-ownership and idempotency boundaries
remain intact. Engineering, replay compute, storage, latency and human-review effort
are real but unpriced costs; any paid provider, cloud, CI, deployment or onchain work
still requires separate approval. The main risks are false assurance from incomplete
inputs, added operational complexity and latency. Missing or disputed evidence must
fail closed or reduce authority. Confidence is medium for deterministic invariants and
low for any quantitative benefit unless this dossier states stronger evidence.
