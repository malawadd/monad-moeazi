# Continuous implementation ledger

Authoritative design: [master blueprint](README.md). Kickoff: 2026-09-30.

## Objective and operating decisions

Implement stages 1–8, qualify Q1–Q12 including required native/funded operations,
then obtain three consecutive passing full validation cycles. This is an active
continuous goal, not a claim that the architecture is already implemented.

- Initial Stage 1–3 supervisor configuration was `gpt-6-astra`, reasoning `high`;
  initial backend/product/verifier agents were `gpt-6-sol`, reasoning `high`.
- From Stage 4 the requested lower-cost pattern is one active implementer at a
  time, explicitly `gpt-6-luna` with `xhigh` reasoning, and a separately invoked
  Luna XHigh verifier at stable integration checkpoints. The user requested a
  Sol Medium supervisor; this task's model selection is controlled by the app,
  so the code ledger does not claim it changed. Sol intervention is reserved for
  genuinely difficult blockers. No credentials are sent to workers.
- Freeze one main journey for each milestone. Fix blockers to that journey and
  credible funds, authority, or accounting defects; record peripheral cases for
  later. After two bounded failed repair rounds, escalate the specific blocker
  rather than expanding scope without limit.
- Each worker brief must name one user-visible journey, an observable pass condition,
  owned files, and explicit exclusions. A verifier reports only journey blockers or
  credible funds, authority, accounting, and cross-account defects. The supervisor
  either accepts the slice, assigns one bounded repair, or records the failed gate;
  a new test finding does not automatically expand the slice.
- Stage progress and gate certification are separate. A narrow working slice can be
  published with its remaining Q-gates named, but later activation cannot assume
  those gates passed. Keep one active implementer and invoke verification only at a
  stable checkpoint to control model usage.
- Only the supervisor applies shared migrations, deploys, commits and pushes.
- Accepted stages are published to their designated main branch. Never force push.
- Commit subjects stay short with two emojis. Detailed evidence belongs here.
- User confirms GitHub mirroring is disabled; do not enable or dispatch it.
- Convex development deployment `dev:outgoing-spider-101` is the target. The user
  explicitly preapproved all Convex operations, and the replacement AGENTS.md no
  longer contains the earlier cost-authorization paragraph. Preserve product state
  and isolate test records. Funded venue/provider checks retain their separate gates.
- OpenRouter application testing is authorized up to $1 total: early smoke <=$0.15,
  later valid-key tests <=$0.65, $0.20 headroom. No automatic paid retries or other
  provider fallback. Key expires within the user-stated one-day window; never store
  it in this ledger, source, traces or agent assignments.
- Funded venue qualification still requires a specific account, scope, cost/loss
  envelope and approval. Lack of these never converts fixtures into live evidence.
- No removal of current interfaces; no disconnected console backend; OSS-only new
  components; preserve existing wallets, providers and store ownership.

## Baseline

Baseline TypeScript tests passed (245/245); typecheck passed; focused Python baseline
passed (12/12). Details are in [Stage 1 evidence](stage-01-evidence.md). The
blueprint and kickoff ledger were published before implementation began.

## Stage status

| Stage | State | Gate | Evidence / remaining work |
| --- | --- | --- | --- |
| 1 Ownership/contracts | Accepted and pushed | Q1 pass (identity/authority scope) | Backend `e19e83d`, mobile `9ea3e54`; deployed 34 checks; 270 TS and 798 Python passed |
| 2 Observations/accounting | Accepted and pushed | Q2 recorded-replay pass; Q3 experimental core pass | `f921dfe`; independent 120/120 plus added negative/Redis checks; Python892/TS277/build; local DB/API and Redis checks passed |
| 3 Trading lifecycle | Foundation checkpoint pushed | Q4 partial; original full gate not passed | `68871e6`; [release checkpoint](stage-03-release.md); 307 Python/290 TS, typecheck/build; normal-worker spot close passes |
| 4 Connected console | Backend comparison checkpoint; console journey open | Q5 partial, not passed | [Stage 4 progress](stage-04-progress.md); two owned replay outcomes verified, but managed-program A/B and console runtime remain unverified |
| 5 Quant/agent research | Early grounding preparation | Q6–Q9 not run | [Citation provenance checkpoint](stage-05-progress.md); still requires trustworthy experiments |
| 6 Native qualification | Pending | Q10 not run | Required authority/cost/funded evidence still outstanding |
| 7 Mobile releases | Pending | Q11 not run | Requires qualified program and execution |
| 8 Capacity/recovery | Pending | Q12 not run | Requires complete shared system |
| Final cycles 1–3 | Pending | None run | Require all preceding mandatory gates |

Stage 4's latest local checkpoint adds an authenticated backend `runs/prepare`
route and console form. The route takes an owned experiment, ordered stored native
observations, a rule and explicit economics; it derives the causal-v2 model,
rule, dataset, evidence, scenario and manifest identities from current backend
state. The console uses its response for the existing register/dataset/entry path.
An independent review caught the legacy v1 future-outcome admission defect before
acceptance; preparation now excludes v1. The focused Python suite passed 21 tests,
and console/root typechecks and console build passed. The independent verifier
accepted the repaired preparation checkpoint. This paragraph records that earlier
checkpoint; the later owned SQL/Temporal outcomes and remaining gates appear below.
Q5 remains unpassed and no Stage 4 commit or push has occurred. See
[Stage 4 progress](stage-04-progress.md).

## Dispatch and continuity

Stage 2 runtime source is frozen and deployed. Backend owns financial contracts,
policy, transactional writer and migration 055. Product owns observations,
migrations 056/057 and Convex projections. Verifier owns independent Stage 2 tests
and the disposable database harness. Shared schemas, migrations and inventories
have one writer. Stage 2 was pushed as `f921dfe1db775271ef11e520883abf8c7093fc68`.
Stage 3 ownership is frozen in its implementation brief: backend lifecycle contracts,
financial/order state and SQL; product simulator/replay adapter and engine comparison;
verifier independent scenarios/tests; root Temporal/API/Convex integration and release.

At every checkpoint record exact commands/results, deployed/committed revisions,
unresolved findings and the next bounded task. Resume from this ledger after context
changes; do not restart architecture discovery or silently reduce completion scope.

## Current blockers and next action

