# Stage 2 implementation contract and evidence ledger

Status: accepted within recorded-replay/experimental accounting scope, 2026-09-30.
See [final evidence and limitations](stage-02-evidence.md); the dated implementation
notes below retain the discovery and repair history. Prerequisite Q1 accepted in backend
`e19e83d` and mobile `9ea3e54`. This operational brief implements
[Stage 2](stages-01-02.md), not a replacement architecture. Q2 recorded-replay
software passes within [its frozen scope](q2-replay-qualification.md); Q3 experimental
financial-core qualification passes. Operational/native/funded gates remain open.

## Ownership and frozen interfaces

| Owner | Files/subsystems | Responsibility |
| --- | --- | --- |
| Backend Sol | `finance_*.py`, migration 055 | Transactional financial writer, exact arithmetic, reconciliation, reservations, outbox |
| Product Sol | Observation/instrument modules, migration 056, Convex schema/projections | Point-in-time observations and current authenticated product views |
| Independent Sol | Stage 2 tests and disposable PostgreSQL harness | Separate numerical oracles, adversarial replay, concurrency and recovery |
| Astra | API registration, integration, migration application, deployment, Git | Final acceptance and publication |

Each new file stays at or below 300 lines. Shared schema/migration/inventory files
have one writer. No new paid provider/RPC/feed, funded call, background poller, or
change to existing execution safeguards is authorized by this stage brief.

`FinanceScope = {environment, scopeId, strategyAccountId}` keys every financial
object. Live scope uses `scopeId = "live"`; experiments use their frozen experiment
identity. Server-side authentication and ownership resolution construct this scope;
caller JSON cannot turn a simulated account into live authority. Existing
`ControllerRef` identity and saved mode remain attached to trade reservations.

`NativeAmount = {assetUnitId, units, decimals}` uses canonical signed integer strings
and immutable asset registrations. No float money, implicit decimals, symbol-based
asset joins, or unknown-to-zero conversion is permitted. Location and native venue
identity distinguish balances; perpetual contract quantity, multiplier, settlement,
collateral and funding identity are distinct from transferable cash.

Account observations are immutable, hash-addressed records in Timescale, with
account/source identity, instrument/asset versions, raw payload hash, source rights,
event/available/received/cutoff times, sequence or block/hash, finality and quality.
Only admitted final, fresh, gap-free, non-reorg account evidence under an explicit
policy can reconcile capacity. Rejected/stale/missing evidence yields unknown or
quarantined state. Synthetic evidence cannot bootstrap an authoritative live balance.

Proposed financial methods:

- Acquire a fenced writer epoch and lease.
- Apply a deduplicated, balanced journal event; append corrections as reversals.
- Reconcile observed assets/positions and record an immutable checkpoint.
- Reserve an intent or withdrawal against the same account capacity.
- Persist submission start/uncertainty and retain unresolved holds.
- Release/settle only against an admissible proof; read exact withdrawable state.
- Claim and acknowledge durable outbox events for idempotent product projection.

Commands bind expected account revision, epoch, policy version, snapshot hash and
stable idempotency key/request hash. One SQL transaction locks the scoped account,
checks authority/lease/revision, writes postings/reservations/claim, advances its
revision and inserts an outbox event. Concurrent teams and withdrawals use the same
capacity pool. Stop/authority epoch changes serialize with admission; this stage
does not grant native signing authority.

Idempotency compares server-derived semantic content, not a caller's assertion that
its hash is unchanged. Retrying a committed command with stale transport metadata
can return its recorded result; changing economic content under the same key cannot.
Journal transaction posting counts are immutable and checked alongside per-asset
balance at commit, including attempted later appends of a balanced pair.

Outbox delivery is at least once. Logical consumers dedupe on event identity and
revision; no exactly-once network claim. A possibly submitted reservation remains
held past its preparation expiry until authoritative reconciliation resolves it.
Database failure blocks new admission. Redis restart cannot erase financial holds.

## Product projection boundary

Convex receives only the current versioned projection: scope, revision, writer epoch,
payload hash, observation snapshot hash, exact balances/holds/capacity, reconciliation
state/reason and observation time. Identical repeats are idempotent; conflicting
same-revision payloads reject; older revisions cannot overwrite newer state.
Authenticated viewers see only their scope. Financial mutations never trust that
projection or historical floating-point UI balances as spending authority.

