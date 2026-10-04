# Data, Caching, and Convex IO

For the new operational PostgreSQL financial writer, immutable native observation
records, and Convex viewer projection, read [financial authority](financial-authority.md).

External product-eligibility fixtures persist immutable metadata hashes and safe aggregates in Timescale only. They never create Convex state or Redis eligibility/cache state; source currency and product enforcement remain unavailable.

## Feature 34 fixture storage

Feature 34 records local deterministic planning fixture metadata only. It has no
Convex projection, Redis budget reservation, Temporal schedule, provider cache, or
product snapshot consumer.

## Feature 35 fixture storage

Feature 35 retains only append-only local synthetic episode, outcome revision, score and
bundle receipts. It adds no Convex projection, Redis memory/index/cache, Temporal work,
provider/vector service, or product consumer.

## Storage ownership

Feature 29 stores immutable local fixture-run detail through Timescale migration 041.
It creates no Convex projection, Temporal workflow, or Redis state beyond the existing
expiring Test Center control lease.

Feature 33 stores synthetic Shadow/TCA fixture receipts and idempotency claims in
append-only Timescale tables from migration 045. Redis remains limited to the existing
Test Center control lease; Convex and Temporal receive no Shadow/TCA state.

| Store | Durable responsibility |
| --- | --- |
| Convex | users, strategy/wallet linkage, agent config, current snapshots, proposals, approvals, credits, venue readiness, material audits |
| Timescale/Postgres | sanitized evidence, full agent reports, provider calls, syntheses, traces, daily usage, encrypted BYOK vault |
| Redis | runtime controls, daily caps, provider reservations, locks, dedupe windows, hot evidence, public demand, short caches, live trace pub/sub |
| Temporal | workflow/schedule history and durable execution state |

Feature 20 fixture history is append-only Timescale/Postgres evidence only. Redis does
not store consent nonce truth, and Convex/Temporal receive no Feature 20 state.

Dependency safety follows the same ownership: immutable receipt/decision/transition
history in Timescale, current projections in Convex, signal-driven incident state in
Temporal, and expiring breaker/notification coordination in Redis. Redis cannot
resolve or erase a durable incident.

Recovery continuity stores immutable local drill artifacts and transitions in
Timescale. Redis keys `moeazi:test-center:controls:v2:{operatorTestId}:{featureId}`
are expiring operator leases only. Convex, Redis and Temporal never own recovery
history, and no process polls Convex for recovery.

Operational-secret custody stores only decision, receipt, lifecycle, readiness,
workflow-command and legacy-shape metadata in Timescale. Fake envelopes and KEKs live
only inside one local vault object. Convex gets no Feature 04 table; Redis and Temporal
receive no secret, envelope material, or bearer handle.

Venue price/liquidation fixture graphs, observations and decisions belong only to
Timescale migration 024. Redis retains only the existing expiring Test Center control
lease and cannot hold prices, receipts, safe lanes or authority state.

Execution artifact certification stores local immutable specifications, observations,
graph snapshots, decisions, drift latches, invalidations, and explicit
requalification metadata in Timescale. Convex has no Feature 05 table and Redis only
holds the existing expiring Test Center control lease; neither can certify or clear a
latch.

Instrument lifecycle fixtures store immutable definitions, aliases, events,
decisions and rebaseline metadata in Timescale migration 017. Convex has no Feature
07 state, and Redis cannot resolve an identity or advance a lifecycle watermark.

Capability delegation fixtures reserve immutable grant, observation, transition,
decision and Test Center bundle rows in migration 020. Redis holds only existing
expiring Test Center leases and can neither grant nor revoke any capability.

Safety change quorum fixtures reserve immutable request, qualification, attestation,
decision, apply and lease receipt rows in migration 028. Redis cannot contain quorum,
qualification, request, approval, nonce, revocation, or receipt truth; Convex and
Temporal have no Feature 16 projection or workflow in this local slice.

Operator qualification fixtures reserve immutable synthetic scope, training, drill,
oracle, calibration, review, decision, grant, revocation and consumption receipts in
Timescale migration 029. Redis keeps only the existing Test Center control lease;
Convex and Temporal have no Feature 17 state or workflow.