**Current instruction:** Stage 3's [foundation checkpoint](stage-03-release.md) is
pushed. The user resumed work with a leaner Luna XHigh worker pattern and asked to
move through the remaining stages without another Stage 3-style edge-case expansion.
Stage 4's [first delivery journey](stage-04-delivery-slice.md) is frozen. It connects
real Convex experiment identity and the existing Python simulation lifecycle to a
separate local operator console. Required unfinished Q4 items remain named gates,
not a full pass. The entries below preserve earlier stage history.

Current Stage 4 integration and remaining main-path gates are recorded in the
[Stage 4 progress checkpoint](stage-04-progress.md).

Stage 4 work in this checkout now includes a separate loopback Next/React console,
strict root-app operator APIs, account-scoped Convex spec listing, and backend-owned
run lineage for A/B dataset comparison. Independent review identified and the root
repaired same-spec A/B scope sharing and cross-port same-site mutation requests.
Focused evidence: Convex ownership/origin tests 10/10, simulation route tests 4/4,
console typecheck/build passed, and stored-run lineage passed on the disposable Q4
SQL database with a writer-capable local test login (1/1). A prior attempt with the
dedicated simulation worker's restricted login failed at observation fixture setup,
as expected from its database role; that attempt did not test the lineage method.

The console is not yet a Q5 pass. An authenticated experiment-account bootstrap
endpoint now opens a clean isolated account from an internal replay fixture and
returns its revision to the run-registration form. The focused route suite passed
7/7; a separate actual-SQL bootstrap-and-retry check passed 1/1 against disposable
Q4 PostgreSQL, confirming one opening journal transaction and revision 2. The
independent verifier checked the revision handoff and found no remaining blocker
in that repair. Console typecheck/build, root typecheck/build, and 292 TypeScript tests
pass. Recorded observation ingestion, dedicated simulation worker configuration,
actual connected A/B run/cancel/restart, outcome metrics, and budget settlement
remain open. The separate console's local launch was rejected by automatic
approval review (`blocked by policy`, no more specific reason), so runtime UI
behavior remains unverified. No Convex deployment or Stage 4 push occurred.

The next bounded addition is an authenticated, read-only catalog of already
admitted native market observations. It exposes only hashes, instrument identity,
source rights and times for an owned experiment; the console can copy its ordered
hashes into the existing dataset registration. It does not capture or ingest new
market data. A disposable Q4 PostgreSQL check exposed an asyncpg ambiguous
parameter in the initial optional-instrument query; explicit text binding repaired
it, and all 4 catalog tests including the real SQL read then passed. The focused
combined route suite passed 10 with 2 intentional SQL opt-in skips; the two SQL
checks were run separately with a guarded disposable DSN. Console build and both
TypeScript typechecks passed after the catalog bridge. Authenticated UI behavior
and an advanced run remain open. An in-container read-only query of the running
local application Timescale database found zero `observation_market_events` rows,
so the catalog has no data to offer there yet. An attempted connection through
host port 5432 using the separate `.env.agents` DSN failed authentication and did
not establish data availability; the in-container count is authoritative. Next:
capture a small native spot corpus into the application observation owner while
retaining rejected samples and original timestamps. This is an internal replay
prerequisite, not live data-rights or strategy-performance qualification.
The four existing ignored environment files do not currently contain a nonempty
`PROGRAM_RESEARCH_SUBJECTS` entry. Until an actual signed-in operator subject is
allowlisted locally, the authenticated console walkthrough must return 403;
source-level authorization tests do not replace that configuration.
An opt-in public Hyperliquid spot capture CLI was added with a dry-run default,
fixed Info endpoint, at most ten snapshots, one-second spacing, raw request and
response sidecars in ignored `.data`, and environment-only local DB credentials.
Offline tests passed 4/4. A first real capture used display `UBTC/USDC`, which the
native spot metadata does not name; no book request followed. The metadata resolved
UBTC/USDC to native `@142`. A second capture made one metadata and three book
requests for `@142`. All three raw books were retained but replay rejected them
as `event_after_cutoff`: venue event time exceeded recorded local receipt by
0.873, 0.645 and 0.936 seconds. No database ingest occurred. The Windows Time
service is stopped, and the earlier system-clock-resync approval remains pending.
Do not alter raw event/receipt times or relax admission to make this capture green.
The independent Luna XHigh verifier found no code-level blocker in the capture
CLI and confirmed the rejection is the correct provenance-preserving result.
Combined local capture/bootstrap/catalog/simulation route checks passed 14 with
two intentional guarded-SQL skips; the separate disposable SQL bootstrap and
catalog cases passed when explicitly opted in. The capture CLI has not ingested
anything into the application database.
The existing web development process on port 3002 currently returns HTTP 500 for
the operator specs route, with a Next.js missing chunk (`./2794.js`) from `.next`.
This appeared after a production build ran alongside the long-lived dev server;
the production build itself passed. The already-running process needs a clean
restart before HTTP qualification. The backend health endpoint on port 8100 returns
200 from the rebuilt catalog/bootstrap image. The next connected attempt
needs a clock correction authorized for this Windows host, a nonempty operator
allowlist for the signed-in subject, an approved Convex development deployment,
and a clean frontend/console restart. After those prerequisites, capture admitted
spot data, register two owned experiments and execute the frozen A/B journey.

The Stage 4 API image built locally with `docker compose -f docker-compose.agents.yml
build api` (exit 0). After the catalog addition, the API image was rebuilt and
only the local `api` container recreated with `--no-deps` (exit 0); its health
route returned 200 with live execution false, Manual Guard on and Lite Mode on.
An unauthenticated catalog POST returned 401 from the running code. This does not
prove authenticated ownership or stored-data retrieval through HTTP. The existing dedicated
simulation-worker overlay was inspected and needs no source change; the
[runtime guide](../../agent-guide/simulation-runtime.md) now records a worker-only
local advancement check and its exact credential prerequisites. This guide is
operational preparation, not run-advancement evidence.

Stage 1 remains accepted: backend `e19e83d`, mobile `9ea3e54`. See
[Stage 1 evidence](stage-01-evidence.md). Stage 2 implementation and independent
qualification are recorded in [its evidence report](stage-02-evidence.md),
[independent review](stage-02-independent-verification.md), and
[implementation history](stage-02-implementation.md).

