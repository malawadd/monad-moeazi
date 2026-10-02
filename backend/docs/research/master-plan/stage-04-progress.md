# Stage 4 connected experiment progress

This is an implementation checkpoint under [Stage 4](stages-03-04.md) and the
[frozen console journey](stage-04-delivery-slice.md). Q5 has **not** passed.

## Current integrated slice

- Owned Convex experiment specs bind two managed-program versions to distinct
  experiment financial scopes. The local operator console uses the signed product
  session through narrow root-app API routes; it does not hold worker credentials.
- The existing simulation backend accepts an internal replay account fixture and
  policy, journals and reconciles that experiment account, then registers a
  versioned run against its opening revision. Admitted native observation metadata
  can be selected for a dataset; the operator must still supply complete manifests
  and strategy rules.
- An owned `runs/outcome` read now requires completed-flat status, clean account and
  position state, the frozen replay end cursor, and bounded source material. Its
  repeatable-read transaction is SQL `READ ONLY`; it independently verifies the
  persisted source prefix, financial journal and position state. The worker's
  existing replay materialization retains its default write behavior.
- The console compares backend-validated dataset and scenario hashes and displays
  exact realized P&L fractions, fees and funding by native asset for completed runs.
  It does not convert across assets, rank variants, or claim aggregate P&L, return,
  live performance, or a releasable mobile program.
- The authenticated `runs/prepare` path now derives the rule, causal-v2 scenario,
  evidence and manifest hashes from an owned experiment, clean account, explicit
  assumptions and ordered stored native observations. It persists the accepted
  evidence snapshot and returns inputs for the existing register/dataset/entry
  routes. The console fills those inputs from the backend response; manual manifest
  entry remains compatible. Fixed Shadow mode denotes this nonauthorizing experiment,
  not a customer deployment's Approval or Autopilot mode.
- The separate observation capture CLI made a public Hyperliquid spot metadata
  capture and three book captures. The books were rejected because venue event time
  was ahead of local receipt time by 0.645–0.936 seconds. No observations were
  ingested or timestamps altered; the app database catalog remains empty.
  Read-only `w32tm /query /status` subsequently reported the Windows time service
  stopped (`0x80070426`). No clock or raw observation timestamps were changed;
  the exact cause of the offset remains unverified.

## Verification at this checkpoint

Focused Python route/outcome suite: 14 passed, 2 SQL skips. Replay/checkpoint
regression: 14 passed, 1 SQL skip. Root TypeScript suite: 292 passed. Root and
console typechecks and console production build passed. Independent Luna XHigh
review found no main-journey or credible financial/authority defect in the outcome
read. The local API image was rebuilt; `/health` returned OK with live execution
off, Manual Guard on, Lite Mode on. A valid-shape unauthenticated outcome request
returned 401. These checks do not establish a real completed experiment outcome.

The later run-preparation focused/regression suite passed 21 tests with fake SQL
and storage. Console and root typechecks and the console production build passed.
An independent review found legacy replay v1 would censor adverse future outcomes;
preparation was changed to causal v2 only and server-selects its model identity.
The verifier accepted the repaired checkpoint after focused tests (2/2) and console
typecheck. The local API image was rebuilt and its container recreated; `/health`
returned `ok` with live execution off, Manual Guard and Lite Mode on, and an
unauthenticated `runs/prepare` call returned 401. Actual SQL/Temporal execution
was outstanding at that checkpoint; this is not a Q5 pass.

## Remaining main-path gates

1. Qualify two managed-program versions with real ownership and strategy lineage;
   manually entered customer-team replay rules do not prove managed-program A/B.
2. Complete an authenticated operator-console walkthrough, including refresh,
   cancellation/restart, provenance and outcome comparison. The separate console
   launch remains rejected by automatic approval review.
3. Verify experiment isolation and reproducibility after a clean service restart;
   decide whether Q5 passes only after the full connected journey.

The root web dev process on port 3002 was restarted after a production build shared
its `.next` directory. `/agents` now returns HTTP 200; a signed-in operator
walkthrough remains unverified. The console launch was rejected by automatic
approval review, so no alternate launch mechanism was used. Q4 perpetual/funding
and broader recovery gates remain separate prerequisites for later claims.

