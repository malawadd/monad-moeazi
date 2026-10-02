# Validation — Cross-State-Owner Recovery and Continuity

Status: **Implemented** · Activation: **Incomplete — activation gated** · Review: **PASS** · Commit: **this commit**.

## Fixed local corpus

The checked-in corpus covers coherent restore, missing domain, corrupt Timescale,
stale Convex, cutoff disagreement, release/schema/configuration skew, missing Temporal
history, valid empty Redis rebuild, Redis-as-truth rejection, unresolved and reconciled
submissions, missing execution-state/secret-custody evidence, duplicate
schedule/reservation, wrong tenant, retained/deleted evidence
gap, interrupted retry, and production endpoint/outbound rejection.

Each run binds repository SHA, registry version/hash, feature-scoped control hash,
fixture hash, operator test identity and idempotency key. Results compare artifact
readability with strict recovery, show domain verification and typed findings, and
record integer local RPO spread/RTO plus immutable state transitions.

## Acceptance thresholds

- 100% of seven domains have policy and explicit status.
- 100% of declared hash/count/schema/revision/cutoff checks verify or block.
- Zero actual provider, signer, RPC, venue, deployment or production writes.
- Zero read-only readiness before terminal/bounded submission reconciliation.
- Zero normal-resume or product-authority increase from local validators.
- Zero Redis-as-durable-truth behavior.
- Identical frozen retry produces identical artifacts; conflicts fail.
- Pure evaluator local p95 below 10 ms; local persistence p95 below 100 ms.
- Feature-scoped controls fail off on expiry/loss and enforce prerequisites atomically.

Validation begins with strict-schema/hash tests, fixture/adversarial replay, migration
upgrade/rerun checks, Python and TypeScript suites, typechecks, local build, Compose
configuration and Docker image builds. No Convex remote mutation, provider probe,
deployment, funded account, cloud/KMS resource or onchain action is permitted.

## Kill criteria

Kill promotion for a global snapshot claim, restore-in-place first drill,
production-connected restore, owner material, blind workflow replay, latest-timestamp
merge, backup-success-as-readiness, hidden residuals, normal resume, Autopilot change,
external call, tenant leakage, non-idempotent retry or unapproved cost.

The 25–50% read-only recovery-time benefit remains a hypothesis. Production evidence
requires an approved independent drill cohort and cannot be inferred from local fixtures.