Final Stage 2 regressions: 277 TypeScript passed; 892 Python passed, 33 skipped;
independent guarded Stage 2 database/corpus run passed 120/120 with zero skips;
production build/typecheck and sink inventories passed. A first Python invocation
used the wrong working directory; the corrected full run passed without source
changes. Migrations 055/056/057 applied to the local application database with empty
new financial tables. Rebuilt API/gateway/Test Center run tested code; six deployed
financial-read checks and 27 source hash comparisons passed. Analysis/evaluation
workers remain stopped, Manual Guard/Lite on, live execution and mainnet setup off.

The real SQL-to-HTTP-worker-to-Convex bridge passed response-loss/duplicate recovery
and authenticated exact readback in a separate disposable database. The latest
single publication took 0.234 seconds HTTP round trip and 0.250 seconds from confirmed
local commit to acknowledgement. No sustained latency or capacity SLO is claimed.
The controlled local Redis restart passed: Redis process identity changed, the
experimental Postgres hold of 70 against 100 persisted unchanged, and reserving
another 40 failed. Supervisor accepts the recorded-replay/experimental accounting
scope. Stage 2 is committed and pushed normally as `f921dfe`. Next: freeze Stage 3
lifecycle types, implement the same backend's simulator/financial path and isolated
Temporal supervisor, then qualify Q4. Operational/native/funded qualification remains
unavailable.

Early OpenRouter compatibility passed. The existing probe did not retain its output
or usage. Read-only key billing reconciliation returned $0.00000972 cumulative usage
and $0.99999028 remaining; the early reservation is settled. Expiry is 2026-10-01
11:41 UTC. Later tests remain capped at $0.65 with $0.20 headroom; preserve their
sanitized responses before dispatch. No replay payload exists from the first probe.
Live qualification and strategy evidence remain future required work. Q2 recorded
replay includes one admitted, unmodified native BTC snapshot; future-time samples
and a clock-step capture remain excluded. This does not qualify continuous clock
health or native live ingestion. Read-only NTP diagnostics found the PC about 1.4
seconds slow. Approval is pending for system-wide Windows time resynchronization;
no clock settings changed. Never edit raw times or weaken future-data rejection.
The user's latest "done" answered the earlier provider browser-dialog request,
not the later system-clock question.

## Stage 3 active checkpoint

Detailed chronological evidence, migration hashes and limitations are preserved in
[Stage 3 progress](stage-03-progress.md); independent acceptance remains in
[the verification report](stage-03-independent-verification.md). Q4 is not passed.

The restricted SQL path now registers runs, freezes datasets, records current
decisions and queues all three modes. Entry processing persists immutable evaluation
and command-to-request identity; hold, retries and stop races pass actual SQL tests.
The financial owner is deliberately gated in those processor tests.

Global source-event folding passes independent rollback/duplicate and partial-fill
checks. Partial fills retain their hold and leave finance unknown. The next work is
source-derived reconciliation, replay financial admission, protection, closure and
partial-position worker crash recovery. Root's latest connected SQL checks pass 6/6;
these are not full lifecycle acceptance.

Migrations 058–067 are applied only to disposable qualification databases; SQL064
extension checks have their own isolated database. SQL067 adds explicit
`simulation_derived` provenance and was applied twice to disposable Q4 at hash
`83b8b8d3e03a4098e1e3cea4ac7fb7f101147b4aa93da65b6b750983f4fc2f18`.
It permits multiple checkpoints at one replay timestamp; identity comes from content.

Backend owns derived checkpoints/reconciliation, replay admission and subsequent SQL;
product owns simulator, global source chronology and preparation/submission;
root owns entry processor/progress (SQL066), Temporal/API/Convex and integration;
verifier owns independent acceptance. No Stage 3 application deployment or push
has occurred. Stages 4–8 and all three final validation cycles remain pending.

Root additionally fixed unbounded Temporal history during persistent activity
failure. Actual local Temporal rollover/recovery preserved the pending stop and
original economic command (new fault test 1/1; existing kernel/contracts 19/19).
Activities are synthetic in this test; full partial-position recovery is still open.
The processor's restricted SQL suite now passes 7/7, including terminal financial
rejection and malformed outcome identity/reason checks. Actual replay admission
and reservation disposition still belong to backend's pending financial owner.

Latest root cancellation SQL suite passes 4/4: one durable dispatch per order,
two-cursor source-prefix recovery, partial/full-fill races, exact duplicate fold,
and retention of submitted capacity. SQL068/069 were applied twice only to disposable
Q4 (hashes in the progress report). Backend's derived-checkpoint writer is now
available; independent provenance/tamper checks pass within the recorded single-run
scope. Next: server-owned cursor advancement and replay financial admission,
reservation settlement, protective close and actual partial-position restart.

Actual partial-position OS-process restart now passes 1/1 in 41.94 seconds after
fixing a checkpoint/run-projection progress defect found by its first failed run.
Exposure, capacity, stop and exactly-once source economics survived restart; parent
cancellation recovered, but hold settlement and protective closure are still pending.
Actual SQL/Temporal empty-run checks pass 2/2 after fixing the fixture's opening
timestamp. A read-only portfolio SQL/ASGI view also passes 1/1. Backend next owns
SQL070 durable phase selection and transactional replay admission; product owns its
pure sizing receipt/calculations; root owns API/runtime and process integration;
verifier continues independent acceptance. No Stage 3 deployment/push occurred.

The broader Stage 3 checkpoint passed 205 tests, 2 skipped. Independent review found
and verified repairs to terminal control identity checks (7/7). Counter-based phase
recovery was rejected before application; root now owns exact command/phase receipts
and dispatch. Replacement SQL070 was reviewed and applied twice only to disposable
Q4. Receipt, response-loss and no-op recovery checks pass in their stated scope;
full entry/settlement/protection recovery remains open. See
[the continuation record](stage-03-progress-02.md) for hashes and evidence.
The integrated phase implementation also passes the actual partial OS-process
restart and root recovery/rollback suite (4/4, 47.80s). Independent fold/checkpoint
receipt rollback checks pass 2/2. Financial admission/settlement remains the next
critical path; no application migration, deployment or stage publication occurred.

