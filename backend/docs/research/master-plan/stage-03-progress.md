# Stage 3 detailed implementation evidence

This preserves intermediate checkpoints; none alone establishes Q4 acceptance.
See [the active ledger](implementation-ledger.md) and
[the implementation brief](stage-03-implementation.md) for current priorities.

Stage 3 early progress: strict simulation identity boundary checks pass (6 TS and
8 Python); minimal disabled-by-default isolated worker configuration checks pass
(8 Python). Independent numeric spot/perp oracle self-checks pass 3/3, without
claiming lifecycle acceptance. Root created `moeazi_q4_20260930` with accepted
055/056/057 through the existing loopback qualification proxy. Reviewed SQL058 was
applied twice to that disposable database, not the application database; hash
`21fe46983045e5cf2bda620449acbe0c72852ccf681dfa7daefd5734ddc21160`.
Local Temporal SDK 1.30.0 kernel checks pass 5/5: worker replacement, continue-as-new,
lost activity response and failed/unknown control outcomes. These use synthetic
activity state, not the financial repository, and cannot satisfy Q4. Pending
obligations have a durable at-most-30-second wake timer even if a signal is lost.
Logs: `.data/stage3-temporal-kernel.log`, `.data/q4-migration-058-first.log` and repeat.
Shared lifecycle/manifest/event contracts distinguish historical replay cursor
from wall-clock leases. Actual order/journal/recovery integration remains underway.
Root's configuration, identity, dispatch, activities, workflow result validation
and HTTP boundary tests pass 46/46 (`.data/stage3-root-boundaries.log`). HTTP tests
use fake identity/storage/dispatch and are not deployed evidence. Strict JSON
manifest parsing fixed a real FastAPI boundary issue with timestamps/tuples.
Registration stores identity without a financial writer lease; stop/control uses
the account SQL lock and persists before signaling Temporal. Economic effects
remain with the separately fenced financial worker. Entry eligibility is required
for registration/admission, while owned reads and reductions do not require it.
An idempotent control receipt retains its original revision; only fresh progress
snapshots are checked for revision regression.
Actual SQL/Temporal empty-run integration passes 2/2, recorded in
`.data/stage3-empty-run-integration.log`: registration, idempotent stop under another
worker's active lease, unchanged financial revision/journal, then real Temporal
registered/wake/completed-flat progress. It exercises no fills or exposed positions.
The dedicated worker imports no shared application settings, provider routing,
venue/execution or analyst workflow modules. A separate Compose simulation profile
has an explicit environment allowlist and is disabled by default. Source API wiring
is added, but Stage 3 images/contracts have not been deployed or accepted.
Independent review found the initial worker credential was too broad. It now uses
dedicated `SIMULATION_WORKER_SECRET` through `/simulation-worker`, which accepts
only the read-only identity query; the broad `/worker` rejects that token even if
misconfigured to collide. Ten TypeScript identity/HTTP checks pass; TypeScript
compilation passes. New identity endpoint/secret are not yet deployed.

SQL059/060 were reviewed and applied twice only to Q4, adding immutable intent,
approval/revocation and server-prepared payload lineage. Hashes respectively:
`f7632efe84dfcefd0553b0f445f4e168e41556380edbab9b36c8ebef8c0f8002` and
`f37dda3c511cebd3431456545f201cc55119a5d50536d329ef85920b53f4e80a`.
Root-owned SQL061 was independently reviewed and applied twice to Q4; hash
`361b14d9a011fd03cb5b2948d9793b0299b0722fe8aeb21e0118f0266ff1bdbb`.
It adds a nonlogin simulation writer group, experiment-only restrictive RLS,
limited table grants and SQL outbox row/payload namespace checks. Delivery repeats
the envelope check (13 delivery/adversarial cases pass). The dedicated worker now
rejects superuser/bypass/owner/broad membership, schema creation, reachable privileged
functions, unconfined tables and outbox acknowledgement privilege at startup.
Root provisioned an actual Q4-only simulation login and a synthetic unfunded live
canary row. Independent actual-login checks pass 2/2: live reads/updates are hidden,
live inserts and forged live outbox payloads reject, experiment writes work, and the
baseline administrative role retains its existing visibility. This is a namespace
credential boundary, not cross-experiment authorization proof. Startup guard also
checks column-level grants and requires the restrictive policy to cover every command.
Credentials remain only in ignored local files and must not be printed or committed.
No application-database role migration or Stage 3 service deployment has occurred.

