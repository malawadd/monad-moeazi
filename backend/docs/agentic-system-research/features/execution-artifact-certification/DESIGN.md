# Future Design

## Contracts

`ExecutableArtifactSpec`

- artifact ID/type, chain/domain, address or endpoint;
- proxy/beacon/admin topology, implementation/runtime hashes;
- ABI/schema/selectors, typed-data domain, roles, hook bits and pool identity;
- adapter/SDK/image/git versions and transitive dependencies;
- certified operations, review/test evidence, effective time, expiry/revocation and
  canonical hash.

`ArtifactObservation` records boundary-specific code, slots, implementation, beacon,
admin, domain, schema/config and dependency versions with block/hash/finality, source
and freshness.

`CertificationDecision` binds operation, account, route/grant and required artifact
set to `pass | block | close_only | unknown`.

`DriftEvent` records prior/current observations, affected dependants, severity, latch
and requalification state. All contracts are strict and reject unknown fields.

## Flow and ownership

1. A reviewed specification enters the registry with immutable evidence and expiry.
2. Event/config ingestion may detect drift early; it never grants authority.
3. Gateway/sidecar resolves and reads the full required artifact set immediately
   before preparation and again before signing/dispatch.
4. Deterministic comparison emits a decision and invalidates every dependent route,
   capability decision and intent-equivalence receipt on mismatch.
5. Temporal owns durable observation and requalification work. Timescale owns specs,
   observations, decisions and drift history. Convex owns bounded current status.
   Redis is a short-lived cache only.

No worker polls Convex. Re-certification is explicit and review-backed; it is never an
automatic response to a new hash.

## Failure and safety behavior

Unknown topology, unresolved dependency, stale observation, expired certification,
reorg or code/config/domain/build drift blocks preparation and new exposure. A
`close_only` decision requires a separate, current emergency artifact set; ordinary
certification cannot be reused after drift. Reconciliation remains available through
its own certified read path.

`CERTIFIED_VENUES`, target allowlists and code hashes are inputs, never sufficient
authority. The registry does not copy grant state from the capability ledger.

## Sequencing, rollback, cost and latency

## Local implementation boundary

The implemented path is limited to fixture graph evaluation, local immutable history,
and isolated Test Center presentation. Product projections, normal gateway routes,
automatic requalification, and live execution integration are intentionally absent.

1. Inventory Uniswap/GMX targets and the isolated v4 hook evidence.
2. Add canonical specs, proxy resolution and local mutation fixtures.
3. Generate Shadow decisions and dependency invalidations.
4. Require the gate in Approval dry-runs, then per certified venue/action.

Rollback closes new preparation for the affected artifact and preserves observations,
drift latches and close/reconcile paths. Expected costs are engineering, state reads
and storage; no model/provider cost is required. Target added p95 boundary-read
latency is under 300 ms with coherent RPC/cache state and under 1 second on refresh,
subject to per-venue measurement.