`observedAt` is distinct from projection `asOf`: generating a view cannot refresh
old balance evidence. Capacity deficits remain visible after retained holds exceed
a newly observed balance. Signed exact available units are not withdrawal approval.
Authenticated `/v1/finance/snapshot` and `/withdrawable` reads resolve viewer scope
through the existing trusted-server/Convex boundary. They expose no journal writes,
live bootstrap, reservation, signing or submission endpoint. Bounded outbox delivery
publishes stored payloads outside account locks; ambiguous responses leave the event
unacknowledged for a later delivery with unchanged identity and content.
`python -m moeazi_agent.finance_publish --publish --limit 20` publishes one bounded
batch through the configured worker route, then exits. Without `--publish` it only
prints usage. It adds no schedule, polling loop, execution authority or paid retry;
Convex dispatch requires the existing service-cost authorization. Durable scheduling
of this activity belongs to the subsequent lifecycle integration.

Native data starts with existing recorded artifacts or bounded public-response
capture after source/rights/cost review. Existing hand-built routing fixtures and
synthetic Orderly depth must remain labeled synthetic. Native-first is the baseline;
CCXT is optional only if its qualification demonstrates additional value. Pandera,
DuckDB and other research dependencies remain deferred under the master decisions.

## Acceptance protocol fixed before implementation

Q2 requires a dataset manifest and replay of wrong units/decimals, reused venue
symbols, time/look-ahead defects, duplicate conflicts, missing sequences, stale books,
and reorgs. Pin raw response bytes/hashes, instrument versions, timestamps, rights,
expected outcomes and evidence origins. Replay permutations must converge to the
same accepted point-in-time snapshot. Unknown finality cannot be upgraded by a label.

Q3 uses independent hand calculations for spot partial fills, third-asset fees,
perpetual collateral/funding/marks, gas, transfers in transit, and external cash flows.
Example return oracle: opening equity 1000, deposit 100, withdrawal 50, ending equity
1080 implies cashflow-adjusted gain 30. Compare exact native-asset postings as well
as any valuation; valuation itself must cite admitted prices.

The disposable local PostgreSQL harness must exercise real writer transactions:

1. Barriered requests 70/60/50 from two teams plus withdrawal against capacity 100
   never create aggregate holds above 100.
2. Same-key identical retry is stable; changed payload conflicts.
3. Crash after commit/before publication preserves the hold and permits logically
   idempotent outbox recovery.
4. Stale fencing epoch loses authority; Redis loss preserves capacity; database
   outage rejects new admission.
5. Uncertain submission outlives expiry; evidence resolves it before release.
6. Duplicate/reordered fills converge; mismatched observations freeze new risk.

The verifier prepares the harness; the supervisor applies migrations only to the
explicit disposable local database/schema and subsequently the approved development
environment after acceptance. Existing synthetic risk/journal Test Center tables
(migrations 021/022) are not reused as financial authority.

## Evidence and remaining gates

Independent contract checks pass: 18 observation and 18 finance cases. Replay and
recorded-parser checks pass 19 cases after rejecting conflicting sequences, crossed
or unsorted books, invalid precision, unapproved rights and look-ahead data. These
are local checks of current source, not final stage acceptance or a deployed gate.
Financial database qualification is underway. Financial discrepancies, unapproved
policy values, or failed concurrency tests remain visible gates. Passing Stage 2
will not certify strategy performance, protective execution,
native permissions, live mobile releases, or funded safety limits.

Additional local verification: the shared Python/TypeScript projection vector
passes with exact values above JavaScript's safe integer range, Unicode identity,
millisecond timestamps and a retained-hold deficit. Nine independent outbox transport
tests pass, including remote commit followed by response loss, duplicate/stale
receipts, payload corruption and failed local acknowledgment. These use fake
transport/repository boundaries and do not replace the required PostgreSQL/Convex
integration tests. Independent financial oracles cover the specified spot balances,
perpetual marks/funding, transit, cash flows and atomic posting-order invariance.
Five independent financial route tests and seven read-state tests pass against inert
boundaries. These cover authentication, server-resolved ownership, unavailable
storage, stale/missing/invalid policies, signed deficits, exact asset/location joins,
and legitimate reconciled zero capacity. Source has compiled; these routes are not
yet deployed in the running API image.