Actual PostgreSQL preparation/approval lineage passes its narrow integration test:
stored intent and sizing/reservation produce a stable server payload; fabricated
payload approval rejects, exact approval is idempotent and revocable. Fresh identity
is timed from request start and must remain within five DB-wall seconds at the
account lock. Delayed authority rejects. Authenticated approve/revoke source routes
derive the actor and scope server-side and persist before supervisor dispatch;
eight route tests use fake identity/storage/Temporal, ten identity tests pass.
Independent pure simulator, strategy, protection and arithmetic tests pass 23/23.
They do not establish SQL fill settlement or crash recovery. Product now owns
SQL062 and a frozen run dataset adapter; backend owns subsequent lifecycle migrations.
Synthetic-fault/local-simulation-only observations remain labeled synthetic and
cannot satisfy native-data or live-execution qualification.

SQL062/063 were applied twice only to Q4 (frozen corpus and nonauthorizing rule queue).
Hashes: `c4a97b9b0e85e42383df88df574ba601da471001a2404b319d1771be2a277045`
and `db8bd8bba530a5a0c02d945bd44e9915ea74b1e62114f5a2d9ed4e633f06d500`.
Root's prepared-order review passes an actual SQL check with both the baseline and
restricted simulation login. It exposes exact stored payloads for approval, binds
owner/run/manifest, paginates, and leaves the financial revision unchanged.
Dataset/entry/approval routes accept stored hashes or versioned rules, never caller
financial holds or raw source records. HTTP tests use fake storage and dispatch.
See [simulation runtime](../../agent-guide/simulation-runtime.md) for the source API
sequence and deployment boundary.

Application-database preflight found 44 Timescale 2.28.2 PUBLIC-readable extension
relations, including job configuration/history. SQL064 removes those ambient reads
without weakening startup checks; it rejects unknown versions or unreviewed consumers.
It was applied twice only to `moeazi_q4_extension_20260930`, with telemetry disabled;
hash `206fdff03b4a0cccfa7139c718b743a869ef2d05867db94b1a12c38e115244a0`.
Simulation-group extension reads fall from 44 to zero; baseline postgres retains
45 extension relations. Independent restricted-login checks pass 2/2. Manual and
actual one-shot scheduled Timescale job checks pass 2/2 under the baseline owner;
the scheduled worker wrote one marker, disabled itself and recorded successful job
statistics. Manual invocation did not populate the same counters, so it is labeled
invocation-only. Job/procedure/table fixtures were removed by their test cleanup.
No application-database privilege change has occurred.

The actual `simulation_worker` OS-process crash/restart check passes in 51.36 seconds
(`.data/stage3-process-restart.log`). It uses the restricted Q4 login, a minimal
environment, real local Temporal, and the same workflow run/history. SQL stop is
persisted while the process is dead; the replacement waits for the real writer
lease to expire. No clock patch/forced takeover or idle product-identity calls occur.
This is an empty-account test, not partial-exposure recovery. Both owned processes
are stopped afterward; the reusable harness is `tests/stage3_process_harness.py`
inside `agent-service`. Backend is now connecting immutable source events to one
atomic financial-journal/position fold and introducing a persisted replay cursor;
later decisions must use current reconciled finance and prefix-bound market evidence.
The local ASGI-to-PostgreSQL review/approve/retry/revoke journey also passes: exactly
one approval and revocation persist, the foreign owner is rejected, and no order is
created when the deliberately unavailable Temporal fixture cannot dispatch. This
proves HTTP/SQL integration with fixture authentication, not deployed Convex identity.

Simulation authority now uses an additive account control revision instead of the
heartbeat/display timestamp. Status or emergency-stop changes increment the revision;
heartbeat updates do not. Legacy absence starts at zero, but invalid persisted values
(including null) reject. The independent handler test includes stop/resume at the same
wall timestamp so an old run cannot regain authority through an ABA transition.
Approval revocation invalidates every existing receipt for the same prepared intent
and payload, closing an older-receipt fallback. A subsequent explicit approval may
reauthorize; replaying the old revocation does not revoke that new action. Independent
actual SQL multi-receipt qualification passes, as do three control-revision tests.

