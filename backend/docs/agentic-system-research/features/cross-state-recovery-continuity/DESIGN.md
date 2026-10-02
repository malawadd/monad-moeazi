# Design — Cross-State-Owner Recovery and Continuity

Status: **Implemented** · Activation: **Incomplete — activation gated** · Review: **PASS** · Commit: **this commit**.

## Contracts and ownership

The versioned registry covers `convex_product_state`, `timescale_history`,
`temporal_workflows`, `repository_release`, `redis_coordination`,
`external_execution_state`, and `non_owner_secret_custody`. Each policy owns its
method, evidence kinds, labeled RPO/read-only-RTO target, independent-proof requirement
and omission behavior.

Strict, float-free contracts define domain evidence, a per-domain recovery point set,
frozen drill plan, isolated restore plan/result, typed cross-state findings, reconciliation decision,
readiness verdict, inspection-only receipt and drill receipt. Canonical identities use
sorted SHA-256 inputs. Identical frozen input and time produce identical artifacts.
No contract accepts paths, URLs, endpoints, commands, credentials, arbitrary TTLs,
unbounded prose or a global snapshot timestamp.

Timescale owns immutable recovery artifacts, run transitions and Test Center history.
Redis owns only feature-scoped two-hour operator leases. Convex and Redis never own
recovery history. Temporal is represented as a recovery domain and cannot orchestrate
its own recovery.

## Evaluation and state machine

`planned → evidence_captured → point_set_frozen → restore_started → restore_verified
→ reconciling → evaluated → read_only_ready|blocked → closed`.

Every locally required domain must verify. Redis must begin empty and rebuild from durable
owners. Hash, checksum, count, schema, revision, cutoff, tenant, schedule, reservation,
submission and outbound/write invariants fail closed. Checked-in coherent fixtures
provide explicit synthetic evidence bindings for external execution and non-owner
secret custody; missing or unbounded evidence blocks read-only. Those local bindings
never convert into product health: product dependency receipts remain `UNKNOWN`.

The weak baseline asks whether an artifact is readable. The candidate requires
cross-owner consistency. A successful local candidate may allow only inspection,
previous-safe rendering and read-only reconciliation. Normal resume is always blocked.

## Test Center and Dependency Safety

Feature controls bind feature ID, registry version/hash, requested/effective mode,
dependency-closed layers, revision, expiry and prerequisite ID/revision/registry/hash.
Feature 02 observe requires Feature 01
through project; isolated enforce requires Feature 01 isolated enforce through all
layers. Multi-key CAS binds the prerequisite at control change, and an atomic snapshot
revalidates closure immediately before every frozen run. Missing/invalid Redis state
returns off. Toggles affect new frozen runs only.

Dependency Safety v2 requires `recovery_continuity` for propose, request approval,
preflight and submit. It excludes ingest, analyze, previous rendering, simulation and
reconciliation. Product owners emit `UNKNOWN`; observe records would-block and product
authority is not increased.

## Failure, rollback, cost and latency

Persistence is one Timescale transaction. Conflicting idempotency reuse fails; late
history cannot overwrite anything. Rollback turns the Feature 02 lease off, freezes
new registry versions, retains immutable evidence, leaves recovery continuity unknown,
copies no restored data into production, and keeps inspection/reconciliation plus all
Feature 01 and execution ceilings intact.

Pure evaluation targets local p95 below 10 ms; persistence targets p95 below 100 ms,
excluding startup. External infrastructure costs are unknown and not authorized.
