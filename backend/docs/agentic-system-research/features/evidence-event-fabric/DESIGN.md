# Design — Evidence Event Fabric

## Proposed contracts

### `EvidenceEvent`

- stable internal ID, source/source family, source event ID, cursor/sequence;
- chain, market, entities, event type, event time, source-observed time, local received
  time, and persisted time;
- raw payload hash/reference, sanitized content hash/body, schema/parser/normalizer and
  market-mapping versions;
- parent/derivation IDs, correction/supersession/tombstone relation;
- license/retention class and allowed replay/display uses;
- multidimensional quality result and immutable event hash.

The design maps only useful W3C PROV concepts: entity identity, generating activity,
source agent, derivation, and revision. It does not require RDF storage.

### `EvidenceQuality`

Keep independent fields for:

- authenticity/source identity;
- completeness/required fields;
- timeliness and source/ingest lag;
- sequence continuity;
- parser/normalization validity;
- market/entity mapping certainty;
- source reliability state and sanitization result.

Each field carries status and reasons. A single scalar may be derived for ranking but
cannot hide a failed mandatory dimension.

### `FreshnessPolicy`

A versioned policy is keyed by source family, role, market class, and forecast horizon.
It defines maximum source lag, maximum age at analysis, sequence/coverage requirement,
and the failure action: exclude evidence, degrade role, block role, or block proposal.

### `MaterialityPolicy`

A versioned policy defines deterministic features and thresholds by event class,
hysteresis, debounce/coalescing window, cooldown, priority, maximum-staleness cadence,
position/risk override, and maximum trigger rate/cost envelope.

### `AnalysisTrigger`

- stable trigger/idempotency key, market/account scope, event IDs/hashes;
- policy, subscription/profile, runtime-control, and evidence-watermark revisions;
- cause, priority, coalesced causes, created/expiry time, and desired Temporal workflow
  identity.

### `ReplayManifest`

- analysis/job/trigger identity;
- ordered evidence IDs/hashes and missing-source states;
- source watermarks and correction cutoff;
- quality/freshness/materiality policy versions;
- profile, prompt, route, role, and configuration versions;
- observed-time cutoff, trigger cause, and canonical manifest hash.

## Persistence and dispatch

In one Timescale transaction:

1. insert the immutable evidence event or exact duplicate result;
2. record normalization/quality;
3. update durable source watermark state;
4. record the materiality decision;
5. when qualified, insert a pending trigger-dispatch row with stable identity.

After commit, notify an evidence dispatcher. The dispatcher claims pending rows by
indexed status/lease, applies existing Redis coalescing and budget/runtime gates, and
starts the deterministic Temporal workflow. It records acknowledgement or retry in
Timescale. A bounded recovery scan over the pending index handles lost notifications;
it never polls Convex for jobs.

Redis loss can reduce hot-cache efficiency but cannot lose accepted evidence or an
undelivered trigger.

## Dedupe and correction semantics

- Exact duplicate: same source identity/event ID or sequence and same payload/content
  hash; record delivery metadata but do not create a new logical revision.
- Correction: same logical source identity with different content hash and explicit or
  inferred revision; append a new event linked by `supersedes`.
- Late arrival: append with original event/observed time and current received time;
  never rewrite a prior manifest.
- Tombstone/retraction: append a typed event and invalidate later derived views, not
  the immutable historical record.
- Gap: mark source health incomplete, request cursor/snapshot recovery, and block
  affected freshness policies until continuity is restored.

## Material triggers

Materiality is code, not an LLM judgment. It compares the event with a frozen baseline
for price, realized volatility, depth, funding, market integrity, news class, or
onchain/protocol state. High-risk open positions and reconciliation/emergency events
override quiet-market suppression. Coalescing combines related causes without losing
their IDs. A maximum-staleness Temporal cadence ensures eventual refresh.

## Role and run behavior