Preparation evidence: a dedicated empty local PostgreSQL database
`moeazi_q3_20260930` was created by the supervisor, separate from `moeazi`.
Migration 056 was reviewed and applied twice successfully to that empty database;
it contains four observation tables. Applied SHA-256:
`170b978a1103375c05ed08dd79c865f0a779a566fa42e45576336389733c13e0`.
Financial migration 055 was reviewed and applied twice successfully to the same
disposable database. Applied SHA-256:
`e94479d9fb0f31bf789328446983e04d589287214b5f11c25da5c334cbce9b82`.
The actual application database is unchanged. The harness must refuse other database
names/non-loopback DSNs. Actual SQL056 storage tests now pass 2/2: account fixture
roundtrip with +03:00 timestamps and nested position JSONB; market registration,
deduplication, raw-byte reparsing and forged-normalization rejection; evidence
snapshot persistence; direct SQL update/delete rejection; and live fixture denial.
The first run exposed a genuine hash disagreement between replay and DTO timestamp
serialization. Canonical UTC serialization repaired it before the passing rerun.
These tests use generated fault fixtures in a real database; native positive
admission remains separately inconclusive.
Host port 5432 was found to belong to a separate Windows PostgreSQL process; an
initial local test connection failed authentication before executing test SQL.
A temporary `moeazi-q3-db-forwarder` container now binds only `127.0.0.1:15432` to
the Docker database. The supervisor verified the destination database and Docker
server address. This read-only, capability-dropped helper uses the existing API
image and adds no application dependency; remove it when qualification no longer
needs the connection. Keep its overhead out of later production capacity claims.
Four sequential unauthenticated Hyperliquid `/info` reads returned HTTP 200: spot
metadata, perpetual metadata/context, BTC perpetual book and metadata-selected
PURR/USDC spot book. No retries, user queries, subscriptions, credentials, signatures,
gas or provider calls occurred. Raw bytes and capture timestamps/hashes remain in
ignored `.data/q2-capture` for internal qualification only. This establishes native
sample availability, not passing parsers, settlement finality or commercial reuse.
The selected instruments are parser cases, not approved trading allocations.