Spot replay admission is now connected through the real financial owner and
simulated submission, with source-filled intended protection. Reviewed SQL071 was
applied twice only to disposable Q4; independent origin/immutability tests pass2/2.
Root's actual deadline/admission/processor suite passes9/9. Protection deadlines can
advance replay without manufacturing market evidence, but reduction dispatch and
flat closure remain open. Backend next owns SQL072 reservation settlement; root
owns protection supervisor and later SQL073 resolution. Perpetual increase also
needs an explicit versioned protection policy; current defaults are not relaxed.

SQL072 is applied twice only to disposable Q4. Genuine partial-cancel settlement,
zero-fill release and rollback pass their bounded SQL checks. Root wired settlement
into public advance; lost-response recovery plus phase regressions pass 4/4 (10.18s).
Independent deadline no-op/race checks pass 3/3; worker role drift checks pass 11/11.
Future-price preflight was found to leak outcomes into present admission: causal v2
is a required Q4 repair, preserving v1 history and separating order lifetime from
dispatch authority. Funding budgets, actual protective closure and full lifecycle
qualification remain open. SQL073 flat-resolution was independently reviewed and
applied twice only to disposable Q4; its phase is integrated, with 2/2 actual
negative/no-op tests and 11/11 role checks. Positive closure remains unqualified.
Backend drafts SQL074 exact reduction maintenance; product repairs causal shared
depth and fee-budget accounting. No Stage 3 deployment, acceptance or push occurred.

Independent review reproduced a projection-only false-flat SQL073 bypass after a
real reconciled fill. Root's supplemental SQL075 immutable-fill guard was reviewed
and applied twice to disposable Q4; the exact exploit now fails safely (1/1).
SQL074 was subsequently reviewed and applied twice only to disposable Q4; SQL076
will track separate close attempts so a rejected exit does not erase history or
permanently prohibit a subsequent authorized reduction. Complete causal spot and
perpetual/maintenance qualification remain the critical path.

Product's actual restricted v2 spot public flow now passes 1/1: queued strategy to
exact envelope-bound reservation/submission, source fold, checkpoint and settlement.
Independent causal admission/depth/sell-fee oracles pass 3/3 and malformed future
corpus registration denial passes1/1. Perpetual funding and protective closure are
still gated; these checks do not establish a profitable or production-ready program.

SQL074 final hash is recorded in the continuation report. Root's actual owner-actor,
control recovery and SQL/HTTP checks pass6/6 (14.52s); independent causal/data/flatness/
role checks pass22/22 at their stated scope. SQL076 draft and dedicated maintenance
writer remain in progress. Typed maintenance may use an explicitly stopped account
only to reduce current exposure, with clean reconciliation and a fresh bound
authority epoch; an entry stop does not grant broader trading authority.

SQL076 was reviewed and applied twice only to disposable Q4. Its exact hash,
maintenance ownership boundaries and remaining qualification gates are recorded
in [the third Stage 3 progress record](stage-03-progress-03.md). Actual complete
protective closure remains unqualified; no Stage 3 acceptance or publication.

## Final Stage 3 foundation checkpoint

The user's scope freeze supersedes the expanding work above. Main source-backed
spot close passes through direct and normal-worker dispatch, including exact
same-command retry. Independent final regression: 307 passed, 17 skipped. TypeScript
290 passed; typecheck and build passed. Convex dev is deployed, local API/gateway/Test
Center images rebuilt, SQL058–079 applied after backup, and API/gateway health passed.
The simulation worker remains opt-in/unconfigured; full Q4 is explicitly incomplete.
Remaining perpetual/funding/recovery/native/final-cycle requirements are recorded
in the release note. No new edge-case implementation is part of this checkpoint.

The Stage 3 implementation was published and verified. The continuous goal remains
active; this is not full Q4 completion.

## Stage 4–6 continuation checkpoint

The current staffing instruction supersedes the original Astra/Sol line in the
goal text: use one bounded Luna XHigh implementer, then an independent Luna
XHigh verifier at a stable checkpoint; root integrates only main-path repairs.
Do not expand a stage into unbounded edge-case work. Required live gates still
remain required and must be labeled honestly until qualified.

Stage 4's connected console, backend experiment contracts, read-only outcomes,
and causal-v2 run preparation are in the dirty worktree. Their focused tests
and independent preparation review passed, but Q5 still needs a real owned
Convex/SQL/Temporal two-variant walkthrough. The root web `/agents` route now
returns HTTP 200 after local dev restart. The current Convex dev contract is
deployed. Native book observations remain unadmitted;
read-only `w32tm /query /status` found the Windows time service stopped, and
no time resync was performed. The separate console launch remains blocked by
automatic approval review. See [Stage 4 progress](stage-04-progress.md).
The local dedicated simulation login has only experiment-writer membership, and
its runtime database-role guard passed over the Compose service network. The
dedicated secret and one signed-in operator allowlist are configured in Convex
dev and ignored `.env.agents`; the identity route denies an unowned experiment.
The isolated worker built, started, and remained running after three orphaned
disposable-Q4 Temporal workflows were terminated with history retained. It has
not advanced an owned run. See [Stage 4 progress](stage-04-progress.md). Q5 is
unchanged.
One non-executable customer-team experiment spec for the signed-in account now
survives a duplicate Convex freeze and resolves through the dedicated HTTP
identity route. An experiment-only readiness repair was independently accepted
and deployed: the real `ready`, non-stopped account is eligible, while live
authority stays false. This CLI-backed ownership check is not the console run.

Stage 5 has only the cited-evidence grounding slice in the worktree; Q6–Q9
remain open. Stage 6 gained a bounded Hyperliquid read-only account snapshot:
spot balances, default-dex perpetual state, and open orders for one exact
account address. Mocked tests passed 3/3 and independent Luna XHigh review
accepted the isolated reader. The local gateway image rebuilt and `/health`
returned `ok` with Hyperliquid live submission disabled. The reviewer found
the older workflow still passes an internal account ID to reconciliation and
can label an uncertain submission `executed`; Q10 remains open. See
[Stage 6 progress](stage-06-progress.md). No Stage 4–6 commit, push, Convex
deployment, funded test, or customer activation occurred at this checkpoint.
Next bounded implementation task: resolve the owned Hyperliquid venue address
from product/account linkage before the gateway call and keep the proposal
pending or uncertain until fill-confirmed reconciliation proves its outcome.
This must not be treated as live qualification by itself.