- A missed optional source objective excludes that evidence and records degradation.
- A missed required source objective follows the role evidence contract: degrade,
  omit, block, or abstain.
- Critical-role and model-family quorum are not implicitly recalculated.
- Injection sanitization treats external text as evidence, never instructions.

## Operational SLIs

- source lag, ingest lag, sequence-gap duration, accepted-event loss, exact duplicate
  rate, correction rate, quarantine rate;
- durable-trigger creation and dispatch delay;
- workflow-start delay, coalescing ratio, trigger suppression, maximum-staleness runs;
- analyses with complete manifests and source/event completeness inside each manifest;
- queue depth, retry/dead-letter count, and provider work avoided.

“Healthy feed” means connected, sequence-continuous, inside source-lag SLO, parser
valid, and downstream Timescale/dispatcher/Temporal available.

## Failure behavior

- Parser/schema change: quarantine until a versioned normalizer validates it.
- Event storm: bounded priority queue, hysteresis, coalescing, per-account/global caps,
  and preservation of execution/risk priority.
- Timescale commit failure: no Redis/Temporal side effect.
- Dispatch failure after commit: retry same trigger identity.
- Temporal success/ack failure: deterministic workflow ID returns existing work, then
  acknowledgement is repaired.
- Source outage: mark health, preserve maximum-staleness behavior, and fail role/policy
  gates according to the frozen policy.

## Later implementation sequence

1. Add contracts and append-only tables with recorded adapter fixtures.
2. Add exact dedupe, correction, gap, and watermarks.
3. Add replay manifests for cadence/manual runs before event triggering.
4. Add durable trigger dispatch and Redis coalescing.
5. Run event triggers in Shadow with Manual Guard/Lite defaults preserved.
6. Enable source families incrementally after SLO and replay acceptance.

Rollback disables new event-trigger dispatch but retains ingestion/manifests and the
maximum-staleness Temporal cadence. Pending triggers remain auditable.

## Folded analytical run manifest

Extend `ReplayManifest` with one canonical `AnalyticalRunManifest`, not a parallel
attestation service. Record requested and observed provider/model identity separately;
each value is `observed | provider_declared | configured | unavailable`. Bind prompt,
schema, tool (explicit empty set when absent), retrieval, evidence, policy, config,
container image, git revision, Temporal workflow build, parent run-plan/candidate IDs,
cutoff, retained-artifact references, and manifest hash.

A hash without retained bytes or immutable reference is identity only, not replay.
Opaque-provider nondeterminism and unavailable served identity remain explicit. Never
store credentials/secret-bearing configuration, trigger provider probes or CI, claim
model attestation, or use provenance as promotion/authority by itself.

## Folded static evidence-adapter contract

`EvidenceAdapterManifest` binds stable adapter/source/family ID, schema and manifest
hash, fixed allowlisted origin/operation, canonical market maps, role/horizon/event
scope, response MIME/schema, maximum bytes/items/pages/cost/latency, timeout/retries,
cache/replay/retention/license rules, parser/normalizer/sanitizer/quarantine hashes,
credential-reference scope (never secret), owner/reviewer, activation and expiry.

`ReadOnlyEvidenceQuery` binds the activated manifest/hash, deterministic planner rule,
canonical market/chain/window/cursor, closed parameters, role/horizon/use, limits,
deadline, watermark/cache/replay identity and idempotency hash.

The ingestor enforces origin/redirect/egress/content/budget limits, then normalizes,
sanitizes, quarantines or persists immutable EvidenceEvents. Only persisted sanitized
IDs/hashes reach models. “Read only” is enforced by adapter code, HTTP method/origin,
scoped credentials and network policy—not a server annotation.

Do not add an MCP client/server, `tools/list`, model-selected call, dynamic registry,
arbitrary URI, server description in context, raw result bypass, or credentials in
Convex/Redis/Temporal/model inputs. Metered data fetches require previewed maximum cost
and specific user approval.