The initial read-only worker preflight found the `moeazi_simulation_writer` database
role existed only as `NOLOGIN`. At that point no scoped DSN, Convex identity URL,
worker secret, or research-operator allowlist was configured. The worker was not
started; provisioning credentials before the authenticated Convex path is available
would not establish a connected run.

The local application database now has a separate `moeazi_simulation_local` login
whose sole inherited role is `moeazi_simulation_writer`. Its random credential and
service-network DSN are stored only in ignored `.env.agents`. The actual
`verify_simulation_database_role` startup guard passed from the
running API container over the Compose service network. The login has no superuser,
database/role creation, replication or RLS-bypass attribute. This is credential
preparation, not an authenticated operator journey or a Q5 pass. A host-side
`127.0.0.1:5432` attempt returned password failure even though the configured
credential matched the container's SCRAM verifier and direct container TCP login
passed; local host forwarding requires separate diagnosis if a host process must
use that path. The dedicated worker uses `timescaledb:5432`.

## Connected runtime checkpoint

The user explicitly preapproved Convex operations. `npx convex dev --once`
completed twice on `dev:outgoing-spider-101`; the first deployment added
`experimentSpecs.by_createdBySubject_strategyAccountId`. Typecheck passed before
deployment. A dedicated simulation identity secret was installed in Convex dev.
The CLI's stdin form produced a credential mismatch, so it was reset using the
exact argument bytes; an authorized HTTP request to `/simulation-worker` then
returned 200 with `null` for a nonexistent experiment, while the same request
without the secret returned 401. No credential value entered tracked files or
this report.

The signed-in local browser wallet mapped to exactly one existing Magic user in
the dev deployment. Only that subject was allowlisted for program research in
Convex and ignored `.env.agents`; the subject is recorded here only by SHA-256
prefix `c423da6654b1`. The identity route still returned `null` for an unowned
experiment, as expected. No owned experiment had been created at that check.

The simulation worker's Compose configuration passed the scoped-role startup
guard and contained no provider, wallet, or private-key environment names. A YAML
flow-list comma in the tmpfs mount initially prevented container creation; the
tmpfs item is now quoted. The worker built locally and started. It encountered
three running Temporal workflows left by disposable Q4 tests while the application
database held zero simulation runs, so it was stopped. Those exact three orphaned
local workflows were terminated with histories retained; the evidence-lifecycle
workflow was left untouched. The isolated worker then restarted and remained
running with zero restarts and no new log errors. Analyst/evaluation workers
remain stopped. This proves worker startup, not run advancement or Q5.

One signed-in account's saved customer-team version was frozen into a
non-executable `purpose: identity` experiment spec using the Convex development
CLI's explicit test identity. Repeating the same idempotency key returned the
same sole record. The dedicated HTTP worker endpoint resolved that exact owned
spec and returned `environment: experiment` with `liveExecutionAllowed: false`.
The real strategy account was `ready`, so the original simulation identity rule
returned `entryEligible: false` despite no emergency stop. A bounded
experiment-only repair now permits `ready` or `active` with stop false; paused,
provisioning, emergency-stopped, and explicit stop remain blocked. Independent
Luna XHigh review accepted it (focused 7/7 and TypeScript typecheck). After the
Convex dev redeploy, the same owned spec resolved with `entryEligible: true` and
`simulation_manifest_required`. This CLI test identity proves the backend
ownership bridge, not the signed browser/console journey or an executed run.

## Native observation checkpoint

A fresh read-only Windows Time stripchart measured roughly 15–18 ms of offset;
no system-clock change was made. An opt-in fixed-host Hyperliquid `@142` spot
capture stored raw public responses under ignored `.data`. One of three books
was rejected as `instrument_not_effective`, while two were replay-accepted.
The first attempt was capture-only, so it did not create database evidence.

Independent review found that an offline importer could accept altered sidecar
receipt times without changing raw-response hashes. That importer was removed.
The accepted path now captures and ingests in one process, passing the in-memory
receipt time directly to normalization, replay, and PostgreSQL. A one-off local
container had only the application database DSN and a persistent `.data` mount;
the host CLI still accepts only loopback PostgreSQL, while `timescaledb` is
accepted only inside Docker. The known simulation logins are rejected. The
focused capture suite passed 5/5, and independent review found no blocker in
the narrowed path.