Asset Conservation Journal fixtures reserve immutable exact-unit accounts, source
events, manifests, checks and commit receipts in migration 022. Redis has no journal
namespace and cannot hold postings, watermarks, conflicts, finality or settlement truth.

Intent–Execution Equivalence fixtures reserve immutable scope-qualified reviewed
envelopes, observations, plans, contexts, checks and receipts in migration 023. Redis
has no receipt namespace; a Test Center lease cannot create, cache, or replay authority.

Evaluation experiments, frozen cases, detailed model runs, forecast outcomes,
simulated fills, annotations, and scorecards live in Timescale. Detailed sanitized
evaluation bodies retain for 90 days; compact scorecards and experiment summaries do
not expire automatically.

V2 also stores preview manifests, immutable plan items, reusable owner-scoped
templates/suites/prompt bundles/cases, and durable budget-allocation audits in
Timescale. Redis atomically reserves matching per-day shared capacity.

Do not duplicate full history into Convex. Do not make Redis the only record of a
customer decision or material execution transition.

## Important Convex table groups

Agent product state:

- `agentProfiles`, `agentMarketSubscriptions`
- `automationPolicies`, `agentModelConfigurations`, `modelProviderConnections`
- `analysisJobs`, `analysisSnapshots`
- `tradeProposals`, `approvalRequests`, `shadowExecutions`
- `creditAccounts`, `creditReservations`, `creditLedger`, `creditClaims`
- `publicMarketDemand`

Wallet and execution state:

- `users`, `strategyAccounts`, `accountWallets`
- `venueIntegrations` for control-plane intent/readiness
- `venueAccounts` for protocol linkage/execution account data
- `venueCredentials`, `venuePermissions`, `venueSetupAttempts`
- `optimismMigrations`
- trade, payment, withdrawal, lease, execution, audit, reconciliation, and incident
  tables in `convex/schema.ts`

Use existing compound indexes. Never scan historical `analysisJobs` to find active
work. Account/market/status, dedupe, and idempotency indexes exist for that purpose.

## Snapshot rule

Convex keeps one current snapshot per logical scope:

- shared public market;
- private strategy account plus market.

Patch/replace the current row rather than appending visualization history. Timescale
retains history. UI-facing snapshot payloads contain the five visualization sections:
`forces`, `story`, `scenarios`, `agents`, and `galaxy`, plus private overlays.

## Redis keys and TTL behavior

Current key families include:

| Key pattern | Purpose / lifetime |
| --- | --- |
| `moeazi:runtime-controls:v1` | persistent development control state |
| `moeazi:latest-run-metrics` | Agent Lab metrics, 24 hours |
| `moeazi:lite-*:YYYY-MM-DD` | account/global run and spend caps, 48 hours |
| `byok:provider-spend:{date}:{account}` | BYOK daily reservation, 48 hours |
| `openrouter:catalog:v2:{keyHash}` | per-credential catalog, 300 seconds |
| `routing:markets:v2` | public market catalog, default 300 seconds |
| `routing:preview:v1:{digest}` | quote comparison, default 10 seconds |
| `swap:approval:42161:*` | approval state, 30 seconds |
| `analysis:lock:*` | account/market overlap lock, default 300 seconds |
| `analysis:trigger:*` | trigger coalescing, default 30 seconds |
| `public:demand:{MARKET}` | viewer demand, 90 seconds |
| `evidence:hot:*` | normalized hot evidence from optional ingestion |
| `evaluation:budget:*` | atomic experiment/global provider-cost ceilings |
| `evaluation:v2:plan:*` / `evaluation:v2:global-reserved:*` | complete finite-plan reservations |

TTL values are implementation defaults, not guarantees. Execution must always recheck
approval, quote freshness, balance, policy, and health before signing; caches are
performance hints, never authority.

## Cache behavior by surface

- Provider catalog: Redis-backed because OpenRouter can expose hundreds of models;
  filtered pages are returned to the browser, not stored in Convex.
- Venue routing: public market and preview cache bypasses Convex, avoiding quote IO
  against the product database.
- Uniswap approval: cached briefly, then always rechecked before execution.
- Monitoring: HTTP reads use `no-store`; live trace updates use Redis pub/sub only
  while a client is connected.