SQL065 was reviewed and applied twice only to disposable Q4; frozen hash
`21ffeeccd03baa1e2b9444a0e4c45395294c5024e342a9c2d3bba9ccc63bd8a7`.
Its first attempt rolled back on two old schema-test rows with deliberately minimal
manifests and no cursor. Those exact inert rows were archived in ignored local
evidence and removed; no application rows or real run identities were changed.
The schema test now rolls back its fixture. Migration does not invent a missing
cursor. The decision-store smoke passes against actual SQL: current scoped account,
stored accepted evidence, prefix-bound decision and exact duplicate identity.
The connected restricted-login registration/dataset/decision/queue test passes for
all three customer modes (3/3). It caught unnecessary `FOR SHARE` reads on immutable
dataset headers, which required an intentionally absent UPDATE grant. Removing the
header locks preserved the parent run lock and existing narrow grants. Duplicate
requests remain one decision/one queued request, with no order, reservation or
financial revision change; foreign owners and new requests after stop reject.
This verifies a nonauthorizing integration path, not mode-specific fill behavior.
Independent decision-store adversaries and full atomic settlement remain pending.
The independent pure event-to-journal mapper matches exact asset/book postings for
the spot third-asset-fee and full perpetual funding/closure oracles (2/2). This is
not SQL settlement evidence. Current next task: enforce global cross-order event
chronology in materialization/folding, then verify atomic rollback, duplicate
delivery, partial-exposure process restart, checkpoint reconciliation and protection.
Processing every due event from one order ahead of earlier events from another
order is explicitly rejected as an acceptable implementation.

Global source materialization/folding now processes all due events in cursor,
order ordinal and sequence order. Independent actual SQL verifies source-prefix
reconnection, rollback after the journal write before position write, exactly-once
retry and duplicate delivery. A partial fill retains the full submitted hold and
marks finance unknown; settlement, reconciliation and protection remain unfinished.
Independent decision-store adversaries pass 2/2 for later evidence, duplicate
identity, future cutoff, unknown finance and foreign account snapshot rejection.

Root SQL066 (entry progress plus command-to-request claims) was applied twice only
to disposable Q4; hash
`6e21f6527b0f9a76f173a23b3af96f71a7b6f0be035ca2444d2760e34b1e547c`.
Independent source review found no schema blocker. Root's restricted SQL processor
tests pass 3/3: retries never switch requests, including an idle command after new
work arrives; Hold completes without financial calls; triggered evaluation is
frozen once; stop between evaluation and checkpoint prevents financial dispatch.
The financial callback is deliberately unavailable in these tests. No simulated
trade is claimed from those results. The replay-specific financial admission,
derived observation/reconciliation, protection and full recovery path are next.
Backend owns proposed SQL067 and explicit `simulation_derived` provenance; it must
reconstruct expected economics from initial observations and ordered source facts,
not copy the current journal and treat self-comparison as independent evidence.

The exact installed Nautilus Windows 1.231.0 build has precision 9, high precision
disabled. Product's offline simple fill/fee probes agree, but L1 residual fills
exceed displayed depth under tested settings. Its L2 resting GTC limit order matched
a partial 0.3-of-0.7 fill, fee 0.03 and cancellation of the remaining 0.4. The earlier
market remainder was not resting/cancellable under that model; it is not evidence
of a general engine cancellation defect. No general precision/depth or live parity
is claimed. Root owns Temporal,
simulation authority and configuration, backend owns lifecycle SQL/finance, product
owns simulator/engine harness, verifier owns independent scenarios and fault tests.

Native account observations, real perpetual position valuation, partial/cumulative
settlement, live permissions, funded tests, strategy performance and all three final
cycles remain outstanding. Experimental proof recovery cannot satisfy those gates.

### Persistent Temporal failure recovery

Root found that workflow rollover counted only successful advances, allowing a
persistent activity failure to grow history indefinitely. Rollover now counts
attempted cycles and retains the same command sequence, persisted progress and
pending controls. The actual local Temporal test observed rollover after at least
128 failed advances, the same `advance:0` identity throughout the outage, and a
retained stop request; clearing the synthetic outage completed the workflow.
Existing Temporal/kernel contract checks passed 19/19. The new fault test initially
failed an overly strict sequence assertion: recovery can occur between an uncertain
control and its successful protection-only advance. Corrected to count successful
advances, the test passed 1/1 in 19.60 seconds. This is workflow-kernel evidence with
synthetic activities, not evidence of financial or partial-position recovery.