A bounded truthful-status repair now maps a gated gateway `simulated` response
to the proposal's existing `simulated` state, and leaves native outcomes
`executing` after a partial account read. The portal timeline displays
`executing` as in progress. Independent Luna XHigh review accepted the slice:
focused workflow 5/5, proposal authorization 5/5, and TypeScript typecheck
passed. Q10 still needs venue address linkage, fill-confirmed terminal state,
and durable dispatch/retry identity; an already-`executing` proposal can still
reach dispatch after the original Temporal workflow closes. No deployment,
commit, push, or live authority expansion occurred.
Root's post-review focused Python 3.12 run passed 11/11, TypeScript typecheck
passed, and the worker image rebuilt locally without starting the worker.

The next Stage 6 guard now accepts only `approved` for normal customer
dispatch and its Python activity; a completed Temporal workflow cannot blindly
resubmit a proposal already `executing`. Independent Luna XHigh review accepted
the bounded path (Python 6/6, customer-action 2/2, typecheck passed). This is
not order recovery: uncertain native intents need an owned account address,
durable request identity, venue order/fill reads, reservation retention, and
an explicit reconciliation-only workflow before Q10 can pass. No stage was
accepted or pushed.

The latest Stage 6 fail-closed slice blocks native-capable Hyperliquid dispatch
before gateway submission when no verified owned trading-address receipt exists.
The proposal becomes `blocked/not_submitted`; legacy master/agent fields cannot
be inferred into a venue address. Gated simulation remains usable. Independent
Luna XHigh review accepted the slice (focused 7/7); root's focused workflow and
read-only adapter run passed 10/10 and rebuilt the stopped normal worker image.
Q10 still needs the verified receipt, gateway enforcement, fill-confirmed status,
and durable recovery. See [Stage 6 progress](stage-06-progress.md).

Stage 4 now has real stored public spot evidence: a bounded one-off Hyperliquid
capture admitted two `recorded_native` books, rejected one pre-instrument book,
and the owned Agent API catalog returned the same two hashes. The direct
capture-and-ingest path passed 5/5 focused tests and independent Luna XHigh
review. A proposed saved-capture importer was removed after the verifier found
that mutable sidecar receipt times could alter replay chronology. No clock
setting was changed. The later owned SQL/Temporal run and outcome checkpoint
is recorded below. The separate console launch remains auto-review blocked,
and Q5 remains open. See
[Stage 4 progress](stage-04-progress.md).

The Stage 4 backend now has two distinct owned customer-team experiment scopes
with matching stored public spot dataset and causal scenario hashes. The
dedicated Temporal worker filled a simulated buy and authenticated owner close
for each; both runs advanced to the frozen end cursor, reconciled flat, and
returned verified HTTP 200 outcomes. A real first run exposed and prompted a
bounded fix for premature `completed_flat` before the scenario end. Focused
Python tests passed 29/29, console typecheck passed, and independent Luna
XHigh review accepted the lifecycle fix by static inspection. The console now
has stop and close controls but its separate launch remains auto-review
blocked. The A/B rules were manually supplied and versions were customer-team,
so this is a backend comparison checkpoint, **not Q5 acceptance** or evidence
that agents generated a strategy. Next: managed-program version prerequisites,
authenticated console refresh/cancel/restart, and release-path qualification.
The app reports the continuous goal as `usageLimited` at this checkpoint; this
is a resumable usage checkpoint, not completion or a Q-gate waiver. No Stage 4
commit or push was made because the stage remains unaccepted.

Stage 7 preparation focused on the authenticated Agent screen, which loads backend
policy markets and configured
cadence on focus, shows unknown/unavailable states instead of preview claims,
and does not describe a blocked account as paused. Preview remains intact.
Mobile typecheck and whitespace check passed. The backend still returns
`assignmentReady: false`, so Q11 enrollment and native trading remain
unavailable. See [Stage 7 progress](stage-07-progress.md).

Fast-track follow-on, 1 October 2026: explicit managed assignment mode now
propagates through manual and Temporal analysis to a version-bound proposal.
Managed Autopilot proposals remain blocked from dispatch. The Hyperliquid
adapter delegates scoped native order/cancel/perpetual-close operations, while
gateway health still disables submission. Convex has a separately authenticated
gateway-only encrypted credential read; the broad worker secret cannot use it.
Gateway native dispatch now requires a live possible-submission marker, exact
account credential, bounded authority limits, and proposal/order identity;
no product path yet creates the live marker. A read-only Hyperliquid capture
adds exact-address account/history evidence but expressly reports incomplete
and non-atomic coverage. Mobile start remains blocked with an accurate native
finance/recovery reason. Focused Node tests passed 35/35 and the first focused
Python group 27/27; later gateway dispatch tests passed 3/3, observation tests
4/4, and gateway regression tests 29/29. TypeScript typechecking passed.
Convex deployed to `dev:outgoing-spider-101`, and rebuilt API/workers/gateway
health checks passed with Manual Guard/Lite on and live submission off. A
pre-existing migration-073 replay constraint failed when later maintenance
rows were present; the constraint was widened to include those later phases,
and migration replay then exited 0. This is no funded qualification or Q10/Q11
acceptance. Next: native source completeness and live account writer, exact
receipt-to-order construction, one-shot dispatch claim/reconciliation, then
route-level authorization and a bounded internal funded run. No commit/push
at this checkpoint because the vertical journey remains incomplete.

Fast-track finance binding follow-on: independent verification found that the
first native dispatch seam trusted caller coin and proposal size without an
exact link to a reserved sizing receipt. Dispatch now checks the stored
Hyperliquid instrument version, native coin, product kind, action, exact
receipt-derived price, quantity, and notional before credential retrieval.
The finance lookup reproduces the stored sizing calculation and accepts only
the new `live_native` receipt class; migration 080 installed that class on
the configured local Timescale database. Migration 081 adds an atomic
single-winner `dispatching` claim before venue I/O; a lost response cannot
silently resubmit the same attempt. Focused dispatch/submission/claim tests
passed 17/17. No live receipt writer, complete native account snapshot, or
live resolution writer exists yet. The next main-flow task is to produce
those facts for one real account and connect one managed proposal through
reservation and observed venue outcome; the mobile start remains blocked.
The migration replay completed with exit 0, the gateway was rebuilt and
restarted, and its health returned Hyperliquid and Uniswap live submission
disabled. The focused native/finance/credential/execution regression set
passed 33/33. No funded or provider operation ran.