One bounded three-book capture admitted exactly two `recorded_native` hashes
into the local application database with one instrument version. Both raw book
files remain in the ignored host evidence directory, and the stored references
point there. The authenticated Agent API observation catalog returned HTTP 200
for the owned customer-team experiment and listed the same two hashes with
`simulation_only` authority. This proves source admission and owned discovery,
not an executed experiment, native execution, complete source provenance, or Q5.
The local application DSN currently uses the development `postgres` role; this
check does not establish least-privilege source ingestion.

## Owned replay execution checkpoint

A second bounded public `@142` capture admitted three more native spot books in
the application Timescale database. The backend prepared a causal-v2 manifest
from their stored hashes for a newly owned customer-team experiment scope;
registration, dataset registration, and entry request each returned HTTP 200.
The dedicated Temporal worker advanced the run. The first attempted scope was
stopped cleanly after its entry was rejected because the internal replay account
fixture omitted the base asset and used a quantity step different from the
instrument's native lot size. It produced no order or trade.

The corrected isolated fixture registered both native assets and the native lot
step. Its replay buy and later authenticated owner-requested close both filled;
the resulting position is flat, account and position reconciliation are clean,
and no capacity remains held. SQL and the owned run API report
`completed_flat` with no pending obligations. This is actual local
Convex-to-SQL-to-Temporal simulated trading on recorded public observations,
not a native venue submission or a customer-account trade.

The outcome endpoint still returned 409 for that run. The worker marked it
`completed_flat` at a replay cursor preceding the manifest's frozen end, while
the outcome verifier correctly requires the end cursor. This is a main-path
completion defect under repair; the successful fill and flat position do not
establish a reportable experiment outcome or Q5. The console also lacked the
close and stop controls used through the authenticated API, so those controls
are being added without changing customer authority. The separate console has
not been launched because automatic approval review rejected that launch.

When recreating the local API container, Compose alone did not reproduce the
project launcher's `.env`, `.env.local`, `.env.agents` precedence and left its
worker secret blank. The container was recreated with the existing ignored
environment values through the documented launcher precedence; health and
authenticated calls then passed. No secret value entered tracked files.

## Frozen-horizon repair and comparable backend outcomes

The replay worker now reserves `completed_flat` for a stopped, clean run at
the manifest's frozen end cursor. It follows any remaining modeled event or
protection deadline first, advances to the end only after obligations clear,
and requires the end-cursor derived account checkpoint for an economic run.
Independent Luna XHigh review found the source/deadline and completion gates
sound by static review. A separate console review found a run-wide stop retry
key could vary with an unrelated instrument field; the key now excludes that
field. Focused Python tests passed 29/29 and console typecheck passed. The
disposable-Q4 PostgreSQL regression test was skipped by its explicit DSN guard;
the following owned runtime checks provide separate application-database
evidence.

Two distinct owned **customer-team** experiment scopes were bootstrapped with
identical hypothetical opening balances and the same simulation-only policy.
Their internal fixture cutoffs precede a shared three-book `recorded_native`
Hyperliquid `@142` dataset. The scopes bind different saved team versions, but
the executable replay rules were entered manually: one requested 100,000 native
base units, the other 200,000. Both prepared manifests have the same dataset
hash `01e8c4ff…dd83b6ba` and causal scenario hash `ea47f389…94e2ba`.
Each owned run registered, queued entry, filled a simulated buy, accepted an
authenticated owner close and stop, filled the simulated reduction, advanced
to the exact frozen end, reconciled flat, and returned HTTP 200 from the
independently verified outcome endpoint. The outcome records respectively
11,000 and 22,000 realized quote-native units, and 167,203 and 334,406 fee
units. These are replay outputs, not returns, profitability evidence, or an
agent/team contribution measurement. The worker image was rebuilt and restarted
for the fix; API live execution remained off.

This passes the **backend comparison path** only. The separate console still
has not been launched after automatic approval review rejected its launch.
The two frozen controllers are customer-team versions, not managed mobile
program versions, and the rules were manually supplied rather than generated
by those teams. Console refresh/cancel/restart, managed-program A/B lineage,
and operator UI authentication remain Q5 gates. Q10 native execution and Q11
mobile Autopilot are not established by this experiment.