Protocol references: [native info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
and [rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits).
Bounded book responses do not provide continuous-stream sequence/finality guarantees;
absent fields must remain absent rather than being fabricated by an adapter.
The durable [dataset manifest](q2-dataset-manifest.json) identifies raw content by
hash; raw bytes are retained only in ignored local qualification storage.

### Clock discrepancy

The two recorded books have source event times 754/961 ms ahead of local receipt.
Three additional bounded, unauthenticated BTC book reads at 13:15:49–52 UTC showed
351–642 ms lead; raw bytes, HTTP Date and monotonic round-trip durations are in
ignored `.data/q2-clock-capture`. HTTP Date is coarse and cannot establish a precise
clock correction. Windows Time reported its service inactive; no host clock or
service settings were changed. Default replay quarantines these future-time samples.
Native positive admission remains inconclusive; no arbitrary tolerance or rewritten
timestamp is introduced to turn rejection into a pass. A source-clock policy needs
explicit evidence and point-in-time tests before adoption. This does not block Q3
work in explicitly isolated, synthetic financial portfolios.

At 13:30 UTC, read-only `w32tm /stripchart /computer:time.windows.com` reported
offsets +1.4119560, +1.4100119 and +1.4060312 seconds. The configured source is
`time.windows.com,0x9`; W32Time is stopped with Manual startup. These observations
support a host clock discrepancy; they do not retroactively repair capture times.
System clock resynchronization was presented for user approval because it affects
other applications. Financial implementation continues independently while pending.

### Financial review findings under repair

Stored market evidence now binds spot sizing to the admitted book, exact unit
registrations and reconciled inventory; a valid evidence hash cannot justify a
caller-invented price or zero exposure. Qualification must additionally cover
outstanding buys across all controllers: available cash alone does not enforce a
gross exposure cap. Pending/uncertain sells cannot offset prospective buy exposure.
Market freshness must be rechecked when reserving, after receipt creation.

Proof-backed settlement/release is being added separately. Expiry continues to
retain any possibly submitted hold. A later account snapshot alone cannot identify
an order's outcome; resolution must bind stored execution identity, final evidence,
journal effects and reconciliation. Experiment evidence cannot authorize live funds.
Current spot-only evidence binding and unvalued perpetual-position rejection are
explicit limits, not passing perpetual financial/lifecycle qualification.

### Deployed projection and database invariants

Additive Convex deployment completed on the authorized `outgoing-spider-101`
development instance; it added `currentFinanceProjections.by_scope`. Typecheck and
seven focused TypeScript checks passed. `scripts/qualify-finance-projection.mjs`
then passed 14 deployed checks using the existing synthetic Q1 identities: owner
reads, isolation, authentication, idempotent duplicate, stale rejection, conflicting
revision rejection, corrupt receipt rejection and server-derived scope. Evidence:
`.data/q3-projection-1790777792649.json`. The earlier attempt stopped on the harness
parsing the CLI's empty successful null response; the harness was repaired. These
are fabricated, explicitly unknown display projections, not financial authority.

Three direct PostgreSQL invariant tests passed after SQL055: fractional/nonfinite/
overflow units reject; exact values above 2^53 and up to 78 digits roundtrip; committed
source/journal/posting updates and deletes reject; even a balanced appended pair
cannot extend a committed transaction; empty/unbalanced transactions fail commit.
`test_stage2_finance_postgres_invariants.py` refuses every database except the
dedicated loopback qualification database. Application database migration and Python
image deployment remain pending acceptance.

The real projection bridge also passed using a separate disposable database,
`moeazi_q3_bridge_20260930`, with reviewed migrations 055/056. The opt-in
`scripts/qualify_finance_bridge.py` used the existing synthetic Q1 Bob account,
created stopped/unknown state, published through the actual worker HTTP route, and
discarded the response after Convex committed. PostgreSQL remained unacknowledged.
After expiring only the disposable delivery lease, the same event/hash returned a
duplicate receipt and was acknowledged. An authenticated Convex read matched the
stored payload exactly. Evidence: `.data/q3-bridge-1790778106879276100.json`.
The elapsed metric is monotonic test duration, not a cross-clock latency SLO.

Migration 057 for immutable experiment-resolution proofs was reviewed and applied
twice only to `moeazi_q3_20260930`. SHA-256:
`2bbf435510a878ce6aec55053cc3787fb4a4ec699ae800285327808d2201f660`.
Resolver behavior remains under qualification. Review caught a settlement deadlock:
a filled order can consume cash while its uncertain hold still causes capacity
quarantine. Resolution must atomically validate the matched fill/checkpoint, settle
only that hold, and recheck remaining capacity; it cannot bypass other quarantines.

### Runtime clock and recorded positive replay

Two additional public books were captured inside the running API container, using
its actual unmodified clock. The first spot capture crossed a wall-clock step:
2,984.819 ms wall elapsed versus 625.114 ms monotonic elapsed. It is excluded from
positive qualification. The subsequent BTC capture had consistent elapsed timing
(342.742/342.788 ms), and its native event preceded receipt by 553.742 ms. Independent
recorded replay admitted this exact snapshot without modifying times or finality.
This is bounded sample evidence, not continuous source or clock certification.

One subsequent spot capture had consistent elapsed timing but its source event led
receipt by 1,046 ms; strict replay must quarantine it. Stable elapsed timing alone
does not establish absolute synchronization. All three raw hashes and exclusions
remain in the dataset manifest. No OS clock, service setting or timing tolerance was
changed, and no further source captures are planned without a new justification.
Production clock health and native spot positive admission remain unresolved.

The actual SQL multi-asset arithmetic oracle passed 2/2: two partial spot fills with
third-asset fees and a sale; full correction and duplicate-reversal rejection;
collateral transfer, funding, gas, transit, deposit and withdrawal conservation.
Unrealized perpetual marks are not inserted as spendable cash. These tests qualify
the generic journal writer, not perpetual position reconciliation or native authority.
