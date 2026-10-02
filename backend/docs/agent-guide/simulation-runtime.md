# Experimental trading runtime

Stage 3 is shipping a bounded experimental foundation checkpoint. The normal worker
spot entry/owner-close path has local SQL proof; the original full Q4 gate is not
passed. See the [release checkpoint](../research/master-plan/stage-03-release.md)
for deployed boundaries, passing evidence and deferred requirements.

## Runtime ownership

The existing Agent API authenticates the product subject and resolves an owned
Convex experiment. PostgreSQL stores the immutable run, frozen market corpus,
strategy requests, order payloads, approvals, events and financial state. The
dedicated `MoeaziSimulationSupervisorV1` Temporal workflow uses queue
`moeazi-trading-simulation-v1`. Its financial writer is independent of analyst
workflows, model budgets and the browser.

The API repository has no entry authorizer. It can register immutable work, read
owned state and persist controls; only the simulation worker performs fresh entry
checks and financial admission. It never imports a provider or signer.

## Source API sequence

All routes are under `/v1/simulation`. Trusted server authentication supplies the
subject; caller-provided account IDs, actor overrides and financial writer epochs
are rejected. No browser receives worker credentials.

1. `POST /runs` registers a strict versioned manifest against the owned experiment
   and clean initial financial state.
2. `POST /runs/dataset` supplies ordered hashes of already stored observations.
   It cannot inject raw source records. The full corpus hash, rights, provenance,
   instrument identity and earlier decision evidence are verified separately.
3. `POST /runs/request-entry` queues an immutable, nonauthorizing strategy rule.
   The worker must derive sizing, capacity reservation and the prepared order.
4. `POST /runs/prepared-orders` returns at most 50 exact payloads for review, with
   a pagination cursor and observed reservation/order status. It grants no authority.
5. Approval mode uses `POST /runs/approve` with the prepared payload hash and an
   expiry; `POST /runs/revoke-approval` persists revocation independently of dispatch.
6. `POST /runs/control` durably records stop, cancel or close requests before the
   Temporal wake. `POST /runs/read` and `/runs/wake` preserve owned recovery access.
7. `POST /runs/portfolio` reads exact positions, account reconciliation, retained
   account-wide capacity and protection-record counts in one read-only repeatable
   database snapshot. Position pages contain at most 50 rows; held-capacity output
   declares whether its 100-row bound is complete. This review cannot admit risk.
8. `POST /runs/outcome` reads only an owned, completed-flat, clean experiment whose
   replay reached the frozen end cursor. A bounded read-only transaction checks the
   persisted source prefix and financial checkpoint against the independent replay
   oracle. It returns exact native-asset realized P&L, fee and funding totals and
   event counts. Cross-asset aggregate P&L and return remain unknown without a
   common valuation and opening-equity basis. It cannot admit or alter risk.

A successful queue or approval response is not a fill. Unconfirmed Temporal
dispatch returns `retry_required` while the SQL record remains persisted. Retrying
must preserve its original request/command ID and economic payload.

Cancellation dispatch has its own immutable receipt and replay timestamp. Multiple
commands cannot create competing cancellation histories for one order. A terminal
source cancellation alone does not release a hold or close the filled position;
financial settlement and any remaining position protection must complete separately.

Revoking an approval invalidates every existing receipt for that exact intent and
prepared payload. Only a later explicit approval can authorize it again; replaying
the earlier revocation remains idempotent. Review responses show the latest receipt
and its observed expiry/revocation state, while dispatch rechecks the actual receipt.

Account authority uses an additive `controlRevision`. Status/emergency-stop changes
increment it; heartbeat and balance-display updates do not. Stop/resume cannot make
an old run valid again, even when both changes share a timestamp. Missing legacy
revision means zero; corrupt or exhausted revisions reject changes.

## Two clocks and evidence boundaries

Historical simulation uses a declared replay cursor for market availability and
fill modeling. PostgreSQL wall time owns writer leases and approval expiry. Fresh
product identity is timestamped before its network request and must still be no
older than five seconds when the account lock is acquired; future timestamps reject.

Synthetic-fault observations require `local_simulation_fixture_only` rights and a
historical experiment scope. Their provenance remains synthetic. Recorded native
observations retain separate internal qualification rights and clock limitations.
Neither a simulation result nor a documented-example test establishes live support.

SQL065 persists the monotone bounded replay cursor and immutable decision contexts.
The internal decision store resolves its current reconciled account observation,
stored evidence and frozen dataset itself. Callers cannot supply a decision cursor,
account balance or price. Later decisions carry their own evidence/account checkpoint;
the initial run manifest remains immutable. A stored decision grants no permission
to reserve capacity or submit an order.