The entry processor also accepts an exact-request terminal financial rejection
with a required bounded reason. This permits stale immutable evaluations to leave
the queue without silent reevaluation. The financial owner must resolve any earlier
reservation before returning rejection; that actual financial behavior is not yet
qualified. Restricted SQL processor tests pass 7/7: original retry/Hold/stop cases,
terminal rejection retaining retry identity while allowing the next request, and
wrong-request/missing-reason/oversize-reason responses leaving the request queued.
Those tests deliberately use a synthetic financial callback, never a funding or
live-execution substitute.

### Durable cancellation and checkpoint integration

Root added `lifecycle_cancel_receipts`, `lifecycle_control_processing` and
`lifecycle_control_proofs`. A cancellation dispatch pins its exact command, permit,
requested replay cursor and effective cursor. Repeated commands share one dispatch;
resolution is an additional immutable receipt. Processing performs no financial
settlement. It checks the due source prefix before dispatch, so an unprocessed
full fill or pre-existing source cancellation prevents a new cancellation timeline.
The full-fill guard initially compared numeric database text to canonical unit
strings; its new actual SQL test caught the mismatch. Exact native-integer
comparison fixed it. Independent review also caught a close-proof query that missed
reserved but unprepared intents; it now joins intents directly to reservations.
Full close-proof acceptance still requires the real financial close lifecycle.

Product added a distinct cancellation source stream, immutable-prefix validation,
and static terminal precedence. Source prefix ordering initially used numeric
sequence across streams; it now orders by replay cursor before sequence. Root's
restricted SQL suite passes 4/4 in 7.15 seconds, including the two-cursor boundary:
persist/fold the early cancellation request, advance the injected replay clock, then
fold accepted/fill/residual cancellation exactly once. Full and partial fills both
retain submitted capacity; processing does not mark the control financially resolved.
These are real SQL source/fold checks with a test-driven replay clock, not a full
worker crash or settled-cancellation qualification.

SQL068 one-cancellation-per-order index applied twice only to disposable Q4 at
`92d7a7888b745c6744b534d7c0a14796efc7d92004eff23d47e9c276a73e0cba`.
Backend SQL069 replay cursor claims applied twice there at
`0222afb5042f7b71900d2cfb6d5531d8c69a88071e3dab173acb5b6968aef879`.
Before application, root required structural scenario bounds and binding to the
current scoped account snapshot; these checks do not prove the source root.

Backend's derived-checkpoint path now independently reconstructs baseline plus the
exact frozen simulator source prefix, compares financial books, journal links and
rational position state, and writes an explicitly simulation-derived snapshot.
Independent tests rejected derived-snapshot ancestry, pre-baseline facts, missing
folds, and ledger/position tampering. Reservation settlement, replay-specific
admission, protection/closure and full worker recovery remain mandatory Q4 work.

### Actual partial-position process restart and portfolio review

Root added `/v1/simulation/runs/portfolio`, reading one repeatable, read-only SQL
snapshot. The actual restricted SQL/ASGI test passes 1/1: 500,000 native units of
partial exposure, retained capacity, explicit unknown/awaiting-checkpoint state,
historical clock/provenance, owner isolation, pagination and unchanged financial
revision. Authentication is a local bridge fixture; no deployed endpoint is claimed.

The new actual OS-process partial restart initially failed in 84.90 seconds.
Exposure and capacity survived, but a new financial checkpoint did not increment
the run projection. Temporal correctly rejected `next_action=advance` with unchanged
run progress and kept retrying its immutable receipt. Backend fixed the checkpoint
transaction to increment the run projection whenever reconciliation commits.
The same diagnostic then passed 1/1 in 41.94 seconds: actual worker PID replacement,
real dead-writer lease expiry, same Temporal run, cancellation recovery, exactly one
fill/journal and 500,000 units of retained exposure, submitted hold, pending
obligations, stop preserved, and zero identity polling. It does not qualify hold
settlement, confirmed protection, protective close, or the complete Q4 gate.

The older empty-run fixture also failed newly enforced opening-observation timing.
Its fixed replay date was replaced with a cursor after its admitted opening snapshot,
and unrelated scheduled events were removed from that empty scenario. Actual SQL
and Temporal empty-run checks pass 2/2. No runtime validation was weakened.
Backend owns forthcoming SQL070 and durable phase selection before side effects;
the actual restart pass does not establish atomicity at every internal phase gap.

Further work and replacement SQL070 evidence continue in
[the financial admission and command recovery record](stage-03-progress-02.md).