Magic vault vertical follow-on, 2 October 2026: a signed-in Magic owner can
request an exact USDC amount and period against an explicit frozen managed
Uniswap assignment. A distinct vault contract, owner-signed Particle UA
approve/fund batch, durable funding operation, finalized vault read and
mobile status path are implemented but have not been funded on chain. The
vault read binds a separate executor and runtime code hash. Confirmed funding
creates a vault venue account and scoped product permission without making a
Particle account the owner. Python now converts only finalized vault USDC/WETH
balances to a native finance snapshot and has an authenticated activation
route that reconciles them under the existing account lock and publishes an
activation receipt. A reviewed live finance policy still has to be registered
for that exact mandate. The sidecar can preflight exact vault buy calldata;
the private executor broadcast and confirmed-fill/stop/close/withdraw folds
remain unfinished. A submission verifier defect that omitted coverage/block
fields from the stored live snapshot was repaired. Focused Python finance
tests passed 45/45 across the selected groups; mobile authority tests passed
20/20, sidecar buy preflight tests 2/2, and root/mobile/sidecar typechecks
passed. Convex dev functions and changed images were rebuilt locally with
live execution still off. No user signature, mainnet deployment, provider
call or trade occurred. Next connect one finance-reserved vault order through
an isolated executor claim, native fill reconciliation, Stop, close and
Magic-owner withdrawal before calling the mobile journey complete.

Magic vault provisioning continuation, 2 October 2026: corrected the quote
boundary to require the exact Magic owner/sender, USDC amount, and ordered
approve/fund calls. Fixed the mandate expiry to whole seconds so deployed
vault terms can match exactly. Added a deployer-only, mandate-keyed CREATE2
factory, a finalized sidecar factory/vault reader and a default-off submit
route using a sidecar-only mounted executor key. The signed-in mobile mandate
flow now calls an authenticated Next route that checks the Convex owned
context, reads the factory, claims one possible deployment, and binds only a
finalized matching vault; retries inspect the mapping without resubmission.
Factory contract tests passed 6/6, sidecar vault tests 5/5, and root/mobile/
sidecar typechecks passed. Convex functions deployed to the configured dev
deployment and the sidecar was rebuilt/reloaded with existing RPC readiness
restored. Factory and vault addresses, provision bearer, executor key, and
mainnet setup are deliberately unset; no gas was spent. The first-order
private dispatch, actual fill, Stop/close/withdraw and funded journey remain
open. The next main-flow task is to configure a reviewed factory/executor
after an exact deployment-cost review, then connect the reserved vault order
to sidecar signer, on-chain fill proof and mobile state.

Magic vault first-buy continuation, 2 October 2026: the managed proposal
execution route now selects the Magic-owned vault path when its exact mandate
is present. That path obtains a native quote, reserves under the live finance
account, commits an immutable vault/order/payload binding, consumes a
single-winner dispatch claim, and asks the isolated sidecar executor to send
one preflighted buy. A lost send response stays reconciliation-only. Finalized
`OrderFilled` evidence and a later vault balance read are required before the
financial journal and Convex mobile receipt can report execution. Historical
executing proposals recover from the immutable SQL binding. Migration 086
applied to local Timescale; the latest Convex contracts deployed to the dev
deployment; backend and sidecar images rebuilt; API/sidecar health passed
with Manual Guard on and live execution off. Focused Python tests passed
17/17, and root, mobile, and sidecar typechecks passed. This is a connected
code path, not a qualified live trade: no factory/vault is deployed, no Magic
owner signature or funded order has occurred, and Stop, close, withdrawal,
repeat buys, and the Hyperliquid routes remain open. No claim of completed
Autopilot or customer readiness is warranted.

Magic vault Stop/close continuation, 2 October 2026: the mobile Stop path now
distinguishes the Magic-owned vault grant from legacy scoped grants. After the
assignment and finance account stop, a restricted sidecar executor can call
the vault's on-chain `stop()` once; Convex marks the mandate stopped only with
finalized block evidence. The stopped-vault close path reads finalized WETH,
reserves its full balance in finance, binds a single sell order and dispatch
claim, and records a flat position only after finalized sell evidence and a
later zero-WETH vault read. Migration 087 was applied locally. Convex dev
functions deployed, Python and sidecar images rebuilt, and their health
checks passed. Root/mobile/sidecar typechecks passed and focused Python
tests passed 6/6. Magic remains the only owner wallet: Particle's SDK is used
only to prepare and relay the same Magic-address funding transaction. The
return transfer from a flat vault to Magic's wallet is not yet wired into
mobile withdrawal. No funded signature, deployment, stop, sell or withdrawal
was sent; mainnet live execution remains off.

Magic vault return continuation, 2 October 2026: after a paused assignment
and confirmed flat position, the mobile withdrawal screen now reads the
exact Magic-owned vault, prepares only its `withdrawUsdc()` call, and asks
Magic to sign it. An attempted-send marker survives app restart; no
automatic retry follows an uncertain wallet response. After ten minutes
with capital still in the vault, the user may explicitly retry its
owner-only return. The sidecar verifies the finalized owner transaction,
`Withdrawn` event, matching canonical USDC
transfer, and empty vault. Migration 088 adds an immutable owner-release
finance proof; the Python writer folds the USDC outflow into the stopped
account, reconciles the later vault snapshot, and then closes the Convex
mandate. Mobile blocks normal withdrawal review while finality or finance
reconciliation is pending and refreshes the Magic balance after confirmation.
Focused release-proof and sidecar tests passed, as did root/mobile/sidecar
typechecks. Convex dev functions deployed, migration 088 applied, and changed
API/sidecar images rebuilt with health checks passing. No actual Magic
signature, vault release, deployment, trade or funded run has occurred; all
live gates remain off. The full vertical and Hyperliquid routes are still
unqualified.

Magic mobile ownership correction, 2 October 2026: mobile bootstrap, home,
activation, mandate, older grant, and withdrawal-context reads now resolve
the exact Magic wallet and its bound strategy rather than taking the first
wallet or strategy row for a user. A legacy Particle row is never treated as
the Magic owner; bootstrap may rebind a single legacy strategy only when
its previous wallet has the same owner address. Separate Particle strategies
remain separate. Focused root tests passed 26/26, TypeScript passed, and
Convex dev functions were deployed. No wallet signature, vault deployment,
funding, or order was sent. The next qualification is the signed-in Magic
mandate and actual vault funding path under an explicit test envelope.