- Next.js agent/provider/monitoring clients use `cache: "no-store"`.
- JWKS is intentionally browser/CDN cacheable for five minutes with stale revalidate.
- Convex query subscriptions are reactive and should not be wrapped in browser polling.

## Zero-idle-traffic rule

The expected agent-system behavior while idle is zero Convex calls:

- Default workers wait on Temporal task queues.
- Temporal schedules are paused by Manual Guard in development.
- The legacy dispatcher that claimed jobs every second is removed from normal startup.
- Continuous ingestors are disabled in Lite/default development.
- Public demand mutations are not an excuse to run a polling worker.
- The evaluation worker waits on its Temporal queue and collects no data when no
  experiment is active.

If idle IO appears, inspect active Compose profiles, stale legacy containers,
frontend intervals, and Temporal schedules before changing Convex limits.

## Convex mutation pitfalls

- Convex patching with a property explicitly set to `undefined` removes that field.
  Build conditional patches for optional input so required fields are not deleted.
- Do not spread authentication-only arguments such as `subject` into stored documents.
- JSON blobs (`routesJson`, `policyJson`, `payloadJson`) need validation on both the
  TypeScript and Python boundaries. Do not treat them as arbitrary dictionaries.
- Preserve version numbers and active/draft/superseded transitions.
- Use deterministic dedupe/idempotency keys before insert.
- Record material audit transitions, not heartbeat noise.
- Keep secrets and complete provider catalogs out of Convex.

## Failure semantics

- Missing Redis runtime controls: fail safe to Manual Guard/Lite Mode.
- Redis loss during routing: current routing requests fail; never fabricate quotes or
  fall back to Convex polling.
- Provider validation failure: fail/refund, retain sanitized operational trace.
- Timescale trace write failure must not grant execution authority.
- Convex snapshot failure means the product result is not complete; do not report
  success solely because a provider returned output.
- Governed evidence bodies require a fresh lifecycle decision. Deleted, expired,
  quarantined, and legacy-unclassified bodies are excluded from normal reads.
- Redis may contain only the transformed lifecycle payload with a registry-owned TTL;
  Redis loss cannot prove deletion, clear a hold, or restore a body.
- Feature 14 stores immutable local fixture latch/inventory/plan/receipt history in
  Timescale/Postgres. Redis holds only the existing expiring Test Center control lease;
  no termination state is cached or inferred from Redis.
- Feature 15 stores append-only local communication fixture history in Timescale/Postgres.
  Redis has no communication namespace; Convex inbox and Temporal retry ownership are unavailable.
# Mandate-policy fixture history

Migration 030 holds Feature 18's checked-in Test Center mandate/coverage/test/diff/
consent/activation evidence. Its immutable activation chain is a local fixture head,
not product policy state; Redis stores only the normal expiring Test Center lease.

# Customer contestation fixture history

Migration 035 stores append-only synthetic Feature 23 case graphs in Timescale/Postgres.
It has no Convex projection, Temporal deadline worker, Redis case state or customer-data
store. Redis continues to own only expiring Test Center control leases.

# Customer portability fixture history

Migration 036 stores Feature 24 synthetic portability metadata and receipts only; package
bytes, record values, bearer material, URLs, and customer data are prohibited.

# System safety assurance fixture history

Migration 039 stores immutable Feature 27 synthetic corpus result metadata only. It
does not project a safety status to Convex or create Redis truth; Redis remains limited
to the existing expiring Test Center control lease.

# Calibrated selective-prediction fixture history

Migration 049 is append-only local fixture history only. Timescale/Postgres owns these
synthetic receipts; no Convex projection or Redis artifact cache is created, and Redis
continues to own only the expiring Test Center control lease.

# Outcome-calibrated promotion fixture history

Migration 048 reserves append-only local `promotion_*` fixture records only. It does
not contain product configuration state; Redis remains only the expiring control lease.
# Feature 38 local audit history

`analytical_diversity_*` migration records are append-only Timescale fixture history.
Redis may retain only the existing Test Center control lease; it never stores lineage
or changes the frozen result. Convex has no Feature 38 projection.