Portfolio review reports the account observation's original provenance/cutoff and
the run's replay cursor separately. It does not present a historical checkpoint as
fresh live evidence or infer protection from the existence of a protection record.

## Dedicated credential configuration

`docker-compose.simulation.yml` is an optional, disabled-by-default overlay. Never
start the whole stack to test it; select the dedicated service and keep analyst and
evaluation workers stopped during this qualification phase.

| Setting | Purpose |
| --- | --- |
| `TRADING_SIMULATION_ENABLED` | Explicit local simulation enablement |
| `TRADING_SIMULATION_POSTGRES_DSN` | Scoped experiment writer login; never the admin/application DSN |
| `TRADING_SIMULATION_CONVEX_IDENTITY_URL` | Dedicated HTTPS `/simulation-worker` identity endpoint |
| `SIMULATION_WORKER_SECRET` | Distinct secret mapped by Compose to the worker's identity credential |
| `TRADING_SIMULATION_TEMPORAL_ADDRESS` | Existing Temporal service address |

The identity endpoint accepts only one read-only query. Its token is rejected by
the broad worker dispatcher. Secrets stay in ignored configuration, never Temporal
payloads, run manifests, documentation or test evidence.

### Local advancement of an API-registered run

The overlay is not part of the normal stack. For a local advancement check, the API,
Temporal, and the target disposable database must already be running. Set
`TRADING_SIMULATION_ENABLED=true` only in ignored local configuration for this check;
it remains false by default. Keep the dedicated simulation DSN, HTTPS identity URL,
and distinct worker secret only in the ignored `.env.agents.monad` file. In PowerShell,
select only the simulation worker:

```powershell
docker compose -p moeazi-monad --env-file .env.agents.monad -f docker-compose.agents.yml -f docker-compose.simulation.yml --profile simulation up -d --no-deps simulation-worker
```

This selects the isolated worker service and does not start analyst or evaluation
workers. `--no-deps` means the existing Temporal and Timescale services must already
be available on the same Compose project network. The DSN must be reachable from the
worker container; `127.0.0.1` inside that container points back to the container.
Stop only this worker after the check:

```powershell
docker compose -p moeazi-monad --env-file .env.agents.monad -f docker-compose.agents.yml -f docker-compose.simulation.yml --profile simulation stop simulation-worker
```

Register the account and run through the authenticated operator journey before
checking that persisted run state advances with the console closed. The existing
`MOEAZI_Q4_PROCESS_TEST` process-restart harness uses real local SQL/Temporal but
prepares its run directly in test code and supplies a synthetic identity fixture; it
does not prove the authenticated API-to-worker journey or real Convex identity.
That check also requires the actual disposable simulation-writer DSN, the dedicated
Convex `/simulation-worker` URL and secret, and an allowlisted operator subject.
The scoped simulation writer cannot write the observation fixture needed by account
bootstrap; use the authenticated API's application boundary for that command. Never
give the simulation worker the application/admin DSN.

SQL061 creates a nonlogin simulation group with experiment-only restrictive RLS.
The separately provisioned login must have no administrative, owner, bypass,
schema-creation, unexpected membership, privileged-function or outbox-ack authority.
The startup check includes column grants and verifies that restrictive policies
cover every command. Application scope checks still own cross-experiment isolation.

## Timescale deployment gate

Timescale 2.28.2 grants PUBLIC reads on 44 extension relations, including job config
and history. SQL064 removes those ambient reads using an exact extension-owned
inventory. It adds no metadata exception to the worker's startup check. It refuses
unknown extension versions or other non-simulation, non-superuser consumers until
their access requirements are reviewed. The current baseline services use postgres.

The foundation checkpoint applied SQL058–079 to the local application database
after backup and consumer review; ordinary services and Timescale jobs use postgres.
An extension upgrade may restore grants;
worker startup must reject that drift. Do not blindly reapply a broad allowlist.

Rollback disables new experimental admissions and retains reconciliation/protection
workers for outstanding obligations. Preserve journals, reservations, commands and
source events. Restoring PUBLIC catalog reads while a simulation worker runs would
undo its confidentiality boundary and is not an acceptable rollback shortcut.

## Current Q4 qualification limits

SQL070–073 in the disposable qualification database provide exact phase receipts,
source-bound protection obligations, terminal reservation settlement and guarded
flat-resolution records. An accepted reduction request never proves flatness.
Protection history retains its original status; only an independently reconciled
flat proof resolves it. Reporting distinguishes unresolved from historical records.

The v1 simulator's future-price preflight is not qualified for unbiased strategy
comparison. Causal v2 fixes admission to current evidence and applies depth, fees
and cancellation at source time. Its normal-worker spot-close path is qualified
locally; perpetual funding and broader closure recovery remain gated. Existing v1
data retains its model/hash identity. No live execution qualification occurred.