Magic chain observation continuation, 2 October 2026: a read-only Arbitrum
RPC check at finalized block 511067803 observed EIP-7702 code on the test
Magic address and nonempty code at its delegate target. A separate read at
block 511071192 returned 1.095927 canonical USDC and 0.000244844881812256
ETH. The authenticated mobile bootstrap and Start routes now invoke a Convex
action that rereads finalized code and balances for the exact Magic owner;
an internal mutation records the result only on its bound strategy wallet.
Mobile exposes a retry control. Start refuses an unavailable chain check,
and activation no longer accepts a client-declared delegation flag without
an internal chain observation. Focused tests passed 29/29; root and mobile
TypeScript passed; Convex dev functions deployed. The Next.js production
build passed with lint disabled; normal build still fails on preexisting lint
errors in the scoped-grant and activation-authority proxy files. This
observation proves an EIP-7702 marker, not Particle transaction compatibility
or signing. The managed factory, executor configuration, live gates, funded
vault, trade, and return remain unqualified.
The vault/factory Foundry suite passed 6/6. Current local configuration has
no factory address or hash, executor address/key source, or vault provision
and execution secrets; the associated enablement flags are unset/off. These
are operator setup and funded qualification tasks, not evidence that the
Magic owner needs a Particle wallet or another customer-owned account.

Factory preparation continuation, 2 October 2026: an untracked, restricted
executor key was created in the current user's local application-data secret
directory, outside Git. Its public address is
`0xeb463Ad066Bcc7CDFA1716C8B26BF9fB94b1B725`; balance was zero at the
read-only Arbitrum check. The factory script compiled the exact MIT-licensed
contract and reviewed constructor binding for that executor, canonical USDC,
WETH and Uniswap v3 router. A dry run estimated 2,266,566 gas and at that
moment about 0.0000547 ETH maximum from the quoted fee; this is variable,
not an expenditure approval. A deliberately insufficient cost cap was
rejected before broadcast. The unauthenticated local chain-state route
returned 401. No key content was printed, no factory was sent, and the
executor remains unfunded. Before funded qualification, estimate the complete
test cost and configure the sidecar only after the reviewed deployment is
finalized.

Magic vault continuation, 3 October 2026: the signed-in mobile Home works
again after its action validator was aligned with the backend's paused/fix-issue
and starting/stop states. The development Convex ingress and loopback
provision/execution channels now authenticate, with provision and execution
secrets confined to Next/API/sidecar rather than AI workers. The restricted
executor signer matches its configured address. A 0.0001 ETH per-transaction
operator gas cap is configured, but all live and venue enablement flags remain
off. The actual Magic mandate is 0.50 USDC, awaiting a vault, and expires at
2026-10-03 20:33:52 UTC. A read-only factory quote on 2 October estimated
0.0000528335333064 ETH maximum; the executor still held zero ETH. An explicit
0.0005 ETH Arbitrum operator-gas transfer to
`0xeb463Ad066Bcc7CDFA1716C8B26BF9fB94b1B725` was requested; it is
separate from the customer's test capital. The factory and vault are not
deployed, and no owner signature or order was sent. The phone's provision
request reaches the sidecar and correctly reports the absent factory config.
An expired `awaiting_vault` mandate with no deployment claim, vault, or funding
operation can now be replaced atomically; a claimed or potentially submitted
deployment cannot. Convex dev functions deployed; Foundry passed 6/6,
renewal tests 2/2, root/mobile typechecks and focused mobile funding tests
passed. Next: after operator ETH is observed, deploy and verify the factory,
configure its finalized address/hash, deploy this owner's vault, then run the
Magic signature, finalized funding, activation, first order, Stop, close and
return from the mobile flow. Do not label any of these as live-qualified yet.

Funded operator continuation, 3 October 2026: the restricted executor received
0.0005 ETH on Arbitrum. The factory was deployed from that executor in
`0x5c16e80598d725f5d7714eabada741b7e9a2262803ad72590965670cc7bf2b5e`
for 0.00004366016 ETH actual gas. Finalized factory address is
`0x07f93110dd5ad25daddbbe42394165022921d1b3`, with runtime code hash
`0x9b7b3c1b718e53d05d39519e1163c157d0a21d89c0a5ade8f489f0d5aef303f0`.
The signed-in Magic mobile setup submitted exactly one vault deployment for
the existing 0.50 USDC mandate in
`0xb21a651ada0204c64d963fb89d00ab94c9d7c401069346321c7f82531758aa07`.
The receipt succeeded and emitted vault
`0xf4b7c11370bfadd78ac863e9f636c3dd0fd3665d`, with the exact mandate
hash and Magic owner. The mobile finality check then verified the factory
mapping, vault code hash
`0xfe4d2756df706626e9a7e55b24e33ffabc2c08161c069d38698ba910ce74e382`,
owner, executor, frozen program and policy, and 500000-unit cap, and bound the
vault in Convex. Finalized vault USDC and WETH balances were both zero; the
Magic wallet still held 1095927 USDC units. There has still been no Magic
signature, USDC deposit or trade. After the
vault deployment, executor ETH is 0.000422997179712, exceeding the configured
0.0003 ETH buy/Stop/close reserve. A real finalized Uniswap V3 quote accepts
the intended 500000 USDC units. A direct preflight defect was fixed: the
20-minute-lagging finalized block remains authoritative for vault state, while
current chain-head time and state govern order deadlines and executable call
simulation. Focused buy/sell tests pass 7/7, sidecar typecheck passes, and its
rebuilt container is healthy. Live order flags remain off pending signed
funding, finance registration and bounded activation.

The finalized vault read at block 511111951 reported the exact Magic owner,
restricted executor, frozen hashes and 500000-unit limits, with zero vault
USDC/WETH and 1095927 USDC units still in the Magic wallet. A live Particle
Universal Account preparation, without signing or submission, returned one
already-delegated Arbitrum operation whose sender and receiver were the Magic
address, for exactly 500000 USDC units. That ephemeral quote charged ETH
network fees of 32426536032000 wei and passed the account/fee bounds; its
root hash is not a reusable authorization. A separate reviewed native-finance
policy request for this exact vault was generated outside Git and passed the
Python model and fixed-pair validation, with 500000 units maximum capital,
order and daily-loss envelope. Applying it awaits a finalized funded vault.
Temporal managed cadence now refreshes this funded vault's short-lived finance
receipt using its Convex-owned identity before each analysis, so the selected
period does not depend on the mobile screen remaining open. Focused refresh
tests passed 2/2, root TypeScript passed, Convex dev functions deployed, and
API/worker/gateway images rebuilt. No paid analysis or trade was triggered.
The managed Lite Mode's two actual specialist reports now satisfy proposal
quorum only when both reports have distinct roles. Previously the full Focus
four-report gate made every managed Lite proposal fail despite a successful
two-specialist analysis. Other customer-team quorum requirements are unchanged.
The workflow carries its actual Lite flag into completion. Focused completion,
refresh and proposal tests passed 13/13; Python images were rebuilt again and
the API, worker and gateway restarted healthy. The frozen mobile policy still
requires confidence at least 0.65 and consensus at least 0.6, so an agent
abstention remains possible and must not be relabeled as an autonomous trade.

Mobile-funded finance continuation, 3 October 2026: activation no longer needs
the operator to run a policy-registration CLI between the Magic signature and
Start. The native finance API compiles one exact Uniswap USDC/WETH policy from
the Convex-verified funded mandate and frozen program, capped by an explicit
local operator setting. It rejects different venues, leverage, multi-position
programs, protective-exit requirements that the vault cannot fulfill, and
capital beyond the configured cap. This internal deployment sets the automatic
cap to 500000 USDC units; the default remains zero. The resulting policy hash
matches the previously reviewed 0.50 USDC request. Focused Python tests passed
17/17, the API/worker/gateway images were rebuilt and the API health check
returned 200. The mandate is still `vault_ready` with no funding operation;
the Magic owner has not signed or moved USDC. Live order gates remain closed.

Exact-vault live qualification seam, 3 October 2026: the internal buy lane now
has a separately configured, exact deployed-vault address and 500000-unit cap.
The trading backend and sidecar both reject a different vault while global live
execution and general Uniswap certification remain off. Mobile Start passes the
actual funded vault address to both readiness checks; an unrelated account
cannot borrow the test vault's readiness result. Stop and close submissions
are scoped to the same configured vault when that setting is present. Python
and sidecar tests passed, root and sidecar TypeScript checks passed, Convex dev
functions deployed, both backend images rebuilt, and exact-vault readiness was
queried through the live containers. It correctly remains blocked because the
dependency mode is observe, the managed buy/Stop switches are off, and Manual
Guard is on. These switches can be considered only after confirmed Magic
funding and current native finance activation; no trade was sent.

Temporal client compatibility, 3 October 2026: a live read of the installed
Temporal 1.34 client showed `list_schedules()` is awaitable. The managed Start,
Stop and Manual Guard paths had treated it as an async iterator, while their
fake client masked the mismatch. All three call sites now await the iterator,
and the fake follows the installed contract. Focused schedule tests passed
7/7; the rebuilt worker connected to live Temporal, found zero schedules,
and completed the real Manual Guard schedule pass without an exception.

Mobile Start truth, 3 October 2026: the authenticated limits query displayed
the legacy account's one-minute polling interval even though the assigned
frozen managed team schedules every 15 minutes. It now derives the label from
the frozen team version, and the stale Start response that always claimed live
execution was gated now describes the actual proposal/risk/execution checks.
Root TypeScript passed and the change was deployed to development Convex; the
authenticated Magic limits query returned `Every 15 minutes`. The mandate
remains `vault_ready` with no funding operation or Magic signature. Start,
order, fill, Stop, close and owner return have not been live observed.
The focused Magic journey test initially failed because its fake active
mandate omitted the required deployed vault address; production correctly
rejected that impossible funded state. The fixture now includes a vault
address, and the focused journey/readiness suite passes 6/6.
The post-signature path was checked again without sending a signature or
order: funded-vault activation, policy compilation, proposal routing, buy,
Stop and return Python checks pass 21/21. Sidecar buy/Stop/sell/return checks
initially found two fake clients missing the now-required finalized ETH
balance read; those fakes were updated and the focused sidecar suite passes
7/7. Backend and sidecar health return 200. The first Next.js request on
port 3002 timed out during cold compilation; a direct funding API request
then returned the expected 401 without a mobile bearer, showing the route is
serving. These checks do not establish a funded live journey.

Magic signing visibility and Hyperliquid address handoff, 3 October 2026:
the signed-in Android emulator displays the exact 0.50 USDC, one-day mandate,
deployed vault, and enabled `Sign once with Magic and commit capital` button.
Convex still reports `vault_ready`, with no funding operation or signature.
Separately, a ready Hyperliquid binding already verified by the gateway and
backed by one active venue account, permission, integration, and credential
now projects only the master/target account address into the customer-team
execution context. The worker validates that address and account identity
instead of inferring them from an internal strategy ID or API wallet. The
credential ciphertext is omitted from the worker context. This does not
enable native Hyperliquid submission: the worker still returns
`blocked/not_submitted` before the gateway until a complete financial order
package exists. Focused TypeScript passed, Convex tests passed 4/4, Python
workflow/address tests passed 10/10, development Convex deployed, and rebuilt
API, worker and gateway returned health 200. Hyperliquid spot/perpetual
funding, native order construction, fill reconciliation and withdrawal remain
open; no private venue operation was attempted.

First-route qualification handoff, 3 October 2026: an exact-vault operator
arming script now checks the authenticated Magic mandate, confirmed funding
operation, current finance activation, owner/vault identity, capital units,
expiry and local vault/cap before changing runtime settings. Its default is a
dry run; `-Arm` can reload the exact-vault buy/Stop lanes only after those
checks pass. Manual Guard is deliberately left on for the separate bounded
schedule review. Running it now against the real 0.50 USDC test account
exited before any configuration mutation because the mandate is still
`vault_ready` without signed funding. A separate `-Arm` attempt also exited
at that gate and the ignored runtime file's SHA-256 was unchanged. The Android screen was read-only
inspected and its Magic funding button is visible and enabled. No signature
was generated or submitted by the operator.
